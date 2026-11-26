// Block engine: a pure reducer (ADR-0006, ADR-0011, P58–P63). The user presses Start with a block
// length; each block runs for that length and the next one starts the moment it ends. Answers are
// written by the host straight to the DB (they don't change the loop), so the engine only runs blocks,
// the start reminder, the end of work hours and away hints.
import { addDays, dateKey, inWork, minutesOfDay, startOfDay, workdayPct } from './schedule';
import type { Ctx, Effect, EngineError, EngineEvent, EngineState, Loop, ReduceResult, RunningBlock } from './types';

export const HEARTBEAT_EVERY_MS = 15_000;
/** A restart within this long (e.g. the auto-install) carries the loop on (P61). */
export const FRESH_HEARTBEAT_MS = 60_000;
export const MIN_BLOCK_SEC = 300;
export const MAX_BLOCK_SEC = 10_800;
/** P95: the answer a block over time Spyder was asleep or off starts with. */
export const GAP_ANSWER = 'Computer asleep or off';
/** P95: shorter stretches of a gap aren't worth a block. */
export const GAP_MIN_MS = 60_000;

export function initialState(): EngineState {
  return {
    mode: 'off_hours',
    loop: null,
    cut: null,
    reminder: false,
    lastReminderMs: null,
    away: null,
    reviewOpenedFor: null,
    lastHeartbeatMs: null,
  };
}

/** Mutable working copy plus effect list for one reduce call. */
class Run {
  readonly effects: Effect[] = [];
  error?: EngineError;
  readonly st: EngineState;
  readonly ctx: Ctx;
  constructor(st: EngineState, ctx: Ctx) {
    this.st = st;
    this.ctx = ctx;
  }

  get now() {
    return this.ctx.now;
  }
  emit(e: Effect) {
    this.effects.push(e);
  }
  fail(message: string) {
    this.error = { error: 'invalid', message };
  }

  startBlock(at: number, lengthSec: number): RunningBlock {
    const b: RunningBlock = { id: this.ctx.newId(), startedMs: at, lengthSec, segmentId: this.ctx.newId() };
    this.emit({
      db: 'insertSession',
      row: { id: b.id, kind: 'open', name: null, projectId: null, plannedSec: null, direction: null, status: 'running', startedMs: at, createdMs: this.now },
    });
    this.emit({ db: 'openSegment', row: { id: b.segmentId, sessionId: b.id, startMs: at, source: 'live' } });
    return b;
  }

  /** Ends a block at `at`; a block under a second is discarded instead of being asked about. */
  closeBlock(b: RunningBlock, at: number) {
    const end = Math.max(at, b.startedMs);
    if (end - b.startedMs < 1000) {
      this.emit({ db: 'discardSession', id: b.id });
      return;
    }
    this.emit({ db: 'closeSegment', row: { id: b.segmentId, endMs: end } });
    this.emit({
      db: 'updateSession',
      row: { id: b.id, status: 'done', endedMs: end, elapsedSec: Math.round((end - b.startedMs) / 1000), overtimeSec: 0, endReason: 'done' },
    });
    this.emit({ blockEnded: b.id });
  }

  openReview(date: string) {
    if (this.st.reviewOpenedFor === date) return;
    this.st.reviewOpenedFor = date;
    this.emit({ openReview: date });
  }

  heartbeat() {
    this.st.lastHeartbeatMs = this.now;
    this.emit({ saveHeartbeat: true });
  }
}

export function reduce(state: EngineState, event: EngineEvent, ctx: Ctx): ReduceResult {
  const r = new Run(structuredClone(state), ctx);
  apply(r, event);
  return r.error ? { state, effects: [], error: r.error } : { state: r.st, effects: r.effects };
}

