// Daily report numbers (plan §10, P25–P27, P30). Everything is clipped to the local day.
import { categorize, type ActivityCategory, type Rule } from './categorize';
import { isIgnoredExe, type MatchType } from './defaults';
import { addDays, dayStartFromKey } from './schedule';
import type { Settings } from './settings';
import { tagOf, type AwayClassification, type AwayReason, type EndReason, type Kind, type SessionStatus, type Tag, type WorkWindow } from './types';

export interface DaySession {
  id: string;
  kind: Kind;
  name: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  plannedSec: number | null;
  status: SessionStatus;
  startedMs: number;
  endedMs: number | null;
  endReason: EndReason | null;
  /** P74: Gym or Food on a break; left out or null otherwise. */
  tag?: 'gym' | 'food' | null;
  /** P75: the user's rating, 0–100 (25/50/75/100 when picked; a merge keeps the mean). Left out or null = not rated. */
  efficiency?: number | null;
}

export interface DaySegment {
  sessionId: string;
  startMs: number;
  endMs: number | null; // null = open, counts up to nowMs
}

export interface DayAway {
  id: string;
  startMs: number;
  endMs: number;
  reason: AwayReason;
  classification: AwayClassification | null;
  label: string | null;
}

export interface DayActivity {
  startMs: number;
  endMs: number;
  exe: string;
  appName: string;
  title: string | null;
  domain: string | null;
  browser: 'chrome' | 'firefox' | 'edge' | null;
  isPrivate: boolean;
}

/** What an activity row is, without its times. */
export type ActivityFacts = Omit<DayActivity, 'startMs' | 'endMs'>;

export interface DayFlag {
  tsMs: number;
  target: string;
  continuousSec: number;
  sessionId: string | null;
}

/** Rows touching the day. Segments must include every segment of the listed sessions. */
export interface DayData {
  sessions: DaySession[];
  segments: DaySegment[];
  away: DayAway[];
  activity: DayActivity[];
  flags: DayFlag[];
  window: WorkWindow | null;
  nowMs: number;
}

export interface AppRow {
  key: string;
  sec: number;
  pct: number;
  category: ActivityCategory;
  /** The rule a category change creates; null when the row can't be ruled (private browsing). */
  ruleTarget: { matchType: MatchType; pattern: string } | null;
}

export interface SessionLine {
  id: string;
  name: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  kind: Kind;
  /** P66, P74: Work, Break, Gym or Food. */
  tag: Tag;
  /** P75: 0–100, or null when not rated. Only counts on work blocks. */
  efficiency: number | null;
  startMs: number;
  endMs: number | null;
  /** Time inside this day. */
  daySec: number;
  /** Whole session (all segments). */
  elapsedSec: number;
  plannedSec: number | null;
  overtimeSec: number;
  deltaSec: number | null;
  running: boolean;
}

export interface Block {
  startMs: number;
  endMs: number;
}

