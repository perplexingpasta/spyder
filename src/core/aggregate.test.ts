import { describe, expect, it } from 'vitest';
import { alikeRuns, appKey, appRuns, appSlot, dayLog, daySummary, gaps, neighbours, timeSplit, type DayActivity, type DayData, type DaySession, type LogEntry } from './aggregate';
import type { Rule } from './categorize';
import { DEFAULT_RULES } from './defaults';
import { leftovers } from './review';
import { streak } from './streaks';

// Fixture day: Tue 2026-11-24, work hours 10:00–17:00 (scheduled 7 h = 25 200 s).
const at = (h: number, m = 0, day = 24) => new Date(2026, 10, day, h, m).getTime();
const rules: Rule[] = DEFAULT_RULES.map((r) => ({ ...r, isDefault: true }));
const S = { goalSec: 18_000, appPercentScope: 'work_hours' as const };

const ses = (id: string, kind: DaySession['kind'], name: string | null, startedMs: number, endedMs: number | null, plannedSec: number | null = null): DaySession => ({
  id, kind, name, projectId: null, projectName: null, projectColor: null, plannedSec,
  status: endedMs === null ? 'running' : 'done', startedMs, endedMs, endReason: endedMs === null ? null : 'done',
});
const act = (s: number, e: number, o: Partial<DayActivity>): DayActivity => ({
  startMs: s, endMs: e, exe: 'code.exe', appName: 'VS Code', title: 't', domain: null, browser: null, isPrivate: false, ...o,
});
const yt = { exe: 'chrome.exe', appName: 'Google Chrome', domain: 'youtube.com', browser: 'chrome' as const };

function fixture(): DayData {
  return {
    window: { startMs: at(10), endMs: at(17) },
    nowMs: at(9, 0, 25),
    sessions: [
      ses('F', 'open', 'Night owl', at(23, 0, 23), at(0, 20)), // crosses into the day: 20 min today
      ses('A', 'planned', 'Emails', at(10), at(10, 40), 1800), // 40 min, 10 min over
      ses('B', 'open', 'Coding', at(10, 40), at(13, 30)), // 80 + 60 min
      ses('C', 'break', null, at(12), at(12, 30)), // 30 min break
      ses('D', 'open', null, at(13, 30), at(14)), // 30 min, unlabelled
      ses('E', 'open', 'Late', at(23, 30), at(0, 30, 25)), // crosses midnight: 30 min today
    ],
    segments: [
      { sessionId: 'F', startMs: at(23, 0, 23), endMs: at(0, 20) },
      { sessionId: 'A', startMs: at(10), endMs: at(10, 40) },
      { sessionId: 'B', startMs: at(10, 40), endMs: at(12) },
      { sessionId: 'C', startMs: at(12), endMs: at(12, 30) },
      { sessionId: 'B', startMs: at(12, 30), endMs: at(13, 30) },
      { sessionId: 'D', startMs: at(13, 30), endMs: at(14) },
      { sessionId: 'E', startMs: at(23, 30), endMs: at(0, 30, 25) },
    ],
    away: [
      { id: 'a1', startMs: at(14), endMs: at(14, 30), reason: 'idle', classification: 'meeting', label: null },
      { id: 'a2', startMs: at(14, 30), endMs: at(14, 45), reason: 'idle', classification: 'break', label: null },
      { id: 'a3', startMs: at(14, 45), endMs: at(15), reason: 'lock', classification: 'offline_work', label: 'Sketch' },
      { id: 'a4', startMs: at(15), endMs: at(15, 10), reason: 'idle', classification: 'not_working', label: null },
      { id: 'a5', startMs: at(15, 10), endMs: at(15, 20), reason: 'idle', classification: null, label: null },
      // 'working' is counted through its segment, never as away time.
      { id: 'a6', startMs: at(15, 20), endMs: at(15, 30), reason: 'idle', classification: 'working', label: null },
    ],
    activity: [
      act(at(10), at(10, 40), { exe: 'notepad.exe', appName: 'Notepad' }),
      act(at(10, 40), at(11), {}),
      act(at(11), at(11, 10), { ...yt, title: 'Lofi - YouTube' }), // distracting, in session B
      act(at(11, 10), at(12), {}),
      act(at(12, 5), at(12, 15), { ...yt, title: 'Cats - YouTube' }), // distracting but in a break
      act(at(12, 30), at(12, 40), { exe: 'firefox.exe', appName: 'Firefox', browser: 'firefox', title: 'Some blog post' }),
      act(at(12, 40), at(12, 50), { exe: 'firefox.exe', appName: 'Firefox', browser: 'firefox', title: null, isPrivate: true }),
      act(at(17, 30), at(17, 50), { exe: 'chrome.exe', appName: 'Google Chrome', browser: 'chrome', domain: 'reddit.com' }), // off hours
      act(at(23, 30), at(23, 50), {}), // off hours
      act(at(23, 50), at(0, 10, 25), { exe: 'firefox.exe', appName: 'Firefox', browser: 'firefox', domain: 'youtube.com', title: 'x' }), // 10 min today, in E
    ],
    flags: [
      { tsMs: at(23, 10, 23), target: 'reddit.com', continuousSec: 300, sessionId: 'F' }, // previous day
      { tsMs: at(11, 5), target: 'youtube.com', continuousSec: 300, sessionId: 'B' },
    ],
  };
}

