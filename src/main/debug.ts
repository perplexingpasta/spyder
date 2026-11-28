// Debug IPC hooks (ADR-0006). Registered only when SPYDER_DEBUG=1.
import { ipcMain } from 'electron';
import type { AppCtx } from './context';
import { hotkeyHandler } from './hotkey';
import { isAppUrl } from './paths';
import { trayClick, trayInfo } from './tray';
import { gadgetDesktop } from './windows';

export type DebugHandler = (...args: never[]) => unknown;

/** Extra hooks later phases plug in (simulateIdle, injectActivity, flush, ...). */
const hooks = new Map<string, DebugHandler>();

export function addDebugHook(name: string, fn: DebugHandler): void {
  hooks.set(name, fn);
}

/** State extensions contributed by other modules (engine state, ring count, ...). */
const stateParts = new Map<string, () => unknown>();
export function addDebugState(name: string, fn: () => unknown): void {
  stateParts.set(name, fn);
}

export function registerDebug(ctx: AppCtx): void {
  if (!ctx.debug) return;
  addDebugHook('state', () => {
    const out: Record<string, unknown> = {
      dataDir: ctx.dataDir,
      now: ctx.clock.now(),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      hotkeyOk: ctx.hotkeyOk,
      widgetVisible: !!ctx.widget?.isVisible(),
      widgetOnTop: !!ctx.widget?.isAlwaysOnTop(),
      dashboardVisible: !!ctx.dashboard?.isVisible(),
      gadgetVisible: !!ctx.gadget && !ctx.gadget.isDestroyed() && ctx.gadget.isVisible(),
      gadgetDesktop,
    };
    for (const [k, fn] of stateParts) out[k] = fn();
    return out;
  });
  addDebugHook('trayInfo', () => trayInfo(ctx));
  addDebugHook('trayClick', (label: string) => trayClick(ctx, label));
  addDebugHook('setNow', (ms: number) => ctx.clock.setNow(ms));
  addDebugHook('advance', (sec: number) => ctx.clock.advance(sec));
  addDebugHook('triggerHotkey', () => hotkeyHandler(ctx));

  ipcMain.handle('spyder:debug', async (e, name: string, ...args: unknown[]) => {
    if (!isAppUrl(e.senderFrame?.url)) throw new Error('IPC from a page that is not Spyder');
    const fn = hooks.get(name);
    if (!fn) throw new Error(`unknown debug hook: ${name}`);
    return (fn as (...a: unknown[]) => unknown)(...args);
  });
}