function apply(r: Run, ev: EngineEvent): void {
  switch (ev.type) {
    case 'BOOT':
      return boot(r, ev.heartbeat);
    case 'TICK':
    case 'SCHEDULE_CHANGED':
      return tick(r);
    case 'START':
      return start(r, ev.lengthSec);
    case 'STOP':
      return stop(r);
    case 'SET_LENGTH':
      if (!validLength(ev.lengthSec)) return r.fail('Blocks are 5 to 180 minutes');
      if (r.st.loop) r.st.loop.lengthSec = ev.lengthSec;
      return;
    case 'DISMISS_REMINDER':
      r.st.reminder = false;
      r.st.lastReminderMs = r.now;
      return;
    case 'KEEP_WORKING':
      return keepWorking(r);
    case 'AWAY_BEGIN':
      // P76: with Track from startup, sleep ends the loop like a shutdown, even after a lock.
      if (ev.reason === 'suspend' && fromStartup(r)) return sleep(r, Math.min(ev.atMs, r.now));
      if (!r.st.away) r.st.away = { startMs: Math.min(ev.atMs, r.now), reason: ev.reason };
      return;
    case 'AWAY_END': {
      const a = r.st.away;
      if (!a) return;
      r.st.away = null;
      r.emit({ awayEnded: { startMs: a.startMs, endMs: r.now } });
      if (a.reason === 'suspend' && fromStartup(r)) {
        fillGap(r, a.startMs, r.now);
        autoStart(r, a.startMs);
      }
      return;
    }
  }
}

const validLength = (sec: number) => Number.isInteger(sec) && sec >= MIN_BLOCK_SEC && sec <= MAX_BLOCK_SEC;

/** Restores the saved state. Spyder not running stops the loop at the last heartbeat (P61). */
function boot(r: Run, hb: { tsMs: number; state: EngineState } | null): void {
  // A heartbeat from before blocks (ADR-0011) has no `loop`; migration 003 already closed its session.
  if (hb && 'loop' in hb.state) {
    Object.assign(r.st, structuredClone(hb.state), { away: null, lastHeartbeatMs: hb.tsMs });
    const loop = r.st.loop;
    if (loop && r.now - hb.tsMs > FRESH_HEARTBEAT_MS) {
      // Blocks that had already ended before Spyder stopped are still theirs; the rest is untracked.
      rollTo(r, loop, hb.tsMs);
      r.closeBlock(loop.block, hb.tsMs);
      fillGap(r, hb.tsMs, r.now);
      r.st.loop = null;
      r.st.lastReminderMs = null;
    }
  }
  tick(r);
  if (fromStartup(r)) autoStart(r, hb?.tsMs ?? null);
}

/** P76: the loop runs from launch or wake to shutdown or sleep, ignoring work hours. */
const fromStartup = (r: Run) => r.ctx.settings.trackFromStartup;

/** P76: starts the loop if it isn't running; the first start on a new day reviews the last day Spyder ran. */
function autoStart(r: Run, prevAliveMs: number | null): void {
  if (prevAliveMs !== null && dateKey(prevAliveMs) !== dateKey(r.now)) r.openReview(dateKey(prevAliveMs));
  if (!r.st.loop) start(r, r.ctx.settings.blockLengthSec);
}

/** Ends the loop at `at`: blocks that ended before it stay, the cut block is asked about. */
function endLoop(r: Run, loop: Loop, at: number): void {
  rollTo(r, loop, at);
  r.closeBlock(loop.block, at);
  r.st.loop = null;
}

/** P76: sleep ends the loop at its start; waking starts a fresh one. */
function sleep(r: Run, at: number): void {
  if (r.st.loop) endLoop(r, r.st.loop, at);
  r.st.away = { startMs: at, reason: 'suspend' };
  r.heartbeat();
}

/**
 * P95: the work hours between `from` and `to` (Spyder asleep or off while the loop ran) become break blocks, one per
 * day, which the prompt asks about on return. Time outside work hours stays untracked, unless Settings asks about
 * the whole day (P105): then it becomes Sleep blocks too, one for each stretch of a day outside its work hours.
 */