describe('daySummary', () => {
  const d = daySummary('2026-11-24', fixture(), rules, S);

  it('totals', () => {
    expect(d.scheduledSec).toBe(25_200);
    // Segments 20 + 40 + 140 + 30 + 30 = 260 min, plus meeting 30 + offline work 15.
    expect(d.workSec).toBe(305 * 60);
    expect(d.breakSec).toBe(45 * 60); // break session 30 + away break 15
    expect(d.notWorkingSec).toBe(600);
    expect(d.awayPendingSec).toBe(600);
    expect(d.distractingSec).toBe(20 * 60); // 11:00–11:10 in B and 23:50–24:00 in E; the break one doesn't count
    expect(d.productiveSec).toBe(285 * 60);
    // Work ∩ activity: VS Code 70 (in B) + 20 (in E) + Notepad 40 productive; Firefox blog + private 20 neutral; YouTube 20.
    expect(d.workByCategory).toEqual({ productive: 130 * 60, neutral: 20 * 60, distracting: 20 * 60, uncategorized: 0 });
    expect(d.score).toBeCloseTo(17_100 / 25_200, 10);
    expect(d.goalMet).toBe(false);
    expect(daySummary('2026-11-24', fixture(), rules, { ...S, goalSec: 17_100 }).goalMet).toBe(true);
  });

  it('apps table in work-hours scope sums to 100 %', () => {
    expect(d.scope).toBe('work_hours');
    expect(d.apps.map((a) => [a.key, a.sec, Number(a.pct.toFixed(3)), a.category])).toEqual([
      ['VS Code', 4200, 46.667, 'productive'],
      ['Notepad', 2400, 26.667, 'productive'],
      ['youtube.com', 1200, 13.333, 'distracting'],
      ['Firefox: Some blog post', 600, 6.667, 'neutral'],
      ['Private browsing', 600, 6.667, 'neutral'],
    ]);
    expect(Math.abs(d.apps.reduce((t, a) => t + a.pct, 0) - 100)).toBeLessThan(0.1);
    expect(d.apps.find((a) => a.key === 'Private browsing')!.ruleTarget).toBeNull();
    expect(d.apps.find((a) => a.key.startsWith('Firefox:'))!.ruleTarget).toEqual({ matchType: 'title', pattern: 'some blog post' });
    expect(d.apps[0].ruleTarget).toEqual({ matchType: 'app', pattern: 'code.exe' });
    expect(d.categoryTotals).toEqual({ productive: 6600, neutral: 1200, distracting: 1200, uncategorized: 0 });
  });

  it('off-hours activity is excluded from the work-hours scope but reported', () => {
    expect(d.apps.some((a) => a.key === 'reddit.com')).toBe(false);
    expect(d.offHoursActivitySec).toBe(50 * 60); // reddit 20 + code 20 + firefox 10
    const all = daySummary('2026-11-24', fixture(), rules, { ...S, appPercentScope: 'all_day' });
    expect(all.scope).toBe('all_day');
    expect(all.apps.map((a) => [a.key, a.sec])).toEqual([
      ['VS Code', 90 * 60],
      ['Notepad', 40 * 60],
      ['youtube.com', 30 * 60],
      ['reddit.com', 20 * 60],
      ['Firefox: Some blog post', 600],
      ['Private browsing', 600],
    ]);
    expect(Math.abs(all.apps.reduce((t, a) => t + a.pct, 0) - 100)).toBeLessThan(0.1);
  });

  it('Spyder, dev Electron and shell overlays are never counted (P44)', () => {
    const f = fixture();
    const base = daySummary('2026-11-24', f, rules, S);
    f.activity.push(
      act(at(16), at(16, 10), { exe: 'Spyder.exe', appName: 'Spyder' }),
      act(at(16, 10), at(16, 15), { exe: 'electron.exe', appName: 'Electron' }),
      act(at(16, 15), at(16, 16), { exe: 'ScreenClippingHost.exe', appName: 'ScreenClippingHost.exe' }),
    );
    const d2 = daySummary('2026-11-24', f, rules, S);
    expect(d2.apps).toEqual(base.apps);
    expect(d2.categoryTotals).toEqual(base.categoryTotals);
    expect(d2.timeline.activity).toEqual(base.timeline.activity);
  });

  it('a day off uses the whole day as scope and has no score', () => {
    const off = daySummary('2026-11-24', { ...fixture(), window: null }, rules, S);
    expect(off.scheduledSec).toBe(0);
    expect(off.score).toBeNull();
    expect(off.scope).toBe('all_day');
    expect(off.offHoursActivitySec).toBe(off.apps.reduce((t, a) => t + a.sec, 0));
  });

  it('midnight-crossing intervals are split at local midnight', () => {
    const f = d.sessions.find((s) => s.id === 'F')!;
    expect([f.daySec, f.elapsedSec]).toEqual([1200, 4800]);
    const e = d.sessions.find((s) => s.id === 'E')!;
    expect([e.daySec, e.elapsedSec]).toEqual([1800, 3600]);
    const next = daySummary('2026-11-25', fixture(), rules, S);
    expect(next.workSec).toBe(1800); // E's 00:00–00:30
    expect(next.distractingSec).toBe(600); // firefox youtube 00:00–00:10
    expect(next.sessions.map((s) => s.id)).toEqual(['E']);
  });

  it('sessions, flags, unlabelled count', () => {
    expect(d.sessions.map((s) => s.id)).toEqual(['F', 'A', 'B', 'C', 'D', 'E']);
    const a = d.sessions.find((s) => s.id === 'A')!;
    expect([a.elapsedSec, a.plannedSec, a.deltaSec, a.overtimeSec]).toEqual([2400, 1800, 600, 600]);
    expect(d.sessions.find((s) => s.id === 'B')!.deltaSec).toBeNull();
    expect(d.flags.map((f) => f.target)).toEqual(['youtube.com']);
    expect(d.unlabelledCount).toBe(1); // D; C is a break
    expect(leftovers(d)).toBe(2); // D plus the pending away period a5
    expect(d.away).toHaveLength(6);
    expect(d.timeline.segments).toHaveLength(7);
  });

  it('an open segment counts up to now', () => {
    const data: DayData = {
      window: { startMs: at(10), endMs: at(17) },
      nowMs: at(11, 15),
      sessions: [ses('X', 'open', null, at(11), null)],
      segments: [{ sessionId: 'X', startMs: at(11), endMs: null }],
      away: [],
      activity: [],
      flags: [],
    };
    const r = daySummary('2026-11-24', data, rules, S);
    expect(r.workSec).toBe(900);
    expect(r.sessions[0].running).toBe(true);
    expect(r.unlabelledCount).toBe(0); // still running
  });

  it('P68: time split for the pie: work, break, not accounted for, untracked; empty slices dropped', () => {
    expect(timeSplit(d)).toEqual(
      [
        { key: 'work', sec: 305 * 60 - 30 * 60 }, // D (30 min) isn't accounted for yet
        { key: 'break', sec: 45 * 60 },
        { key: 'unanswered', sec: 30 * 60 },
        { key: 'untracked', sec: d.untrackedSec },
      ].filter((x) => x.sec > 0),
    );
    // The running block counts as work, not as a leftover.
    const r = daySummary('2026-11-24', { window: null, nowMs: at(11, 15), sessions: [ses('X', 'open', null, at(11), null)], segments: [{ sessionId: 'X', startMs: at(11), endMs: null }], away: [], activity: [], flags: [] }, rules, S);
    expect(timeSplit(r)).toEqual([{ key: 'work', sec: 900 }]);
  });

  it('appKey', () => {
    expect(appKey(act(0, 1, { browser: 'chrome', domain: null, appName: 'Google Chrome' }))).toBe('Google Chrome');
    expect(appKey(act(0, 1, { browser: 'firefox', exe: 'zen.exe', domain: null, title: 'GetHookd AI' }))).toBe('Zen: GetHookd AI');
    expect(appKey(act(0, 1, { browser: 'firefox', exe: 'firefox.exe', domain: null, title: 'GetHookd AI' }))).toBe('Firefox: GetHookd AI');
  });
});

