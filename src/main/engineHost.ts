// Engine host (ADR-0011): owns EngineState, ticks it with clock time, applies effects (DB, review, day
// overrides), writes answers, and pushes view models to the bar, the dashboard and the prompt window.
import { randomUUID } from 'node:crypto';
import { GAP_ANSWER, inLoop, initialState, reduce, widgetView } from '../core/blockEngine';
import { categorize, type ActivityCategory, type ActivityKey, type Rule } from '../core/categorize';
import { fmtClock } from '../core/format';
import { initialNudge, nudgeMessage, stepNudge, type NudgeState } from '../core/nudge';
import type { AskRow } from '../core/asks';
import { accountView, improvesView, reflectView, reminderView, type ImprovesVM, type PendingBlock, type PromptVM } from '../core/promptView';
import { addDays, dateKey, mergeOverride, minutesOfDay, startOfDay, workWindow, type DayOverride } from '../core/schedule';
import type { ScheduleRow } from '../core/settings';
import { isEfficiency, TAGS, tagOf, type Ctx, type Effect, type EngineError, type EngineEvent, type EngineState, type Tag } from '../core/types';
import type { WidgetPayload } from '../preload/api';
import type { AppCtx } from './context';
import * as repo from './db/repo';
import { toast } from './notify';
import { listToAsk, refreshReview, summaryFor } from './report';
import { answeredToday, lastDay, reflectDay, saveReflection, type ReflectDay } from './reflect';
import { saveSettings, loadSettings } from './settings';
import { setTrayTooltip } from './tray';
import { hidePrompt, openDashboard, showPrompt } from './windows';

export type ActivitySample = ActivityKey & { appName?: string };

type DbEffect = Extract<Effect, { db: string }>;
type Result = { ok: true } | EngineError;

export class EngineHost {
  state: EngineState = initialState();
  toastCount = 0;
  private schedule: ScheduleRow[] = [];
  private overrides = new Map<string, DayOverride>();
  private rules: Rule[] = [];
  private nudge: NudgeState = initialNudge();
  private distracted = false;
  private distractTarget: string | null = null;
  /** Away intervals seen since launch: hints for accounting, never stored (P61). */
  private awayLog: { startMs: number; endMs: number }[] = [];
  /** P95: blocks filled over time Spyder was asleep or off, asked about in the prompt until answered (not stored). */
  private gaps = new Set<string>();
  /** Today's blocks waiting for an answer; recomputed when blocks or answers change. */
  private pending: PendingBlock[] = [];
  private asks: AskRow[] = [];
  private pendingDirty = true;
  private pendingDay = '';
  /** P98: the day the midnight card asks about; recomputed with the pending blocks. */
  private reflect: ReflectDay | null = null;
  /** P99: the last day's improvements, until a block of today is answered. */
  private improves: ImprovesVM | null = null;
  private lastWidget = '';
  private lastPrompt = '';
  private lastPendingCount = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly app: AppCtx;

  constructor(app: AppCtx) {
    this.app = app;
    this.reloadSchedule();
    this.rules = repo.loadRules(app.db);
  }

  reloadSchedule(): void {
    this.schedule = repo.loadSchedule(this.app.db);
    this.overrides = repo.loadOverrides(this.app.db);
  }

  /** Settings page changed the schedule or an override: reload and let the engine react. */
  scheduleChanged(): void {
    this.reloadSchedule();
    this.productiveCache.atMs = Number.NaN;
    this.dispatch({ type: 'SCHEDULE_CHANGED' });
  }

  ctx(): Ctx {
    return {
      now: this.app.clock.now(),
      window: (ms) => workWindow(ms, this.schedule, this.overrides),
      settings: this.app.settings,
      newId: randomUUID,
    };
  }

