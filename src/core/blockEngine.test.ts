import { describe, expect, it } from 'vitest';
import { FRESH_HEARTBEAT_MS, GAP_ANSWER, inLoop, initialState } from './blockEngine';
import { Sim, T } from './engine.testkit';
import type { EngineState } from './types';

const MIN = 60;

function booted(at = T(10, 7)) {
  const s = new Sim();
  s.send({ type: 'BOOT', heartbeat: null }, at);
  return s;
}

function started(at = T(10, 7), lengthSec = 15 * MIN) {
  const s = booted(at);
  s.send({ type: 'START', lengthSec });
  return s;
}

describe('block loop (P58–P63)', () => {
  it('nothing starts by itself: work hours show the start reminder, which repeats every block length (P59)', () => {
    const s = booted();
    expect(s.state).toMatchObject({ mode: 'working', loop: null, reminder: true });
    expect(s.view()).toMatchObject({ notStarted: true, running: false, timerSec: 0 });
    expect(s.db('insertSession', s.log)).toHaveLength(0);

    s.send({ type: 'DISMISS_REMINDER' }, T(10, 8));
    expect(s.state.reminder).toBe(false);
    s.tick(T(10, 22, 59));
    expect(s.state.reminder).toBe(false);
    s.tick(T(10, 23));
    expect(s.state.reminder).toBe(true);
  });

  it('Start runs blocks back to back from the moment it is pressed; each end asks about the block (P59, P60)', () => {
    const s = started();
    const first = s.state.loop!.block;
    expect(s.state.reminder).toBe(false);
    expect(s.db('insertSession')[0]).toMatchObject({ id: first.id, kind: 'open', name: null, status: 'running', startedMs: T(10, 7) });

    s.tick(T(10, 10, 30));
    expect(s.view()).toMatchObject({ running: true, notStarted: false, timerSec: 3.5 * MIN, blockLengthSec: 15 * MIN });

    s.tick(T(10, 22));
    expect(s.ended()).toEqual([first.id]);
    expect(s.db('updateSession')[0]).toMatchObject({ id: first.id, status: 'done', endedMs: T(10, 22), elapsedSec: 15 * MIN });
    const second = s.state.loop!.block;
    expect(second.id).not.toBe(first.id);
    expect(second.startedMs).toBe(T(10, 22));
    expect(s.view().timerSec).toBe(0);
  });

  it('a new block length applies from the next block (P59)', () => {
    const s = started();
    s.send({ type: 'SET_LENGTH', lengthSec: 10 * MIN }, T(10, 10));
    expect(s.state.loop!.block.lengthSec).toBe(15 * MIN);
    s.tick(T(10, 22));
    expect(s.state.loop!.block).toMatchObject({ startedMs: T(10, 22), lengthSec: 10 * MIN });
    s.tick(T(10, 32));
    expect(s.ended()).toHaveLength(1);
    expect(s.send({ type: 'SET_LENGTH', lengthSec: 4 * MIN }).error).toBeTruthy();
  });

  it('missed ticks catch up: every block that ended gets its own row and question', () => {
    const s = started();
    s.tick(T(11, 10));
    expect(s.ended()).toHaveLength(4);
    expect(s.db('updateSession').map((r) => r.endedMs)).toEqual([T(10, 22), T(10, 37), T(10, 52), T(11, 7)]);
    expect(s.state.loop!.block.startedMs).toBe(T(11, 7));
  });

  it('Stop ends the block now and the reminder comes back a block length later', () => {
    const s = started();
    s.send({ type: 'STOP' }, T(10, 12));
    expect(s.state.loop).toBeNull();
    expect(s.db('updateSession')[0]).toMatchObject({ endedMs: T(10, 12), elapsedSec: 5 * MIN });
    expect(s.ended()).toHaveLength(1);
    s.tick(T(10, 26));
    expect(s.state.reminder).toBe(false);
    s.tick(T(10, 27));
    expect(s.state.reminder).toBe(true);
    expect(s.send({ type: 'STOP' }).error).toBeTruthy();
  });

  it('Stop right after Start discards the empty block instead of asking about it', () => {
    const s = started();
    const id = s.state.loop!.block.id;
    s.send({ type: 'STOP' });
    expect(s.fx).toContainEqual({ db: 'discardSession', id });
    expect(s.ended()).toHaveLength(0);
  });

  it('Start checks the length and refuses a second loop', () => {
    const s = booted();
    expect(s.send({ type: 'START', lengthSec: 4 * MIN }).error).toEqual({ error: 'invalid', message: 'Blocks are 5 to 180 minutes' });
    expect(s.send({ type: 'START', lengthSec: 181 * MIN }).error).toBeTruthy();
    s.send({ type: 'START', lengthSec: 5 * MIN });
    expect(s.send({ type: 'START', lengthSec: 5 * MIN }).error).toEqual({ error: 'invalid', message: 'The loop is already running' });
  });

  it('the end of work hours cuts the block, opens the review; Keep working continues the loop from the cut (P62)', () => {
    const s = started(T(16, 30));
    s.tick(T(16, 45));
    const cutId = s.state.loop!.block.id;
    s.tick(T(17, 0, 5));
    expect(s.state).toMatchObject({ mode: 'off_hours', loop: null, cut: { atMs: T(17), lengthSec: 15 * MIN }, reminder: false });
    expect(s.db('updateSession').find((r) => r.id === cutId)).toMatchObject({ endedMs: T(17), elapsedSec: 15 * MIN });
    expect(s.fx).toContainEqual({ openReview: '2026-11-24' });
    expect(s.view()).toMatchObject({ canContinue: true, notStarted: false });

    s.send({ type: 'KEEP_WORKING' }, T(17, 3));
    expect(s.fx).toContainEqual({ setDayOverride: { date: '2026-11-24', endMin: 17 * 60 + 33 } });
    expect(s.state.loop!.block.startedMs).toBe(T(17));
    expect(s.state.mode).toBe('working');
    s.tick(T(17, 15));
    expect(s.ended()).toHaveLength(1);
    s.tick(T(17, 33));
    expect(s.ended()).toHaveLength(2); // 17:15–17:30, then the cut at 17:33
    expect(s.state.loop).toBeNull(); // the extended day ended
  });

  it('a block that ends exactly at the end of work hours leaves no empty block behind', () => {
    const s = started(T(16, 45));
    s.tick(T(17, 1));
    expect(s.ended()).toHaveLength(1);
    expect(s.fx.filter((e) => 'db' in e && e.db === 'discardSession')).toHaveLength(1);
  });

  it('Keep working without a cut loop just extends the day and shows the reminder', () => {
    const s = booted(T(18));
    expect(s.state.mode).toBe('off_hours');
    s.send({ type: 'KEEP_WORKING' });
    expect(s.state.loop).toBeNull();
    s.tick(T(18, 0, 1));
    expect(s.state).toMatchObject({ mode: 'working', reminder: true });
  });

  it('a loop started in off hours runs until Stop (P59)', () => {
    const s = started(T(18), 30 * MIN);
    expect(s.state.loop!.untilStop).toBe(true);
    s.tick(T(23, 59));
    expect(s.state.loop).not.toBeNull();
    expect(s.state.reminder).toBe(false);
  });

  it('away keeps the loop running and only reports the interval as a hint (P61)', () => {
    const s = started();
    s.send({ type: 'AWAY_BEGIN', atMs: T(10, 10), reason: 'idle' }, T(10, 15));
    s.tick(T(10, 22));
    expect(s.ended()).toHaveLength(1);
    expect(inLoop(s.state)).toBe(true);
    s.send({ type: 'AWAY_END' }, T(10, 30));
    expect(s.fx).toEqual([{ awayEnded: { startMs: T(10, 10), endMs: T(10, 30) } }]);
    expect(s.state.away).toBeNull();
  });

  it('Spyder not running stops the loop at the last heartbeat; blocks that ended before stay (P61)', () => {
    const s = started();
    const saved: EngineState = structuredClone(s.state);
    const r = new Sim();
    r.send({ type: 'BOOT', heartbeat: { tsMs: T(10, 30), state: saved } }, T(12));
    expect(r.ended()).toHaveLength(2);
    expect(r.db('updateSession').map((x) => x.endedMs)).toEqual([T(10, 22), T(10, 30)]);
    expect(r.state).toMatchObject({ loop: null, reminder: true, mode: 'working' });
  });

  it('a restart within a minute carries the loop on with the same block', () => {
    const s = started();
    const saved: EngineState = structuredClone(s.state);
    const r = new Sim();
    r.send({ type: 'BOOT', heartbeat: { tsMs: T(10, 20), state: saved } }, T(10, 20) + FRESH_HEARTBEAT_MS);
    expect(r.state.loop!.block.id).toBe(saved.loop!.block.id);
    expect(r.ended()).toHaveLength(0);
    r.tick(T(10, 22));
    expect(r.ended()).toEqual([saved.loop!.block.id]);
  });

  it('a heartbeat from before blocks is ignored', () => {
    const r = new Sim();
    const old = { mode: 'working', current: { id: 'x' }, prompts: [] } as unknown as EngineState;
    r.send({ type: 'BOOT', heartbeat: { tsMs: T(10), state: old } }, T(10, 30));
    expect(r.state).toMatchObject({ ...initialState(), mode: 'working', reminder: true, lastReminderMs: T(10, 30), lastHeartbeatMs: T(10, 30) });
  });

  it('booting the next morning before work hours reviews the day that ended, not today', () => {
    const s = booted(T(16, 59, 50));
    const saved: EngineState = structuredClone(s.state);
    const r = new Sim();
    r.send({ type: 'BOOT', heartbeat: { tsMs: T(16, 59, 50), state: saved } }, T(8, 0, 0, 25));
    expect(r.fx).toContainEqual({ openReview: '2026-11-24' });
  });
});