describe('streak', () => {
  // 2026-11-24 is a Tuesday.
  const days = (met: Record<string, boolean>) => (k: string) => {
    const wd = new Date(`${k}T12:00:00`).getDay();
    return { scheduled: wd >= 1 && wd <= 5, goalMet: met[k] ?? false };
  };
  it('counts met scheduled days and skips weekends', () => {
    const met = { '2026-11-24': true, '2026-11-23': true, '2026-11-20': true, '2026-11-19': true, '2026-11-18': true };
    expect(streak('2026-11-24', days(met))).toBe(5);
  });
  it('a missed weekday breaks it', () => {
    expect(streak('2026-11-24', days({ '2026-11-24': true, '2026-11-20': true }))).toBe(1);
  });
  it('a missed Wednesday breaks it', () => {
    // Mon 23, Tue 24 met; Wed 18 missed; Thu 19, Fri 20 met.
    const met = { '2026-11-24': true, '2026-11-23': true, '2026-11-20': true, '2026-11-19': true };
    expect(streak('2026-11-24', days(met))).toBe(4);
    expect(streak('2026-11-24', days({ ...met, '2026-11-18': true, '2026-11-17': true }))).toBe(6);
  });
  it('today not yet met is skipped', () => {
    expect(streak('2026-11-24', days({ '2026-11-23': true, '2026-11-20': true }))).toBe(2);
  });
  it('caps at 366', () => {
    expect(streak('2026-11-24', () => ({ scheduled: true, goalMet: true }))).toBe(366);
  });
});

