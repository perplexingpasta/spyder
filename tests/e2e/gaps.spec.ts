/// <reference lib="dom" />
// P95: time Spyder was asleep or off becomes a break block that the prompt asks about, and any untracked span on
// Today can be accounted for.
import { expect, test } from '@playwright/test';
import { launch, shot, type Launched } from './helpers';

let s: Launched | undefined;
test.afterEach(async () => {
  await s?.close().catch(() => undefined);
  s = undefined;
});

type Row = { kind: string; name: string | null; started_ms: number; ended_ms: number | null; deleted_ms: number | null };
const blocks = (l: Launched) =>
  l.db().prepare('SELECT kind, name, started_ms, ended_ms, deleted_ms FROM sessions ORDER BY started_ms').all() as unknown as Row[];
const at = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00`).getTime();

test('a nap with the laptop asleep is a break block the prompt asks about on wake (P95)', async () => {
  s = await launch({ now: '2026-11-24T11:00:00', env: { SPYDER_DEFAULTS: JSON.stringify({ trackFromStartup: true }) } });
  await expect.poll(async () => ((await s!.debug.state()).host as { engine: { loop: unknown } }).engine.loop).not.toBeNull();
  // Asleep at once: a jump in the clock while awake would itself look like a missed sleep.
  await s.debug.simulateSuspend();
  await s.debug.setNow(at('13:02'));
  await s.debug.simulateResume();

  const p = s.prompt.getByTestId('prompt-account');
  await expect(p).toContainText('11:00–13:02');
  await expect(p).toContainText('Computer asleep or off');
  // Until answered it's a break, so it never counts as work.
  const gap = () => blocks(s!).find((b) => b.kind === 'break' && b.deleted_ms === null);
  expect(gap()?.name).toBe('Computer asleep or off');
  expect(gap()!.ended_ms! - at('13:02')).toBeLessThan(5000); // the e2e clock runs on in real time
  await shot(s.prompt, 'prompt-gap');

  await p.getByLabel('Answer').fill('Nap');
  await p.getByTestId('account-break').click();
  await expect.poll(() => gap()).toMatchObject({ kind: 'break', name: 'Nap' });
  await expect(p).toHaveCount(0); // answered, so nothing is left to ask
});

test('an untracked span on Today can be accounted for, with Undo (P95)', async () => {
  s = await launch({ now: '2026-11-24T11:15:00' });
  const d = s.dashboard;
  await d.evaluate(() => window.spyder.openDashboard('today'));
  await d.getByTestId('block-log').waitFor();
  const untracked = d.getByTestId('log-untracked');
  await expect(untracked).toContainText('10:00–11:15');

  await untracked.hover();
  await untracked.getByTestId('untracked-fill').click();
  const edit = d.getByTestId('untracked-edit-row');
  await edit.getByLabel('Answer').fill('Standup and planning');
  await shot(d, 'today-fill-untracked');
  await edit.getByLabel('Answer').press('Enter');

  await expect(d.getByTestId('toast')).toContainText('Accounted for “Standup and planning”');
  await expect(d.getByTestId('log-untracked')).toHaveCount(0);
  await expect(d.getByTestId('block-row').filter({ hasText: 'Standup and planning' })).toHaveCount(1);
  const live = blocks(s).filter((b) => b.deleted_ms === null);
  expect(live).toMatchObject([{ kind: 'open', name: 'Standup and planning', started_ms: at('10:00') }]);
  expect(live[0].ended_ms).toBeGreaterThanOrEqual(at('11:15'));

  await d.getByTestId('toast-undo').click();
  await expect(d.getByTestId('log-untracked')).toContainText('10:00–11:15');
  expect(blocks(s).filter((b) => b.deleted_ms === null)).toEqual([]);
});

test('asked about all day, a sleep after midnight is a Sleep block, neither work nor break (P105)', async () => {
  s = await launch({ now: '2026-11-24T23:50:00', env: { SPYDER_DEFAULTS: JSON.stringify({ trackFromStartup: true, askReflection: false }) } });
  const d = s.dashboard;
  // The setting: Settings → Blocks & nudges, Work hours (P95) by default.
  await d.evaluate(() => window.spyder.openDashboard('settings'));
  const picker = d.getByTestId('set-asleepScope');
  await expect(picker.locator('[data-value=work_hours]')).toHaveClass(/ring-1/); // the picked one
  await picker.locator('[data-value=all_day]').click();
  await expect.poll(() => s!.db().prepare("SELECT value FROM settings WHERE key = 'asleepScope'").get()).toEqual({ value: '"all_day"' });
  await shot(d, 'settings-asleep-scope');

  await expect.poll(async () => ((await s!.debug.state()).host as { engine: { loop: unknown } }).engine.loop).not.toBeNull();
  await s.debug.simulateSuspend();
  await s.debug.setNow(new Date('2026-11-25T00:43:00').getTime());
  await s.debug.simulateResume();

  // Outside work hours (10:00–17:00), so it's Sleep, asked about on wake with a Sleep button.
  const p = s.prompt.getByTestId('prompt-account');
  await expect(p).toContainText('Computer asleep or off · sleep until answered');
  const sleep = () =>
    s!.db().prepare("SELECT kind, tag, name, started_ms FROM sessions WHERE tag = 'sleep' AND deleted_ms IS NULL ORDER BY started_ms").all() as unknown as {
      kind: string; tag: string; name: string; started_ms: number;
    }[];
  expect(sleep().map((b) => b.started_ms)).toContain(new Date('2026-11-25T00:00:00').getTime());
  await shot(s.prompt, 'prompt-sleep-gap');
  await p.getByLabel('Answer').fill('Slept');
  await p.getByTestId('account-sleep').click();
  await expect.poll(() => sleep().find((b) => b.started_ms === new Date('2026-11-25T00:00:00').getTime())).toMatchObject({ kind: 'break', tag: 'sleep', name: 'Slept' });
  await expect(p).toHaveCount(0);

  // Today: tagged Sleep, in the legend and its own slice, and not counted as break time.
  await d.evaluate(() => window.spyder.openDashboard('today'));
  const row = d.getByTestId('block-log').locator('[data-testid=block-row]', { hasText: 'Slept' });
  await expect(row.getByTestId('block-tag')).toHaveValue('sleep');
  await expect(d.locator('span', { hasText: /^Sleep$/ }).first()).toBeVisible(); // the timeline legend
  await shot(d, 'today-sleep');
  await d.evaluate(() => window.spyder.openDashboard('review'));
  await expect(d.getByTestId('time-split').getByTestId('split-sleep')).toContainText('43m');
  await shot(d, 'review-pie-sleep');
});
