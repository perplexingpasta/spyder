/// <reference lib="dom" />
// Electron hardening: sandboxed windows, no pop-ups or navigation away, IPC only from Spyder's own page.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { INSTALLED_EXE, launch, ROOT, type Launched } from './helpers';

let s: Launched;
test.beforeAll(async () => {
  s = await launch();
});
test.afterAll(async () => {
  await s?.close();
});

test('every window is sandboxed with context isolation', async () => {
  const prefs = await s.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => {
      // reason: getLastWebPreferences exists at runtime but isn't in Electron's typings.
      const p = (
        w.webContents as unknown as { getLastWebPreferences: () => Record<string, unknown> }
      ).getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    }),
  );
  expect(prefs).toHaveLength(4); // the bar, the dashboard, the prompt and the gadget (P107)
  for (const p of prefs) expect(p).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
});

test('window.open is denied', async () => {
  const before = s.app.windows().length;
  expect(await s.dashboard.evaluate(() => window.open('https://example.com') === null)).toBe(true);
  await s.dashboard.waitForTimeout(300);
  expect(s.app.windows().length).toBe(before);
});

test('a window cannot navigate away from Spyder', async () => {
  await s.dashboard.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await s.dashboard.waitForTimeout(500);
  expect(s.dashboard.url()).toContain('#/dashboard');
  // Hash routes still work.
  await s.dashboard.evaluate(() => {
    location.hash = '/dashboard/week';
  });
  await expect.poll(() => s.dashboard.url()).toContain('#/dashboard/week');
});

test('showInFolder only reveals a workbook this run exported', async () => {
  await expect(
    s.dashboard.evaluate(() => window.spyder.showInFolder('C:\\Windows\\System32\\cmd.exe')),
  ).rejects.toThrow(/Only an exported workbook/);
});

test('IPC from a page that is not Spyder is refused', async () => {
  test.skip(!!INSTALLED_EXE, 'needs the preload from out/');
  const res = await s.app.evaluate(
    async ({ BrowserWindow }, preload) => {
      const w = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true },
      });
      try {
        await w.loadURL('data:text/html,<p>not spyder</p>');
        await w.webContents.executeJavaScript('window.spyder.getSettings()');
        return 'allowed';
      } catch (e) {
        return String(e);
      } finally {
        w.destroy();
      }
    },
    join(ROOT, 'out/preload/index.js'),
  );
  expect(res).toContain('not Spyder');
});