  /** Restore from the heartbeat, then the tick loop. */
  boot(): void {
    this.dispatch({ type: 'BOOT', heartbeat: repo.loadHeartbeat(this.app.db) });
    const loop = () => {
      this.dispatch({ type: 'TICK' });
      // One real second normally; faster when the clock is sped up for tests, so timers stay accurate.
      const s = this.app.clock.scale;
      this.timer = setTimeout(loop, s > 1 ? Math.max(50, 1000 / s) : 1000);
    };
    this.timer = setTimeout(loop, 0);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.saveHeartbeat();
  }

  dispatch(ev: EngineEvent): EngineError | null {
    const ctx = this.ctx();
    const r = reduce(this.state, ev, ctx);
    if (r.error) return r.error;
    this.state = r.state;
    const dbFx = r.effects.filter((e): e is DbEffect => 'db' in e);
    repo.applyDbEffects(this.app.db, dbFx);
    for (const e of r.effects) {
      if ('openReview' in e) openDashboard(this.app, 'review');
      else if ('setDayOverride' in e) this.applyOverride(e.setDayOverride.date, e.setDayOverride.endMin, ctx);
      else if ('awayEnded' in e) this.awayLog.push(e.awayEnded);
      else if ('blockEnded' in e) this.productiveCache.atMs = Number.NaN;
      else if ('db' in e && e.db === 'insertGapBlock') {
        this.gaps.add(e.row.id);
        this.productiveCache.atMs = Number.NaN;
        refreshReview(this.app.db, dateKey(e.row.startMs), ctx.now, this.app.settings);
      }
    }
    if (dbFx.length) this.pendingDirty = true;
    if (r.effects.length) this.saveHeartbeat();
    this.push();
    return null;
  }

  private applyOverride(date: string, endMin: number, ctx: Ctx): void {
    const w = ctx.window(ctx.now);
    const cur = w ? { startMin: minutesOfDay(w.startMs), endMin: minutesOfDay(w.endMs) || 1440 } : null;
    const o: DayOverride = { date, ...mergeOverride(cur, minutesOfDay(ctx.now), endMin) };
    repo.upsertOverride(this.app.db, o);
    this.overrides.set(date, o);
  }

  saveHeartbeat(): void {
    repo.saveHeartbeat(this.app.db, this.app.clock.now(), this.state);
  }

  // ---- commands from IPC / tray ----------------------------------------------------
  private remember(lengthSec: number): void {
    if (this.app.settings.blockLengthSec === lengthSec) return;
    saveSettings(this.app.db, { blockLengthSec: lengthSec });
    this.app.settings = loadSettings(this.app.db);
  }

  start(lengthSec: number): Result {
    const err = this.dispatch({ type: 'START', lengthSec });
    if (err) return err;
    this.remember(lengthSec);
    this.push();
    return { ok: true };
  }

  /** The sidebar's length box: remembered, and used from the next block (P59). */
  setLength(lengthSec: number): Result {
    const err = this.dispatch({ type: 'SET_LENGTH', lengthSec });
    if (err) return err;
    this.remember(lengthSec);
    this.push();
    return { ok: true };
  }

  /**
   * Answers ended blocks (P60, P64, P66, P75): text, and optionally a tag and an efficiency; left out, a block keeps
   * them. A work block needs text, a break doesn't. The running block has no answer yet. Used by the prompt, Today and the review.
   */
  answer(answers: repo.BlockAnswer[]): Result {
    const clean: { id: string; answer: string | null; tag: Tag; efficiency?: repo.BlockAnswer['efficiency'] }[] = [];
    const running = this.state.loop?.block.id;
    for (const a of answers) {
      if (a.id === running) return { error: 'invalid', message: 'The running block can’t be answered until it ends' };
      const row = this.app.db.get<{ kind: string; tag: string | null; deleted_ms: number | null }>('SELECT kind, tag, deleted_ms FROM sessions WHERE id = ?', a.id);
      if (!row || row.deleted_ms !== null) return { error: 'invalid', message: 'No such block' };
      if (a.tag !== undefined && !TAGS.includes(a.tag)) return { error: 'invalid', message: 'No such tag' };
      const tag: Tag = a.tag ?? tagOf(row);
      const text = a.answer?.trim() || null;
      if (tag === 'work' && text === null) return { error: 'invalid', message: 'Say what you did, or pick Break' };
      // P75: only work blocks are rated.
      if (a.efficiency != null && (!isEfficiency(a.efficiency) || tag !== 'work')) return { error: 'invalid', message: 'Only a work block can be rated 25, 50, 75 or 100%' };
      clean.push({ id: a.id, answer: text, tag, ...(a.efficiency !== undefined && { efficiency: a.efficiency }) });
    }
    repo.writeAnswers(this.app.db, clean);
    for (const a of clean) this.gaps.delete(a.id);
    const dates = new Set(
      clean.map((a) => dateKey(this.app.db.get<{ s: number }>('SELECT started_ms AS s FROM sessions WHERE id = ?', a.id)!.s)),
    );
    for (const d of dates) refreshReview(this.app.db, d, this.app.clock.now(), this.app.settings);
    this.dataChanged();
    return { ok: true };
  }