describe('untracked time and the day log (P53, P55)', () => {
  it('gaps: the uncovered parts of a range, ignoring slivers under a minute', () => {
    const b = (a: number, z: number) => ({ startMs: a * 60_000, endMs: z * 60_000 });
    expect(gaps(0, 100 * 60_000, [b(10, 20), b(15, 30), b(30.5, 40), b(90, 120)])).toEqual([b(0, 10), b(40, 90)]);
    expect(gaps(0, 10 * 60_000, [])).toEqual([b(0, 10)]);
    expect(gaps(0, 10 * 60_000, [b(-5, 20)])).toEqual([]);
  });

  it('work-hours time with no session and no away period is untracked', () => {
    const d = daySummary('2026-11-24', fixture(), rules, S);
    // Sessions cover 10:00–14:00 and away periods 14:00–15:30; nothing covers 15:30–17:00.
    expect(d.untracked).toEqual([{ startMs: at(15, 30), endMs: at(17), sec: 90 * 60 }]);
    expect(d.untrackedSec).toBe(90 * 60);
  });

  it('a deleted session leaves a gap that is not work time; only time up to now counts', () => {
    const f = fixture();
    f.sessions = f.sessions.filter((x) => x.id !== 'D'); // deleted: its segment is no longer loaded
    f.segments = f.segments.filter((g) => g.sessionId !== 'D');
    f.nowMs = at(16);
    const d = daySummary('2026-11-24', f, rules, S);
    expect(d.untracked.map((u) => [u.startMs, u.endMs])).toEqual([[at(13, 30), at(14)], [at(15, 30), at(16)]]);
    expect(d.workSec).toBe(275 * 60);
    expect(leftovers(d)).toBe(1); // only the pending away period; untracked isn't a leftover
  });

  it('dayLog lists sessions, away periods and untracked spans in time order', () => {
    const d = daySummary('2026-11-24', fixture(), rules, S);
    const log = dayLog(d);
    expect(log.map((e) => e.type)).toEqual([
      'session', 'session', 'session', 'session', 'session',
      'away', 'away', 'away', 'away', 'away', 'away', 'untracked', 'session',
    ]);
    expect(log.map((e) => e.startMs)).toEqual([...log.map((e) => e.startMs)].sort((a, b) => a - b));
  });
});