describe('Track from startup (P76)', () => {
  function on(at: number, heartbeat: { tsMs: number; state: EngineState } | null = null) {
    const s = new Sim();
    s.settings.trackFromStartup = true;
    s.send({ type: 'BOOT', heartbeat }, at);
    return s;
  }

  it('launching starts the loop by itself, in or out of work hours, with no reminder', () => {
    for (const at of [T(7, 30), T(10, 7), T(22)]) {
      const s = on(at);
      expect(s.state.loop).toMatchObject({ untilStop: true, block: { startedMs: at, lengthSec: 15 * MIN } });
      expect(s.state.reminder).toBe(false);
    }
  });

  it('the end of work hours neither cuts the loop nor opens the review', () => {
    const s = on(T(16, 50));
    s.tick(T(17, 30));
    expect(s.state.loop).not.toBeNull();
    expect(s.state.cut).toBeNull();
    expect(s.log).not.toContainEqual({ openReview: '2026-11-24' });
  });

  it('a loop started by hand in work hours also runs past their end', () => {
    const s = booted();
    s.settings.trackFromStartup = true;
    s.send({ type: 'START', lengthSec: 15 * MIN });
    s.tick(T(17, 30));
    expect(s.state.loop).not.toBeNull();
  });

  it('sleep ends the loop at its start, even after a lock; waking starts a fresh one', () => {
    const s = on(T(10, 7));
    const first = s.state.loop!.block.id;
    s.send({ type: 'AWAY_BEGIN', atMs: T(10, 30), reason: 'lock' }, T(10, 30));
    s.send({ type: 'AWAY_BEGIN', atMs: T(10, 31), reason: 'suspend' }, T(10, 31));
    expect(s.state.loop).toBeNull();
    expect(s.db('updateSession').map((x) => x.endedMs)).toEqual([T(10, 22), T(10, 31)]);
    expect(s.ended()[0]).toBe(first);

    s.send({ type: 'AWAY_END' }, T(13));
    expect(s.state.loop!.block.startedMs).toBe(T(13));
    expect(s.db('insertSession')).toHaveLength(1);
  });

  it('a sleep Spyder missed (no heartbeat for a minute) ends the loop at the last heartbeat and starts a fresh one', () => {
    const s = on(T(10, 7));
    for (let t = T(10, 7); t <= T(10, 10); t += 15_000) s.tick(t);
    const last = s.state.lastHeartbeatMs!;
    expect(last).toBe(T(10, 10));
    s.tick(T(13));
    expect(s.db('updateSession').at(-1)).toMatchObject({ endedMs: last });
    expect(s.state.loop!.block.startedMs).toBe(T(13));
  });

  it('lock and idle stay away time inside the block', () => {
    const s = on(T(10, 7));
    s.send({ type: 'AWAY_BEGIN', atMs: T(10, 7, 30), reason: 'lock' }, T(10, 7, 30));
    for (let t = T(10, 7, 30); t <= T(10, 20); t += 15_000) s.tick(t);
    expect(s.state.loop!.block.startedMs).toBe(T(10, 7));
  });

  it('the block running at midnight is cut there', () => {
    const s = on(T(23, 50));
    for (let t = T(23, 50); t <= T(0, 10, 0, 25); t += 15_000) s.tick(t);
    const ends = s.db('updateSession', s.log).map((x) => x.endedMs);
    expect(ends).toEqual([T(0, 0, 0, 25)]);
    expect(s.state.loop!.block.startedMs).toBe(T(0, 0, 0, 25));
  });

  it('the first start on a new day reviews the last day Spyder ran', () => {
    const s = on(T(22));
    const saved: EngineState = structuredClone(s.state);
    const r = new Sim();
    r.settings.trackFromStartup = true;
    r.send({ type: 'BOOT', heartbeat: { tsMs: T(23), state: saved } }, T(9, 0, 0, 25));
    expect(r.fx).toContainEqual({ openReview: '2026-11-24' });
    expect(r.state.loop!.block.startedMs).toBe(T(9, 0, 0, 25));
  });

  it('the bar shows the percent the user chose, whatever Track from startup (P82)', () => {
    const s = on(T(10));
    expect(s.view().goalPct).toBe(true);
    s.settings.barPercent = 'day';
    expect(s.view().goalPct).toBe(false);
    const b = booted();
    b.settings.barPercent = 'goal';
    expect(b.view().goalPct).toBe(true);
  });
});

