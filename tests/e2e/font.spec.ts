/// <reference lib="dom" />
// Font (P78) and app colours in Settings (P79): applied live to every window, kept, and reset.
import { expect, test, type Page } from '@playwright/test';
import { freshDataDir, launch, seed, shot } from './helpers';

const DATE = '2026-11-24';
const font = (p: Page) => p.evaluate(() => getComputedStyle(document.body).fontFamily);

test('font switches live in every window; app colours are added, shared and reset in Settings', async () => {
  const dir = freshDataDir();
  seed(dir, 1, DATE);
  const s = await launch({ dataDir: dir, now: `${DATE}T15:00:00` });
  try {
    const d = s.dashboard;
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    const pick = d.getByTestId('set-font');
    await pick.waitFor();
    expect(await font(d)).toMatch(/^"?Segoe UI/);

    await pick.locator('[data-value=atkinson]').click();
    await expect.poll(() => font(d)).toMatch(/^"?Atkinson Hyperlegible Next/);
    await expect.poll(() => font(s.widget)).toMatch(/^"?Atkinson Hyperlegible Next/);
    expect(s.db().prepare("SELECT value FROM settings WHERE key = 'font'").get()).toEqual({ value: '"atkinson"' });
    await d.evaluate(() => window.spyder.start(900));
    await s.widget.waitForTimeout(400);
    await shot(s.widget, 'widget-bar-atkinson');
    // A reload (or a new window) keeps it.
    await d.reload();
    await expect.poll(() => font(d)).toMatch(/^"?Atkinson Hyperlegible Next/);

    // App colours: two apps may share a colour; Reset drops a pick.
    await d.evaluate(() => window.spyder.openDashboard('settings'));
    const name = d.getByTestId('app-color-name');
    await name.waitFor();
    for (const app of ['youtube.com', 'Slack']) {
      await name.fill(app);
      await d.getByTestId('app-color-add').click();
    }
    const rows = d.getByTestId('app-color-row');
    await expect(rows).toHaveCount(2);
    for (const i of [0, 1]) await rows.nth(i).locator('input[type=color]').fill('#aa3300');
    await expect
      .poll(() => JSON.parse((s.db().prepare("SELECT value FROM settings WHERE key = 'appColors'").get() as { value: string }).value))
      .toEqual({ Slack: '#aa3300', 'youtube.com': '#aa3300' });
    await d.mouse.move(0, 0);
    await shot(d, 'settings-font-app-colours');
    await rows.filter({ hasText: 'Slack' }).getByRole('button', { name: 'Reset Slack' }).click();
    await expect(rows).toHaveCount(1);

    await d.evaluate(() => window.spyder.openDashboard('today'));
    await d.getByTestId('timeline-card').scrollIntoViewIfNeeded();
    await d.waitForTimeout(300);
    await shot(d, 'today-timeline-atkinson');

    await d.evaluate(() => window.spyder.openDashboard('settings'));
    await pick.locator('[data-value=system]').click();
    await expect.poll(() => font(d)).toMatch(/^"?Segoe UI/);
    await expect.poll(() => font(s.widget)).toMatch(/^"?Segoe UI/);
  } finally {
    await s.close();
  }
});