function fillGap(r: Run, from: number, to: number): void {
  const allDay = r.ctx.settings.asleepScope === 'all_day';
  for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
    const next = addDays(day, 1);
    const w = r.ctx.window(day);
    const parts: { startMs: number; endMs: number; tag: 'break' | 'sleep' }[] = [];
    if (w) parts.push({ startMs: w.startMs, endMs: w.endMs, tag: 'break' });
    if (allDay) {
      if (!w) parts.push({ startMs: day, endMs: next, tag: 'sleep' });
      else parts.push({ startMs: day, endMs: w.startMs, tag: 'sleep' }, { startMs: w.endMs, endMs: next, tag: 'sleep' });
    }
    for (const p of parts.sort((a, b) => a.startMs - b.startMs)) {
      const startMs = Math.max(from, p.startMs);
      const endMs = Math.min(to, p.endMs);
      if (endMs - startMs < GAP_MIN_MS) continue;
      r.emit({ db: 'insertGapBlock', row: { id: r.ctx.newId(), segmentId: r.ctx.newId(), startMs, endMs, name: GAP_ANSWER, tag: p.tag, createdMs: r.now } });
    }
  }
}

/** Ends every block whose time is up by `limit`, starting the next at each boundary. */
function rollTo(r: Run, loop: Loop, limit: number): void {
  for (;;) {
    const b = loop.block;
    const end = b.startedMs + b.lengthSec * 1000;
    if (end > limit) return;
    r.closeBlock(b, end);
    loop.block = r.startBlock(end, loop.lengthSec);
  }
}

function tick(r: Run): void {
  const st = r.st;
  const now = r.now;
  const win = r.ctx.window(now);
  const working = inWork(now, win);
  let loop = st.loop;

  if (loop && fromStartup(r)) {
    const last = st.lastHeartbeatMs;
    if (last !== null && now - last > FRESH_HEARTBEAT_MS) {
      // P76: a sleep Spyder wasn't told about (no heartbeat for a minute) ends the loop like one it was.
      endLoop(r, loop, last);
      fillGap(r, last, now);
      autoStart(r, last);
    } else if (loop.block.startedMs < startOfDay(now)) {
      // P76: each day stands on its own: the block running at midnight is cut there.
      const midnight = startOfDay(now);
      rollTo(r, loop, midnight);
      r.closeBlock(loop.block, midnight);
      loop.block = r.startBlock(midnight, loop.lengthSec);
    }
    loop = st.loop;
  }

  if (loop) {
    // A loop started in work hours stops at their end (P59, P62); never with Track from startup (P76).
    let stopAt: number | null = null;
    if (!loop.untilStop && !working && !fromStartup(r)) {
      const dayWin = r.ctx.window(loop.block.startedMs);
      stopAt = dayWin && dayWin.endMs <= now ? Math.max(dayWin.endMs, loop.block.startedMs) : now;
    }
    rollTo(r, loop, stopAt ?? now);
    if (stopAt !== null) {
      r.closeBlock(loop.block, stopAt);
      st.cut = { lengthSec: loop.lengthSec, atMs: stopAt };
      st.loop = null;
    }
  }

  if (working && st.mode === 'off_hours') {
    st.mode = 'working';
    st.lastReminderMs = null;
    r.heartbeat();
  } else if (!working && st.mode === 'working') {
    st.mode = 'off_hours';
    st.reminder = false;
    // The day that just ended: where the loop was cut, else the last moment seen in work hours.
    // With Track from startup the review waits for the next day's first start (P76).
    if (!fromStartup(r)) r.openReview(dateKey(st.cut?.atMs ?? st.lastHeartbeatMs ?? now));
    r.heartbeat();
  }

  // Start reminder: every block length while work hours run with no loop (P59).
  if (st.mode === 'working' && !st.loop && !st.reminder && !fromStartup(r)) {
    if (st.lastReminderMs === null || now - st.lastReminderMs >= r.ctx.settings.blockLengthSec * 1000) {
      st.reminder = true;
      st.lastReminderMs = now;
    }
  }

  if ((st.loop || st.mode === 'working') && (st.lastHeartbeatMs === null || now - st.lastHeartbeatMs >= HEARTBEAT_EVERY_MS)) {
    r.heartbeat();
  }
}