export interface DaySummary {
  date: string;
  dayStartMs: number;
  dayEndMs: number;
  window: WorkWindow | null;
  scheduledSec: number;
  workSec: number;
  breakSec: number;
  notWorkingSec: number;
  awayPendingSec: number;
  distractingSec: number;
  /** Work time split by the category of the activity it overlaps (no activity → none of these). */
  workByCategory: Record<ActivityCategory, number>;
  productiveSec: number;
  score: number | null;
  /** P75: work-block time the user rated, and that time weighted by its rating. */
  ratedSec: number;
  effectiveSec: number;
  /** P75: effectiveSec ÷ ratedSec (0–1), or null when nothing is rated. */
  efficiency: number | null;
  goalSec: number;
  goalMet: boolean;
  scope: 'work_hours' | 'all_day';
  apps: AppRow[];
  categoryTotals: Record<ActivityCategory, number>;
  sessions: SessionLine[];
  away: (DayAway & { sec: number })[];
  flags: DayFlag[];
  offHoursActivitySec: number;
  unlabelledCount: number;
  /** Work-hours time (up to now) covered by no session and no away period, e.g. after a delete (P53). */
  untracked: (Block & { sec: number })[];
  untrackedSec: number;
  timeline: {
    segments: (Block & { sessionId: string; kind: Kind; tag: Tag; name: string | null })[];
    away: (Block & { classification: AwayClassification | null; label: string | null })[];
    activity: (Block & { category: ActivityCategory; key: string })[];
  };
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const sec = (ms: number) => Math.round(ms / 1000);

/** Untracked spans shorter than this are rounding noise between segments, not gaps. */
export const MIN_UNTRACKED_MS = 60_000;

/** The parts of [from, to) not covered by any of `cover`. */
export function gaps(from: number, to: number, cover: Block[], minMs = MIN_UNTRACKED_MS): Block[] {
  const out: Block[] = [];
  let at = from;
  for (const c of [...cover].sort((a, b) => a.startMs - b.startMs)) {
    if (c.endMs <= at) continue;
    if (c.startMs >= to) break;
    if (c.startMs - at >= minMs) out.push({ startMs: at, endMs: c.startMs });
    at = Math.max(at, c.endMs);
  }
  if (to - at >= minMs) out.push({ startMs: at, endMs: to });
  return out;
}

/** Grouping key for the apps & sites table (§10). */
export function appKey(a: ActivityFacts): string {
  if (a.isPrivate) return 'Private browsing';
  if (a.domain) return a.domain;
  if (a.browser === 'firefox' && a.title) return `${a.exe === 'zen.exe' ? 'Zen' : 'Firefox'}: ${a.title}`;
  return a.appName;
}

export function ruleTarget(a: ActivityFacts): AppRow['ruleTarget'] {
  if (a.isPrivate) return null;
  if (a.domain) return { matchType: 'domain', pattern: a.domain.toLowerCase() };
  if (a.browser === 'firefox' && a.title) return { matchType: 'title', pattern: a.title.toLowerCase() };
  return { matchType: 'app', pattern: a.exe.toLowerCase() };
}

export const APP_SLOTS = 8;

/** P79: an app or site's automatic colour slot, fixed by its name so it's the same every day (slots repeat across apps). */
export function appSlot(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % APP_SLOTS;
}

/**
 * P77: the timeline's app track. Back-to-back activity of the same app or site (within one 2 s sample) is one run;
 * every switch stays, however short. Each run carries its key's fixed colour slot (P79).
 */
export function appRuns(acts: DaySummary['timeline']['activity']): (Block & { key: string; category: ActivityCategory; slot: number })[] {
  const runs: (Block & { key: string; category: ActivityCategory })[] = [];
  for (const a of [...acts].sort((p, q) => p.startMs - q.startMs)) {
    const last = runs.at(-1);
    if (last && last.key === a.key && a.startMs - last.endMs <= 2000) last.endMs = Math.max(last.endMs, a.endMs);
    else runs.push({ ...a });
  }
  return runs.map((r) => ({ ...r, slot: appSlot(r.key) }));
}

export function daySummary(
  date: string,
  data: DayData,
  rules: Rule[],
  settings: Pick<Settings, 'goalSec' | 'appPercentScope'>,
): DaySummary {
  const d0 = dayStartFromKey(date);
  const d1 = addDays(d0, 1);
  const win = data.window;
  const kindOf = new Map(data.sessions.map((s) => [s.id, s.kind]));
  const segEnd = (g: DaySegment) => g.endMs ?? Math.max(g.startMs, data.nowMs);

  // Segments clipped to the day.
  const daySegs = data.segments
    .map((g) => ({ ...g, s: Math.max(g.startMs, d0), e: Math.min(segEnd(g), d1) }))
    .filter((g) => g.e > g.s);
  const work = daySegs.filter((g) => kindOf.get(g.sessionId) !== 'break');
  const brk = daySegs.filter((g) => kindOf.get(g.sessionId) === 'break');

  const awayDay = data.away
    .map((a) => ({ ...a, s: Math.max(a.startMs, d0), e: Math.min(a.endMs, d1) }))
    .filter((a) => a.e > a.s);
  const awayMs = (pred: (c: AwayClassification | null) => boolean) =>
    awayDay.filter((a) => pred(a.classification)).reduce((t, a) => t + a.e - a.s, 0);

  const segMs = (gs: typeof daySegs) => gs.reduce((t, g) => t + g.e - g.s, 0);
  const workMs = segMs(work) + awayMs((c) => c === 'meeting' || c === 'offline_work');
  const breakMs = segMs(brk) + awayMs((c) => c === 'break');

  const acts = data.activity
    .filter((a) => !isIgnoredExe(a.exe))
    .map((a) => ({ a, s: Math.max(a.startMs, d0), e: Math.min(a.endMs, d1), cat: categorize(a, rules) }))
    .filter((x) => x.e > x.s);

  const workCatMs: Record<ActivityCategory, number> = { productive: 0, neutral: 0, distracting: 0, uncategorized: 0 };
  for (const x of acts) for (const g of work) workCatMs[x.cat] += overlap(x.s, x.e, g.s, g.e);

  const workSec = sec(workMs);
  const distractingSec = sec(workCatMs.distracting);
  const productiveSec = workSec - distractingSec;
  const scheduledSec = win ? sec(Math.min(win.endMs, d1) - Math.max(win.startMs, d0)) : 0;

  // Apps & sites in scope.
  const scope: DaySummary['scope'] = settings.appPercentScope === 'work_hours' && win ? 'work_hours' : 'all_day';
  const [s0, s1] = scope === 'work_hours' && win ? [win.startMs, win.endMs] : [d0, d1];
  const groups = new Map<string, { ms: number; byCat: Map<ActivityCategory, number>; target: AppRow['ruleTarget'] }>();
  const categoryMs: Record<ActivityCategory, number> = { productive: 0, neutral: 0, distracting: 0, uncategorized: 0 };
  let offHoursMs = 0;
  for (const x of acts) {
    offHoursMs += x.e - x.s - (win ? overlap(x.s, x.e, win.startMs, win.endMs) : 0);
    const ms = overlap(x.s, x.e, s0, s1);
    if (ms <= 0) continue;
    const key = appKey(x.a);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ms: 0, byCat: new Map(), target: ruleTarget(x.a) }));
    g.ms += ms;
    g.byCat.set(x.cat, (g.byCat.get(x.cat) ?? 0) + ms);
    categoryMs[x.cat] += ms;
  }
  const totalMs = [...groups.values()].reduce((t, g) => t + g.ms, 0);
  const apps: AppRow[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      sec: sec(g.ms),
      pct: totalMs > 0 ? (g.ms / totalMs) * 100 : 0,
      // A group can mix categories (title rules); show the one with the most time.
      category: [...g.byCat.entries()].sort((a, b) => b[1] - a[1])[0][0],
      ruleTarget: g.target,
    }))
    .sort((a, b) => b.sec - a.sec || a.key.localeCompare(b.key));

  // Sessions touching the day.
  const sessions: SessionLine[] = data.sessions
    .map((s) => {
      const segs = data.segments.filter((g) => g.sessionId === s.id);
      const elapsedSec = sec(segs.reduce((t, g) => t + segEnd(g) - g.startMs, 0));
      const daySec = sec(daySegs.filter((g) => g.sessionId === s.id).reduce((t, g) => t + g.e - g.s, 0));
      const deltaSec = s.plannedSec !== null ? elapsedSec - s.plannedSec : null;
      return {
        id: s.id,
        name: s.name,
        projectId: s.projectId,
        projectName: s.projectName,
        projectColor: s.projectColor,
        kind: s.kind,
        tag: tagOf(s),
        efficiency: s.efficiency ?? null,
        startMs: s.startedMs,
        endMs: s.endedMs,
        daySec,
        elapsedSec,
        plannedSec: s.plannedSec,
        overtimeSec: Math.max(0, deltaSec ?? 0),
        deltaSec,
        running: s.endedMs === null,
      };
    })
    .filter((s) => s.daySec > 0 || (s.startMs >= d0 && s.startMs < d1))
    .sort((a, b) => a.startMs - b.startMs);

  const { ratedSec, effectiveSec } = rated(sessions);

  const untracked = win
    ? gaps(
        Math.max(win.startMs, d0),
        Math.min(win.endMs, d1, data.nowMs),
        [...daySegs.map((g) => ({ startMs: g.s, endMs: g.e })), ...awayDay.map((a) => ({ startMs: a.s, endMs: a.e }))],
      ).map((b) => ({ ...b, sec: sec(b.endMs - b.startMs) }))
    : [];

  return {
    date,
    dayStartMs: d0,
    dayEndMs: d1,
    window: win,
    scheduledSec,
    workSec,
    breakSec: sec(breakMs),
    notWorkingSec: sec(awayMs((c) => c === 'not_working')),
    awayPendingSec: sec(awayMs((c) => c === null)),
    distractingSec,
    workByCategory: {
      productive: sec(workCatMs.productive),
      neutral: sec(workCatMs.neutral),
      distracting: distractingSec,
      uncategorized: sec(workCatMs.uncategorized),
    },
    productiveSec,
    score: scheduledSec > 0 ? productiveSec / scheduledSec : null,
    ratedSec,
    effectiveSec,
    efficiency: ratedSec > 0 ? effectiveSec / ratedSec : null,
    goalSec: settings.goalSec,
    goalMet: productiveSec >= settings.goalSec,
    scope,
    apps,
    categoryTotals: {
      productive: sec(categoryMs.productive),
      neutral: sec(categoryMs.neutral),
      distracting: sec(categoryMs.distracting),
      uncategorized: sec(categoryMs.uncategorized),
    },
    sessions,
    away: awayDay
      .map(({ s, e, ...a }) => ({ ...a, startMs: s, endMs: e, sec: sec(e - s) }))
      .sort((a, b) => a.startMs - b.startMs),
    flags: data.flags.filter((f) => f.tsMs >= d0 && f.tsMs < d1).sort((a, b) => a.tsMs - b.tsMs),
    offHoursActivitySec: sec(offHoursMs),
    unlabelledCount: sessions.filter((s) => s.name === null && s.kind !== 'break' && !s.running).length,
    untracked,
    untrackedSec: untracked.reduce((t, b) => t + b.sec, 0),
    timeline: {
      segments: daySegs
        .map((g) => {
          const s = data.sessions.find((x) => x.id === g.sessionId);
          return { sessionId: g.sessionId, kind: s?.kind ?? 'open', tag: s ? tagOf(s) : 'work', name: s?.name ?? null, startMs: g.s, endMs: g.e };
        })
        .sort((a, b) => a.startMs - b.startMs),
      away: awayDay.map((a) => ({ startMs: a.s, endMs: a.e, classification: a.classification, label: a.label })),
      activity: acts.map((x) => ({ startMs: x.s, endMs: x.e, category: x.cat, key: appKey(x.a) })),
    },
  };
}