describe('time asleep or off becomes break blocks (P95)', () => {
  function on(at: number) {
    const s = new Sim();
    s.settings.trackFromStartup = true;
    s.send({ type: 'BOOT', heartbeat: null }, at);
    return s;
  }
  const gaps = (s: Sim, effects = s.log) => s.db('insertGapBlock', effects).map(({ startMs, endMs, name }) => ({ startMs, endMs, name }));

  it('a nap with the laptop asleep becomes one break block from the sleep to the wake, before the fresh loop', () => {
    const s = on(T(11));
    s.send({ type: 'AWAY_BEGIN', atMs: T(13, 2), reason: 'suspend' }, T(13, 2));
    expect(gaps(s)).toEqual([]);
    s.send({ type: 'AWAY_END' }, T(15, 4));
    expect(gaps(s, s.fx)).toEqual([{ startMs: T(13, 2), endMs: T(15, 4), name: GAP_ANSWER }]);
    expect(s.state.loop!.block.startedMs).toBe(T(15, 4));
  });

  it('only the work hours of a sleep are filled; the night stays untracked, and days off get nothing', () => {
    const s = on(T(16));
    s.send({ type: 'AWAY_BEGIN', atMs: T(16, 30), reason: 'suspend' }, T(16, 30));
    s.send({ type: 'AWAY_END' }, T(11, 0, 0, 25));
    expect(gaps(s)).toEqual([
      { startMs: T(16, 30), endMs: T(17), name: GAP_ANSWER },
      { startMs: T(10, 0, 0, 25), endMs: T(11, 0, 0, 25), name: GAP_ANSWER },
    ]);

    const w = on(T(16, 0, 0, 27)); // Friday afternoon to Saturday
    w.send({ type: 'AWAY_BEGIN', atMs: T(17, 0, 0, 27), reason: 'suspend' }, T(17, 0, 0, 27));
    w.send({ type: 'AWAY_END' }, T(12, 0, 0, 28));
    expect(gaps(w)).toEqual([]);
  });

  it('a sleep under a minute is no block', () => {
    const s = on(T(11));
    s.send({ type: 'AWAY_BEGIN', atMs: T(11, 5), reason: 'suspend' }, T(11, 5));
    s.send({ type: 'AWAY_END' }, T(11, 5, 50));
    expect(gaps(s)).toEqual([]);
  });

  it('a sleep Spyder missed is filled from the last heartbeat', () => {
    const s = on(T(10, 7));
    for (let t = T(10, 7); t <= T(10, 10); t += 15_000) s.tick(t);
    s.tick(T(13));
    expect(gaps(s, s.fx)).toEqual([{ startMs: T(10, 10), endMs: T(13), name: GAP_ANSWER }]);
  });

  it('Spyder not running is filled too, with or without Track from startup', () => {
    for (const trackFromStartup of [true, false]) {
      const s = new Sim();
      s.settings.trackFromStartup = trackFromStartup;
      s.send({ type: 'BOOT', heartbeat: null }, T(10, 7));
      if (!trackFromStartup) s.send({ type: 'START', lengthSec: 15 * MIN });
      const r = new Sim();
      r.settings.trackFromStartup = trackFromStartup;
      r.send({ type: 'BOOT', heartbeat: { tsMs: T(10, 30), state: structuredClone(s.state) } }, T(12));
      expect(gaps(r, r.fx)).toEqual([{ startMs: T(10, 30), endMs: T(12), name: GAP_ANSWER }]);
    }
  });

  it('nothing is filled when the loop wasn’t running', () => {
    const s = booted(T(10, 7));
    const r = new Sim();
    r.send({ type: 'BOOT', heartbeat: { tsMs: T(10, 30), state: structuredClone(s.state) } }, T(12));
    expect(gaps(r, r.fx)).toEqual([]);
  });
});