  /** P98: the midnight card's Save (lists) or Skip (null). */
  saveReflection(date: string, lists: { win: string[]; improve: string[] } | null): Result {
    if (date !== this.reflect?.date) return { error: 'invalid', message: 'That day isn’t being asked about' };
    const clean = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : []);
    saveReflection(this.app.db, date, lists && { win: clean(lists.win), improve: clean(lists.improve) }, this.app.clock.now());
    this.dataChanged();
    return { ok: true };
  }

  // ---- nudge (plan §8) ---------------------------------------------------------------
  feedSample(sample: ActivitySample, tsMs = this.app.clock.now()): ActivityCategory {
    const category = categorize(sample, this.rules);
    const target = sample.domain ?? sample.appName ?? sample.exe;
    const r = stepNudge(this.nudge, { tsMs, category, target, inWorkSession: inLoop(this.state) }, this.app.settings);
    this.nudge = r.state;
    this.distracted = r.isDistracted;
    if (category === 'distracting') this.distractTarget = target;
    if (r.nudge) {
      repo.insertFlag(this.app.db, { tsMs, sessionId: this.state.loop?.block.id ?? null, target: r.nudge.target, continuousSec: r.nudge.continuousSec });
      this.toastCount++;
      toast(nudgeMessage(r.nudge.target, r.nudge.continuousSec));
    }
    this.push();
    return category;
  }

  reloadRules(): void {
    this.rules = repo.loadRules(this.app.db);
    this.productiveCache.atMs = Number.NaN;
    this.pendingDirty = true; // the prompt's asks (P70)
    this.push();
  }

  /** Blocks were edited outside the engine (P64): recompute and push. */
  dataChanged(): void {
    this.productiveCache.atMs = Number.NaN;
    this.pendingDirty = true;
    this.push();
  }

  // ---- view models ---------------------------------------------------------------------
  private productiveCache = { atMs: Number.NaN, sec: 0 };

  /** P25 productive time today (aggregate.ts), recomputed at most every 10 clock-seconds. */
  private productiveToday(now: number): number {
    const c = this.productiveCache;
    if (!(Math.abs(now - c.atMs) < 10_000) || dateKey(now) !== dateKey(c.atMs)) {
      c.atMs = now;
      c.sec = summaryFor(this.app.db, dateKey(now), now, this.app.settings).productiveSec;
    }
    return c.sec;
  }

  private awaySecIn(startMs: number, endMs: number, now: number): number {
    const spans = [...this.awayLog, ...(this.state.away ? [{ startMs: this.state.away.startMs, endMs: now }] : [])];
    let ms = 0;
    for (const a of spans) ms += Math.max(0, Math.min(a.endMs, endMs) - Math.max(a.startMs, startMs));
    return Math.round(ms / 1000);
  }

  /** Today's ended blocks without an answer, with their hints (P60). */
  pendingBlocks(): PendingBlock[] {
    const now = this.app.clock.now();
    const day = dateKey(now);
    if (this.pendingDirty || day !== this.pendingDay) {
      const from = startOfDay(now);
      this.pending = repo.pendingBlocks(this.app.db, from, addDays(from, 1), [...this.gaps], GAP_ANSWER).map((b) => {
        const gap = this.gaps.has(b.id);
        return {
          id: b.id,
          startMs: b.start_ms,
          endMs: b.end_ms,
          // P95: a filled gap is all away; its hint says why instead.
          awaySec: gap ? 0 : this.awaySecIn(b.start_ms, b.end_ms, now),
          apps: gap ? [] : repo.topApps(this.app.db, b.start_ms, b.end_ms),
          ...(gap && { gap: true }),
          ...(gap && b.tag === 'sleep' && { sleep: true }),
        };
      });
      // P70: what these blocks used that still wants the user's label.
      const span = this.pending.length ? [Math.min(...this.pending.map((b) => b.startMs)), Math.max(...this.pending.map((b) => b.endMs))] : null;
      this.asks = span ? listToAsk(this.app.db, span[0], span[1]) : [];
      this.reflect = reflectDay(this.app.db, now);
      const last = answeredToday(this.app.db, now, GAP_ANSWER) ? null : lastDay(this.app.db, now);
      this.improves = last && improvesView(last.date, day, last.improves);
      this.pendingDirty = false;
      this.pendingDay = day;
    }
    return this.pending;
  }

  widget(): WidgetPayload {
    const ctx = this.ctx();
    const vm = widgetView(this.state, ctx, {
      productiveTodaySec: this.productiveToday(ctx.now),
      goalSec: this.app.settings.goalSec,
      isDistracted: this.distracted && inLoop(this.state),
      pendingCount: this.pendingBlocks().length,
    });
    const ds = this.nudge.distractStartMs;
    return {
      ...vm,
      distractTarget: vm.isDistracted ? this.distractTarget : null,
      distractSec: vm.isDistracted && ds !== null ? Math.floor((ctx.now - ds) / 1000) : 0,
    };
  }

  promptState(): PromptVM | null {
    const pending = this.pendingBlocks();
    const canContinue = !this.state.loop && !!this.state.cut && dateKey(this.state.cut.atMs) === dateKey(this.app.clock.now());
    if (pending.length) return accountView(pending, repo.lastAnswer(this.app.db), canContinue, this.asks, this.improves);
    // P98: after today's blocks are accounted for, the day that ended.
    const r = this.app.settings.askReflection ? this.reflect : null;
    if (r) return reflectView(r.date, dateKey(this.app.clock.now()), r.wins, r.improves);
    if (this.state.reminder) return reminderView(this.app.settings.blockLengthSec, this.improves);
    return null;
  }

  push(): void {
    const w = this.widget();
    const wj = JSON.stringify(w);
    if (wj !== this.lastWidget) {
      this.lastWidget = wj;
      for (const win of [this.app.widget, this.app.dashboard]) {
        if (win && !win.isDestroyed()) win.webContents.send('spyder:widget', w);
      }
      const status = w.running ? `Block ${fmtClock(w.timerSec)}` : w.notStarted ? 'Not started' : 'Off hours';
      setTrayTooltip(this.app, `Spyder — ${status}`);
    }
    const p = this.promptState();
    const pj = JSON.stringify(p);
    if (pj !== this.lastPrompt) {
      const wasNull = this.lastPrompt === '' || this.lastPrompt === 'null';
      this.lastPrompt = pj;
      const count = p?.view === 'account' ? p.blocks.length : 0;
      const win = this.app.prompt;
      if (win && !win.isDestroyed()) win.webContents.send('spyder:prompt', p);
      // Pops on top when it appears and whenever another block ends (P60).
      if (p && (wasNull || count > this.lastPendingCount)) showPrompt(this.app);
      else if (!p) hidePrompt(this.app);
      this.lastPendingCount = count;
    }
  }

  debugState(): Record<string, unknown> {
    return {
      engine: this.state,
      toastCount: this.toastCount,
      widgetVM: this.widget(),
      promptState: this.promptState(),
      today: dateKey(this.app.clock.now()),
    };
  }
}
