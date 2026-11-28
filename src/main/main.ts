import { app, nativeTheme, Notification } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClock, parseLocalIso } from '../core/clock';
import { cleanSettings } from '../core/settings';
import { Tracker } from './capture/tracker';
import { rememberAppPath } from './appIcons';
import { applyAutostart } from './autostart';
import type { AppCtx } from './context';
import { Db } from './db/db';
import { migrate } from './db/migrate';
import { MIGRATIONS } from './db/migrations';
import { seedDefaults } from './db/seedDefaults';
import { addDebugHook, addDebugState, registerDebug } from './debug';
import { EngineHost, type ActivitySample } from './engineHost';
import { registerHotkey } from './hotkey';
import { startIdle } from './idle';
import { registerIpc } from './ipc';
import { isAppUrl } from './paths';
import { loadSettings } from './settings';
import { applyTheme } from './theme';
import { createTray } from './tray';
import { applyGadget, createDashboard, createPrompt, createWidget, QUIET, showWidget } from './windows';

// Must happen before whenReady (plan §3).
app.setName('Spyder');
app.setAppUserModelId('com.spyder.app');
// The widget plays the ring chime without a user gesture (plan §12).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const dataDir = process.env.SPYDER_DATA_DIR ?? join(app.getPath('appData'), 'Spyder');
mkdirSync(dataDir, { recursive: true });
// Keep Chromium profile + single-instance lock inside the data dir so test instances are isolated.
app.setPath('userData', join(dataDir, 'electron'));

// Every window shows only Spyder's own page: no pop-ups, no navigating away, no web views.
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void boot();
}

async function boot(): Promise<void> {
  console.log(`[spyder] node ${process.versions.node}, electron ${process.versions.electron}, data ${dataDir}`);
  const clock = createClock({
    origin: parseLocalIso(process.env.SPYDER_NOW),
    scale: Number(process.env.SPYDER_CLOCK_SCALE ?? 1),
    realNow: Date.now,
  });
  const db = new Db(join(dataDir, 'spyder.db'));
  migrate(db, MIGRATIONS, clock.now());
  // e2e: SPYDER_DEFAULTS (JSON) gives a fresh data dir its own first-run settings, e.g. Track from startup off.
  const firstRun = process.env.SPYDER_DEBUG === '1' && process.env.SPYDER_DEFAULTS ? cleanSettings(JSON.parse(process.env.SPYDER_DEFAULTS) as Record<string, unknown>) : {};
  seedDefaults(db, clock.now(), firstRun);

  const ctx: AppCtx = {
    dataDir,
    db,
    clock,
    settings: loadSettings(db),
    debug: process.env.SPYDER_DEBUG === '1',
    quitting: false,
    widget: null,
    dashboard: null,
    prompt: null,
    gadget: null,
    tray: null,
    hotkeyOk: false,
  };

  if (QUIET) {
    app.on('browser-window-created', (_e, w) => {
      w.setOpacity(0);
      w.setIgnoreMouseEvents(true);
      w.setSkipTaskbar(true);
    });
  }
  app.on('second-instance', () => showWidget(ctx));
  app.on('before-quit', () => {
    ctx.quitting = true;
  });
  app.on('window-all-closed', () => {
    // Stay alive in the tray; only Quit exits.
  });
  const host = new EngineHost(ctx);
  let tracker: Tracker | null = null;
  app.on('will-quit', () => {
    try {
      tracker?.stop();
      host.stop();
      db.close();
    } catch {
      // already closed
    }
  });

  await app.whenReady();
  registerIpc(ctx, host, { titlePatternsChanged: () => tracker?.firefox.reload() });
  registerDebug(ctx);
  applyAutostart(ctx);
  applyTheme(ctx);
  addDebugState('host', () => host.debugState());
  addDebugState('theme', () => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }));
  addDebugHook('injectActivity', (s: ActivitySample) => host.feedSample(s));
  addDebugHook('setScale', (scale: number) => ctx.clock.setScale(scale));
  addDebugHook('tick', () => host.dispatch({ type: 'TICK' }));
  ctx.widget = createWidget(ctx);
  ctx.dashboard = createDashboard(ctx);
  ctx.prompt = createPrompt(ctx);
  applyGadget(ctx); // P107
  ctx.tray = createTray(ctx, {
    toggleLoop: () => (host.state.loop ? host.dispatch({ type: 'STOP' }) : host.start(ctx.settings.blockLengthSec)),
    loopLabel: () => (host.state.loop ? 'Stop' : 'Start'),
  });
  const idleSec = startIdle(ctx, host);
  host.boot();
  // SPYDER_CAPTURE=0 (e2e) keeps the real foreground window out of scripted scenarios.
  tracker = new Tracker(ctx, host, idleSec);
  if (process.env.SPYDER_CAPTURE !== '0') tracker.start();
  const t = tracker;
  addDebugState('tracker', () => t.debugState());
  addDebugHook('flush', () => {
    t.flush();
    host.saveHeartbeat();
  });
  addDebugHook('killProbe', () => t.fg.kill());
  addDebugHook('rememberAppPath', (exe: string, path: string) => rememberAppPath(ctx.db, exe, path));
  if (!registerHotkey(ctx)) console.warn(`[spyder] hotkey ${ctx.settings.hotkey} is taken`);
  if (!Notification.isSupported()) console.warn('[spyder] notifications not supported');
}