describe('asked about all day: time asleep or off outside work hours becomes Sleep (P105)', () => {
  function on(at: number) {
    const s = new Sim();
    s.settings.trackFromStartup = true;
    s.settings.asleepScope = 'all_day';
    s.send({ type: 'BOOT', heartbeat: null }, at);
    return s;
  }
  const gaps = (s: Sim, effects = s.log) =>
    s.db('insertGapBlock', effects).map(({ startMs, endMs, name, tag }) => ({ startMs, endMs, name, tag }));

  it('a night asleep is one Sleep block per day outside work hours; the work-hours parts stay breaks', () => {
    const s = on(T(16));
    s.send({ type: 'AWAY_BEGIN', atMs: T(16, 30), reason: 'suspend' }, T(16, 30));
    s.send({ type: 'AWAY_END' }, T(11, 0, 0, 25));
    expect(gaps(s)).toEqual([
      { startMs: T(16, 30), endMs: T(17), name: GAP_ANSWER, tag: 'break' },
      { startMs: T(17), endMs: T(0, 0, 0, 25), name: GAP_ANSWER, tag: 'sleep' },
      { startMs: T(0, 0, 0, 25), endMs: T(10, 0, 0, 25), name: GAP_ANSWER, tag: 'sleep' },
      { startMs: T(10, 0, 0, 25), endMs: T(11, 0, 0, 25), name: GAP_ANSWER, tag: 'break' },
    ]);
    expect(s.state.loop!.block.startedMs).toBe(T(11, 0, 0, 25));
  });

  it('a sleep just after midnight, outside work hours, becomes Sleep', () => {
    const s = on(T(23, 50));
    s.send({ type: 'AWAY_BEGIN', atMs: T(0, 0, 0, 25), reason: 'suspend' }, T(0, 0, 0, 25));
    s.send({ type: 'AWAY_END' }, T(0, 43, 0, 25));
    expect(gaps(s)).toEqual([{ startMs: T(0, 0, 0, 25), endMs: T(0, 43, 0, 25), name: GAP_ANSWER, tag: 'sleep' }]);
  });

  it('days off are filled whole, one Sleep block each', () => {
    const s = on(T(16, 0, 0, 27)); // Friday afternoon to Monday morning
    s.send({ type: 'AWAY_BEGIN', atMs: T(17, 0, 0, 27), reason: 'suspend' }, T(17, 0, 0, 27));
    s.send({ type: 'AWAY_END' }, T(9, 0, 0, 30));
    expect(gaps(s)).toEqual([
      { startMs: T(17, 0, 0, 27), endMs: T(0, 0, 0, 28), name: GAP_ANSWER, tag: 'sleep' },
      { startMs: T(0, 0, 0, 28), endMs: T(0, 0, 0, 29), name: GAP_ANSWER, tag: 'sleep' },
      { startMs: T(0, 0, 0, 29), endMs: T(0, 0, 0, 30), name: GAP_ANSWER, tag: 'sleep' },
      { startMs: T(0, 0, 0, 30), endMs: T(9, 0, 0, 30), name: GAP_ANSWER, tag: 'sleep' },
    ]);
  });

  it('Spyder off overnight is filled the same way on launch', () => {
    const s = on(T(16));
    const r = new Sim();
    r.settings.trackFromStartup = true;
    r.settings.asleepScope = 'all_day';
    r.send({ type: 'BOOT', heartbeat: { tsMs: T(3, 30, 0, 25), state: structuredClone(s.state) } }, T(11, 0, 0, 25));
    expect(gaps(r, r.fx)).toEqual([
      { startMs: T(3, 30, 0, 25), endMs: T(10, 0, 0, 25), name: GAP_ANSWER, tag: 'sleep' },
      { startMs: T(10, 0, 0, 25), endMs: T(11, 0, 0, 25), name: GAP_ANSWER, tag: 'break' },
    ]);
  });

  it('nothing is filled when the loop wasn’t running', () => {
    const s = booted(T(10, 7));
    const r = new Sim();
    r.settings.asleepScope = 'all_day';
    r.send({ type: 'BOOT', heartbeat: { tsMs: T(10, 30), state: structuredClone(s.state) } }, T(12));
    expect(gaps(r, r.fx)).toEqual([]);
  });
});