describe('neighbours and repeats in the day log (P73)', () => {
  const b = (id: string, kind: 'open' | 'break', name: string | null, startMs: number, running = false) =>
    ({ type: 'session', id, kind, tag: kind === 'break' ? 'break' : 'work', name, startMs, endMs: startMs + 900_000, running }) as LogEntry;
  const gap = (startMs: number) => ({ type: 'untracked', startMs, endMs: startMs + 120_000, sec: 120 }) as LogEntry;
  // A 40 s gap between b1 and b2 is too short to show as untracked: they are still neighbours.
  const log = [b('a', 'open', 'code', 0), b('b', 'open', 'code', 900_000), b('b1', 'break', 'breakfast', 1_800_000), b('b2', 'break', 'breakfast', 2_740_000), gap(3_640_000), b('c', 'break', 'breakfast', 3_760_000), b('d', 'open', null, 4_660_000), b('e', 'open', null, 5_560_000)];

  it('blocks with nothing shown between them are neighbours, whatever the gap', () => {
    expect(neighbours(log, ['b1', 'b2'])).toBe(true);
    expect(neighbours(log, ['b2', 'b1', 'b'])).toBe(true);
    expect(neighbours(log, ['b2', 'c'])).toBe(false); // an untracked span between
    expect(neighbours(log, ['a', 'b1'])).toBe(false); // a block between
    expect(neighbours(log, ['a', 'nope'])).toBe(false);
  });

  it('repeats are runs of neighbours with one tag and one answer; unanswered and running blocks never count', () => {
    expect(alikeRuns(log)).toEqual([['a', 'b'], ['b1', 'b2']]);
    expect(alikeRuns([b('x', 'open', 'code', 0), b('y', 'break', 'code', 900_000)])).toEqual([]);
    expect(alikeRuns([b('x', 'open', 'code', 0), b('y', 'open', 'code', 900_000, true)])).toEqual([]);
  });
});

describe('gym and food (P74)', () => {
  it('count as break time, and get their own slices of where the day went', () => {
    const line = (id: string, kind: 'open' | 'break', tag: 'work' | 'break' | 'gym' | 'food', daySec: number) =>
      ({ id, kind, tag, name: kind === 'break' ? 'Break' : 'x', daySec, running: false }) as never;
    const split = timeSplit({
      workSec: 3600,
      breakSec: 3000,
      untrackedSec: 0,
      sessions: [line('w', 'open', 'work', 3600), line('b', 'break', 'break', 600), line('g', 'break', 'gym', 1800), line('f', 'break', 'food', 600)],
    });
    expect(split).toEqual([
      { key: 'work', sec: 3600 },
      { key: 'break', sec: 600 },
      { key: 'gym', sec: 1800 },
      { key: 'food', sec: 600 },
    ]);
  });

  it('a gym block is never joined with a plain break', () => {
    const e = (id: string, tag: 'break' | 'gym', startMs: number) =>
      ({ type: 'session', id, kind: 'break', tag, name: 'Break', startMs, endMs: startMs + 900_000, running: false }) as LogEntry;
    expect(alikeRuns([e('a', 'gym', 0), e('b', 'break', 900_000), e('c', 'gym', 1_800_000), e('d', 'gym', 2_700_000)])).toEqual([['c', 'd']]);
  });

  it('daySummary reads the tag from the stored session', () => {
    const d = fixture();
    d.sessions = d.sessions.map((s) => (s.kind === 'break' ? { ...s, tag: 'food' } : s));
    const s = daySummary('2026-11-24', d, rules, S);
    expect(s.sessions.filter((x) => x.kind === 'break').every((x) => x.tag === 'food')).toBe(true);
    expect(s.sessions.filter((x) => x.kind !== 'break').every((x) => x.tag === 'work')).toBe(true);
  });
});

