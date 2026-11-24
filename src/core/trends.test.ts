import { describe, expect, it } from 'vitest';
import { daySummary, type DayData } from './aggregate';
import type { Rule } from './categorize';
import { DEFAULT_RULES } from './defaults';
import { cleanSettings, DEFAULT_SETTINGS } from './settings';
import { relabelFirefox } from './titlePatterns';
import { addMonths, dayEfficiency, dayLite, estimates, monthDates, rangeStats, stackTotal, topApps, weekDates, weekStart, type DayLite } from './trends';

const at = (h: number, m = 0, day = 24) => new Date(2026, 10, day, h, m).getTime();
const rules: Rule[] = DEFAULT_RULES.map((r) => ({ ...r, isDefault: true }));
const S = { goalSec: 3600, appPercentScope: 'work_hours' as const };

function day(dd: number, opts: { window?: boolean; workMin?: number; yt?: boolean } = {}): DayData {
  const { window = true, workMin = 120, yt = false } = opts;
  const s0 = at(10, 0, dd);
  const s1 = s0 + workMin * 60_000;
  return {
    window: window ? { startMs: at(10, 0, dd), endMs: at(17, 0, dd) } : null,
    nowMs: at(23, 0, 30),
    sessions: [
      { id: `p${dd}`, kind: 'planned', name: 'Plan', projectId: null, projectName: null, projectColor: null, plannedSec: 3600, status: 'done', startedMs: s0, endedMs: s1, endReason: 'done' },
      { id: `b${dd}`, kind: 'break', name: null, projectId: null, projectName: null, projectColor: null, plannedSec: 900, status: 'done', startedMs: s1, endedMs: s1 + 900_000, endReason: 'done' },
    ],
    segments: [
      { sessionId: `p${dd}`, startMs: s0, endMs: s1 },
      { sessionId: `b${dd}`, startMs: s1, endMs: s1 + 900_000 },
    ],
    away: [{ id: `a${dd}`, startMs: at(16, 0, dd), endMs: at(16, 10, dd), reason: 'idle', classification: 'not_working', label: null }],
    activity: [
      { startMs: s0, endMs: s0 + 1_800_000, exe: 'code.exe', appName: 'VS Code', title: 't', domain: null, browser: null, isPrivate: false },
      ...(yt
        ? [{ startMs: s0 + 1_800_000, endMs: s0 + 2_400_000, exe: 'chrome.exe', appName: 'Chrome', title: 'x', domain: 'youtube.com', browser: 'chrome' as const, isPrivate: false }]
        : []),
      { startMs: s0 + 2_400_000, endMs: s0 + 3_000_000, exe: 'slack.exe', appName: 'Slack', title: 's', domain: null, browser: null, isPrivate: false },
    ],
    flags: [],
  };
}
const lite = (dd: number, o?: Parameters<typeof day>[1], today = '2026-11-30'): DayLite =>
  dayLite(daySummary(`2026-11-${dd}`, day(dd, o), rules, S), today);