/**
 * P75: work blocks the user rated (their time in this day) and that time weighted by the rating. Unrated blocks
 * count in neither, so nothing is guessed for them.
 */
export function rated(sessions: Pick<SessionLine, 'tag' | 'efficiency' | 'daySec'>[]): { ratedSec: number; effectiveSec: number } {
  const xs = sessions.filter((x) => x.tag === 'work' && x.efficiency !== null);
  return {
    ratedSec: xs.reduce((t, x) => t + x.daySec, 0),
    effectiveSec: Math.round(xs.reduce((t, x) => t + (x.daySec * x.efficiency!) / 100, 0)),
  };
}

export type TimeSplitKey = 'work' | 'break' | 'gym' | 'food' | 'unanswered' | 'untracked';

/**
 * Where the day's time went (P68, P74): work blocks, breaks, gym, food, ended work blocks not accounted for,
 * untracked. Empty parts are dropped.
 */
export function timeSplit(s: Pick<DaySummary, 'workSec' | 'breakSec' | 'untrackedSec' | 'sessions'>): { key: TimeSplitKey; sec: number }[] {
  const unanswered = s.sessions.filter((x) => x.kind !== 'break' && x.name === null && !x.running).reduce((t, x) => t + x.daySec, 0);
  const tagged = (t: Tag) => s.sessions.filter((x) => x.tag === t).reduce((n, x) => n + x.daySec, 0);
  const gym = tagged('gym');
  const food = tagged('food');
  const parts: { key: TimeSplitKey; sec: number }[] = [
    { key: 'work', sec: s.workSec - unanswered },
    { key: 'break', sec: s.breakSec - gym - food },
    { key: 'gym', sec: gym },
    { key: 'food', sec: food },
    { key: 'unanswered', sec: unanswered },
    { key: 'untracked', sec: s.untrackedSec },
  ];
  return parts.filter((p) => p.sec > 0);
}