describe('efficiency (P75)', () => {
  const data = (): DayData => ({
    window: { startMs: at(10), endMs: at(17) },
    nowMs: at(12, 30),
    sessions: [
      { ...ses('A', 'open', 'Deck', at(10), at(11)), efficiency: 50 }, // 60 min at 50%
      { ...ses('B', 'open', 'Emails', at(11), at(11, 30)), efficiency: 100 }, // 30 min at 100%
      ses('C', 'open', 'Calls', at(11, 30), at(11, 45)), // not rated: in neither total
      { ...ses('D', 'break', 'Lunch', at(11, 45), at(12)), efficiency: 25 }, // a break's rating never counts
      ses('R', 'open', null, at(12), null), // running
    ],
    segments: [
      { sessionId: 'A', startMs: at(10), endMs: at(11) },
      { sessionId: 'B', startMs: at(11), endMs: at(11, 30) },
      { sessionId: 'C', startMs: at(11, 30), endMs: at(11, 45) },
      { sessionId: 'D', startMs: at(11, 45), endMs: at(12) },
      { sessionId: 'R', startMs: at(12), endMs: null },
    ],
    away: [],
    activity: [],
    flags: [],
  });

  it('is rated work time weighted by its rating; unrated blocks and breaks count in neither', () => {
    const d = daySummary('2026-11-24', data(), rules, S);
    expect(d.ratedSec).toBe(90 * 60);
    expect(d.effectiveSec).toBe(60 * 60); // 30 min + 30 min
    expect(d.efficiency).toBeCloseTo(2 / 3, 10);
    expect(d.sessions.find((x) => x.id === 'A')?.efficiency).toBe(50);
    expect(d.sessions.find((x) => x.id === 'C')?.efficiency).toBeNull();
  });

  it('is null when nothing is rated', () => {
    const x = data();
    x.sessions = x.sessions.map((s) => ({ ...s, efficiency: null }));
    const d = daySummary('2026-11-24', x, rules, S);
    expect([d.ratedSec, d.effectiveSec, d.efficiency]).toEqual([0, 0, null]);
  });
});

describe('app track (P77)', () => {
  const r = (s: number, e: number, key: string) => ({ startMs: s, endMs: e, key, category: 'neutral' as const });
  const sec = (n: number) => at(10) + n * 1000;

  it('joins back-to-back runs of one key and keeps every switch, however short', () => {
    const out = appRuns([r(sec(0), sec(60), 'VS Code'), r(sec(60), sec(120), 'VS Code'), r(sec(120), sec(122), 'youtube.com'), r(sec(122), sec(200), 'VS Code')]);
    expect(out.map((x) => [x.key, (x.endMs - x.startMs) / 1000])).toEqual([['VS Code', 120], ['youtube.com', 2], ['VS Code', 78]]);
  });

  it('does not join across a gap longer than a sample', () => {
    expect(appRuns([r(sec(0), sec(10), 'A'), r(sec(20), sec(30), 'A')])).toHaveLength(2);
  });

  it('gives every app a colour slot fixed by its name, the same any day (P79)', () => {
    const out = appRuns([r(sec(0), sec(10), 'VS Code'), r(sec(10), sec(20), 'youtube.com'), r(sec(20), sec(900), 'Slack')]);
    expect(out.map((x) => x.slot)).toEqual([appSlot('VS Code'), appSlot('youtube.com'), appSlot('Slack')]);
    expect(appRuns([r(sec(0), sec(5000), 'VS Code')])[0].slot).toBe(appSlot('VS Code')); // rank doesn't change it
    const slots = Array.from({ length: 50 }, (_, i) => appSlot(`app ${i}`));
    expect(slots.every((n) => Number.isInteger(n) && n >= 0 && n < 8)).toBe(true);
    expect(new Set(slots).size).toBe(8); // spread over all 8 colours
  });
});