function start(r: Run, lengthSec: number): void {
  const st = r.st;
  if (!validLength(lengthSec)) return r.fail('Blocks are 5 to 180 minutes');
  if (st.loop) return r.fail('The loop is already running');
  const untilStop = fromStartup(r) || !inWork(r.now, r.ctx.window(r.now));
  st.loop = { block: r.startBlock(r.now, lengthSec), lengthSec, untilStop };
  st.reminder = false;
  st.cut = null;
  r.heartbeat();
}

function stop(r: Run): void {
  const st = r.st;
  if (!st.loop) return r.fail('The loop isn’t running');
  r.closeBlock(st.loop.block, r.now);
  st.loop = null;
  st.cut = null;
  st.lastReminderMs = r.now;
  r.heartbeat();
}

/** P20, P62: extend today; a loop cut by the end of work hours carries on from where it was cut. */
function keepWorking(r: Run): void {
  const st = r.st;
  const win = r.ctx.window(r.now);
  const nowMin = minutesOfDay(r.now);
  const schedEnd = win ? minutesOfDay(win.endMs) || 1440 : nowMin;
  r.emit({ setDayOverride: { date: dateKey(r.now), endMin: Math.max(schedEnd, nowMin) + r.ctx.settings.keepWorkingStepMin } });
  const cut = st.cut;
  if (!st.loop && cut && dateKey(cut.atMs) === dateKey(r.now)) {
    st.loop = { block: r.startBlock(cut.atMs, cut.lengthSec), lengthSec: cut.lengthSec, untilStop: false };
    st.reminder = false;
  }
  st.cut = null;
  st.mode = 'working';
  if (!st.loop) st.lastReminderMs = null;
  r.heartbeat();
}

// ---------------------------------------------------------------------------
// Bar view model (P63)

export interface WidgetExtras {
  productiveTodaySec: number;
  goalSec: number;
  isDistracted: boolean;
  /** Blocks waiting to be accounted for. */
  pendingCount: number;
}

export interface WidgetVM {
  mode: EngineState['mode'];
  running: boolean;
  /** Work hours with no loop running: the bar highlights "Not started" (P59). */
  notStarted: boolean;
  /** Seconds into the running block (counts up, P63). */
  timerSec: number;
  /** The running block's length, else the length Start would use. */
  blockLengthSec: number;
  /** Length for the next block (the sidebar's box). */
  nextLengthSec: number;
  blockId: string | null;
  blockStartedMs: number | null;
  workdayPct: number;
  isDayOff: boolean;
  productiveTodaySec: number;
  goalSec: number;
  isDistracted: boolean;
  pendingCount: number;
  /** Keep working would continue a loop cut at the end of work hours. */
  canContinue: boolean;
  /** P82: the bar's percent cell shows the goal % instead of the workday %. */
  goalPct: boolean;
}

export function widgetView(state: EngineState, ctx: Pick<Ctx, 'now' | 'window' | 'settings'>, extras: WidgetExtras): WidgetVM {
  const now = ctx.now;
  const win = ctx.window(now);
  const b = state.loop?.block ?? null;
  return {
    mode: state.mode,
    running: !!b,
    notStarted: state.mode === 'working' && !b,
    timerSec: b ? Math.max(0, Math.floor((now - b.startedMs) / 1000)) : 0,
    blockLengthSec: b?.lengthSec ?? ctx.settings.blockLengthSec,
    nextLengthSec: state.loop?.lengthSec ?? ctx.settings.blockLengthSec,
    blockId: b?.id ?? null,
    blockStartedMs: b?.startedMs ?? null,
    workdayPct: workdayPct(now, win),
    isDayOff: !win,
    productiveTodaySec: extras.productiveTodaySec,
    goalSec: extras.goalSec,
    isDistracted: extras.isDistracted,
    pendingCount: extras.pendingCount,
    canContinue: !b && !!state.cut && dateKey(state.cut.atMs) === dateKey(now),
    goalPct: ctx.settings.barPercent === 'goal',
  };
}

/** True while the loop runs (nudge input, §8). Whether a block was a break is only known afterwards. */
export function inLoop(state: EngineState): boolean {
  return state.loop !== null;
}