describe('trends', () => {
  it('day stacks split work by category and add break and away', () => {
    const d = lite(24, { yt: true });
    // 120 min work: VS Code 30, YouTube 10, Slack 10 → productive = 120 − 10 − 10.
    expect(d.stacks).toEqual({ productive: 100 * 60, neutral: 600, distracting: 600, uncategorized: 0, break: 900, away: 600 });
    expect(stackTotal(d.stacks)).toBe(d.workSec + 900 + 600);
    expect(d.productiveSec).toBe(110 * 60);
    expect(d.planned).toEqual([{ id: 'p24', name: 'Plan', plannedSec: 3600, actualSec: 7200, deltaSec: 3600, startMs: at(10, 0, 24) }]);
  });

  it('range efficiency weights every rated minute alike (P75)', () => {
    const r = rangeStats([
      { ...lite(23), ratedSec: 3600, effectiveSec: 3600 },
      { ...lite(24), ratedSec: 3 * 3600, effectiveSec: 3600 },
      { ...lite(26, {}, '2026-11-25'), ratedSec: 3600, effectiveSec: 0 }, // future: left out
    ]);
    expect([r.ratedSec, r.effectiveSec, r.efficiency]).toEqual([4 * 3600, 2 * 3600, 0.5]);
    expect(dayEfficiency({ ratedSec: 0, effectiveSec: 0 })).toBeNull();
    expect(rangeStats([lite(24)]).efficiency).toBeNull();
  });

  it('range stats count scheduled days up to today only', () => {
    const days = [lite(23, { workMin: 30 }), lite(24), lite(25, { window: false }), lite(26, {}, '2026-11-25')];
    expect(days[3].future).toBe(true);
    const r = rangeStats(days);
    expect([r.goalsHit, r.goalDays]).toEqual([1, 2]);
    expect(r.workSec).toBe(days[0].workSec + days[1].workSec + days[2].workSec);
    expect(r.avgScore).toBeCloseTo(((30 * 60) / 25_200 + 7200 / 25_200) / 2, 10);
    expect(rangeStats([lite(25, { window: false })]).avgScore).toBeNull();
  });

  it('top apps merges days and estimates lists planned sessions', () => {
    const days = [lite(23, { yt: true }), lite(24)];
    const t = topApps(days, 2);
    expect(t.map((a) => [a.key, a.sec])).toEqual([['VS Code', 3600], ['Slack', 1200]]);
    expect(topApps(days, 10).reduce((s, a) => s + a.pct, 0)).toBeCloseTo(100, 6);
    const e = estimates(days);
    expect(e.rows.map((r) => r.id)).toEqual(['p23', 'p24']);
    expect([e.plannedSec, e.actualSec]).toEqual([7200, 14_400]);
  });

  it('calendar helpers', () => {
    expect(weekStart('2026-11-24')).toBe('2026-11-23');
    expect(weekStart('2026-11-29')).toBe('2026-11-23'); // Sunday
    expect(weekDates('2026-11-23')).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(monthDates('2026-02-10')).toHaveLength(28);
    expect(monthDates('2026-11-24').at(-1)).toBe('2026-11-30');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('relabelFirefox', () => {
  const row = (o: object) => ({ browser: 'firefox', domain: null, title: 'Ask HN: anything | Hacker News', isPrivate: false, ...o });
  const pats = [{ match: 'contains' as const, pattern: 'Hacker News', domain: 'news.ycombinator.com' }];
  it('labels unmatched Firefox rows and leaves the rest', () => {
    const out = relabelFirefox([row({}), row({ domain: 'x.com' }), row({ browser: 'chrome' }), row({ isPrivate: true }), row({ title: 'Other' })], pats);
    expect(out.map((r) => r.domain)).toEqual(['news.ycombinator.com', 'x.com', null, null, null]);
  });
});

describe('cleanSettings', () => {
  it('keeps valid values, clamps numbers, drops the rest', () => {
    expect(
      cleanSettings({
        idleThresholdSec: 10, blockLengthSec: 600.4, goalSec: 'x', appPercentScope: 'bad',
        theme: 'dark', hotkey: ' Control+Alt+K ', autostart: false, widgetPos: { x: 1, y: 2 }, nope: 1,
      }),
    ).toEqual({
      idleThresholdSec: 60, blockLengthSec: 600, theme: 'dark',
      hotkey: 'Control+Alt+K', autostart: false, widgetPos: { x: 1, y: 2 },
    });
    expect(cleanSettings({ hotkey: '  ', widgetPos: null, autostart: 'yes' })).toEqual({ widgetPos: null });
    expect(Object.keys(cleanSettings({ ...DEFAULT_SETTINGS }))).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);
  });

  it('P67: the work colour is a #rrggbb hex, green by default', () => {
    expect(DEFAULT_SETTINGS.workColor).toBe('#3fb27f');
    expect(cleanSettings({ workColor: '#AB12cd' })).toEqual({ workColor: '#ab12cd' });
    expect(cleanSettings({ workColor: 'red' })).toEqual({});
    expect(cleanSettings({ workColor: '#abc' })).toEqual({});
    expect(cleanSettings({ workColor: 42 })).toEqual({});
  });

  it('P78: the font is System or Atkinson Hyperlegible', () => {
    expect(DEFAULT_SETTINGS.font).toBe('system');
    expect(cleanSettings({ font: 'atkinson' })).toEqual({ font: 'atkinson' });
    expect(cleanSettings({ font: 'Comic Sans' })).toEqual({});
  });

  it('P79: app colours map app keys to #rrggbb, dropping bad entries; colours may repeat', () => {
    expect(DEFAULT_SETTINGS.appColors).toEqual({});
    expect(cleanSettings({ appColors: { 'VS Code': '#AA0000', 'youtube.com': '#aa0000', Slack: 'red', ' ': '#000000' } })).toEqual({
      appColors: { 'VS Code': '#aa0000', 'youtube.com': '#aa0000' },
    });
    expect(cleanSettings({ appColors: ['#aa0000'] })).toEqual({});
    expect(cleanSettings({ appColors: null })).toEqual({});
  });

  it('P50: the widget style setting is gone', () => {
    expect(cleanSettings({ widgetStyle: 'compact', theme: 'sepia' })).toEqual({});
  });

  it('P59: blocks default to 15 min and stay between 5 min and 3 h; the old session settings are gone', () => {
    expect(DEFAULT_SETTINGS.blockLengthSec).toBe(900);
    expect(cleanSettings({ blockLengthSec: 60 })).toEqual({ blockLengthSec: 300 });
    expect(cleanSettings({ blockLengthSec: 4 * 3600 })).toEqual({ blockLengthSec: 10_800 });
    expect(cleanSettings({ blockLengthSec: 1800 })).toEqual({ blockLengthSec: 1800 });
    expect(cleanSettings({ checkInIntervalSec: 600, nagIntervalSec: 60, defaultDirection: 'up', shortAwayIgnoreSec: 5 })).toEqual({});
  });
});
