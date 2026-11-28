/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { DEFAULT_RULES, DEFAULT_TITLE_PATTERNS } from '../../src/core/defaults';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { launch, shot, type Launched } from './helpers';

const TABLES = [
  'schema_migrations', 'projects', 'sessions', 'segments', 'away_periods', 'activity', 'distraction_flags',
  'rules', 'title_patterns', 'schedule', 'day_overrides', 'reviews', 'review_items', 'kpis', 'kpi_values',
  'settings', 'heartbeat', 'gadget_rows',
];

let s: Launched;
test.beforeAll(async () => {
  s = await launch({ env: { SPYDER_DEFAULTS: '{}' } }); // the real first-run defaults (P82)
});
test.afterAll(async () => {
  await s?.close();
});

test('widget and dashboard windows exist', async () => {
  expect(s.widget.url()).toContain('#/widget');
  expect(s.dashboard.url()).toContain('#/dashboard');
  const st = await s.debug.state();
  expect(st.dataDir).toBe(s.dataDir);
  expect(Number(String(st.nodeVersion).split('.')[0])).toBeGreaterThanOrEqual(22);
});

test('tray exists', async () => {
  const t = await s.debug.trayInfo();
  expect(t.exists).toBe(true);
  expect(t.menu).toEqual(['Show widget', "Show How I'll improve", 'Open dashboard', 'Start', 'Quit']);
});

test('every table exists', async () => {
  const names = (s.db().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
    (r) => r.name,
  );
  for (const t of TABLES) expect(names).toContain(t);
});

test('defaults are seeded', async () => {
  const db = s.db();
  const sched = db.prepare('SELECT * FROM schedule ORDER BY weekday').all() as Record<string, number>[];
  expect(sched).toHaveLength(7);
  expect(sched.map((r) => r.enabled)).toEqual([0, 1, 1, 1, 1, 1, 0]);
  expect(sched.every((r) => r.start_min === 600 && r.end_min === 1020)).toBe(true);

  const settings = Object.fromEntries(
    (db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]).map((r) => [
      r.key,
      JSON.parse(r.value),
    ]),
  );
  expect(settings).toEqual(DEFAULT_SETTINGS);

  const rules = db.prepare('SELECT COUNT(*) AS n FROM rules WHERE is_default = 1').get() as { n: number };
  expect(rules.n).toBe(DEFAULT_RULES.length);
  const yt = db.prepare("SELECT category FROM rules WHERE match_type='domain' AND pattern='youtube.com'").get() as {
    category: string;
  };
  expect(yt.category).toBe('distracting');
  const tp = db.prepare('SELECT COUNT(*) AS n FROM title_patterns WHERE is_default = 1').get() as { n: number };
  expect(tp.n).toBe(DEFAULT_TITLE_PATTERNS.length);
});

test('screenshots', async () => {
  await s.widget.waitForTimeout(500);
  await shot(s.widget, 'smoke-widget');
  await s.widget.evaluate(() => window.spyder.openDashboard('today'));
  await s.dashboard.waitForTimeout(500);
  await shot(s.dashboard, 'smoke-dashboard');
});