/** One line of Today's session log (P55): every part of the day in time order. */
export type LogEntry =
  | ({ type: 'session' } & SessionLine)
  | ({ type: 'away' } & DaySummary['away'][number])
  | ({ type: 'untracked' } & Block & { sec: number });

export function dayLog(s: Pick<DaySummary, 'sessions' | 'away' | 'untracked'>): LogEntry[] {
  return [
    ...s.sessions.map((x) => ({ type: 'session' as const, ...x })),
    ...s.away.map((x) => ({ type: 'away' as const, ...x })),
    ...s.untracked.map((x) => ({ type: 'untracked' as const, ...x })),
  ].sort((a, b) => a.startMs - b.startMs);
}

/** P73: blocks are neighbours when nothing sits between them in the log (no other block, away time or untracked span). */
export function neighbours(log: LogEntry[], ids: string[]): boolean {
  const at = ids.map((id) => log.findIndex((e) => e.type === 'session' && e.id === id)).sort((a, b) => a - b);
  return at[0] >= 0 && at.every((i, k) => k === 0 || i === at[k - 1] + 1);
}

/** P73: runs of two or more ended neighbours with the same tag and the same answer, in time order. */
export function alikeRuns(log: LogEntry[]): string[][] {
  const runs: string[][] = [];
  let prev: SessionLine | null = null;
  for (const e of log) {
    const x = e.type === 'session' && !e.running && e.name !== null ? e : null;
    if (x && prev && x.tag === prev.tag && x.name === prev.name) runs[runs.length - 1].push(x.id);
    else if (x) runs.push([x.id]);
    prev = x;
  }
  return runs.filter((r) => r.length > 1);
}
