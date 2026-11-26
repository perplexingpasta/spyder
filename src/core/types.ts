// Engine types (ADR-0011: the block loop).
import type { Settings } from './settings';

export type Kind = 'planned' | 'timed' | 'open' | 'break';
/**
 * P66, P74, P105: a block's tag, apart from its answer. Work is kind 'open'; Break, Gym, Food and Sleep are kind
 * 'break', with Gym, Food and Sleep named in `sessions.tag`. Gym and Food count as break time; Sleep counts as
 * neither work nor break.
 */
export type Tag = 'work' | 'break' | 'gym' | 'food' | 'sleep';
export const TAGS: Tag[] = ['work', 'break', 'gym', 'food', 'sleep'];
export const TAG_LABEL: Record<Tag, string> = { work: 'Work', break: 'Break', gym: 'Gym', food: 'Food', sleep: 'Sleep' };
/** A block's tag from its stored kind and `sessions.tag`. */
export const tagOf = (x: { kind: string; tag?: string | null }): Tag => (x.kind === 'break' ? ((x.tag as Tag | null | undefined) ?? 'break') : 'work');
/** P75: the user's own rating of a work block, picked in the prompt or on Today. */
export const EFFICIENCIES = [25, 50, 75, 100] as const;
export type Efficiency = (typeof EFFICIENCIES)[number];
export const isEfficiency = (v: unknown): v is Efficiency => EFFICIENCIES.includes(v as Efficiency);
export type Direction = 'up' | 'down';
export type AwayReason = 'idle' | 'suspend' | 'lock' | 'not_running';
export type AwayClassification = 'break' | 'meeting' | 'offline_work' | 'not_working' | 'working';
export type EndReason = 'done' | 'switched' | 'work_hours_end' | 'cap_24h' | 'checkin_fresh' | 'resumed';
export type SessionStatus = 'running' | 'paused' | 'interrupted' | 'done';

/** The block that is running now (ADR-0011). */
export interface RunningBlock {
  id: string;
  startedMs: number;
  /** This block's length; the loop's length applies from the next block (P59). */
  lengthSec: number;
  segmentId: string;
}

export interface Loop {
  block: RunningBlock;
  /** Length for the next block. */
  lengthSec: number;
  /** Started in off hours: runs until Stop instead of stopping at the end of work hours (P59). */
  untilStop: boolean;
}

export interface EngineState {
  /** Whether it's work hours now. */
  mode: 'off_hours' | 'working';
  loop: Loop | null;
  /** The loop cut by the end of work hours; Keep working continues it from `atMs` (P62). */
  cut: { lengthSec: number; atMs: number } | null;
  /** The start reminder prompt is showing (P59). */
  reminder: boolean;
  lastReminderMs: number | null;
  /** The user is away right now (idle, lock, sleep); only a hint for accounting (P61). */
  away: { startMs: number; reason: AwayReason } | null;
  reviewOpenedFor: string | null;
  lastHeartbeatMs: number | null;
}

export interface WorkWindow {
  startMs: number;
  endMs: number;
}

export type EngineSettings = Pick<Settings, 'blockLengthSec' | 'keepWorkingStepMin' | 'trackFromStartup' | 'barPercent' | 'asleepScope'>;

export interface Ctx {
  now: number;
  /** Work hours (after overrides) of the local day containing dateMs, or null on a day off. */
  window(dateMs: number): WorkWindow | null;
  settings: EngineSettings;
  newId(): string;
}

export interface Heartbeat {
  tsMs: number;
  state: EngineState;
}

export type EngineEvent =
  | { type: 'BOOT'; heartbeat: Heartbeat | null }
  | { type: 'TICK' }
  | { type: 'SCHEDULE_CHANGED' }
  | { type: 'START'; lengthSec: number }
  | { type: 'STOP' }
  | { type: 'SET_LENGTH'; lengthSec: number }
  | { type: 'DISMISS_REMINDER' }
  | { type: 'KEEP_WORKING' }
  | { type: 'AWAY_BEGIN'; atMs: number; reason: AwayReason }
  | { type: 'AWAY_END' };

export interface SessionInsertRow {
  id: string;
  kind: Kind;
  name: string | null;
  projectId: string | null;
  plannedSec: number | null;
  direction: Direction | null;
  status: SessionStatus;
  startedMs: number;
  createdMs: number;
}
export interface SessionUpdateRow {
  id: string;
  name?: string | null;
  projectId?: string | null;
  plannedSec?: number | null;
  status?: SessionStatus;
  endedMs?: number;
  elapsedSec?: number;
  overtimeSec?: number;
  endReason?: EndReason;
}
export interface SegmentRow {
  id: string;
  sessionId: string;
  startMs: number;
  endMs?: number | null;
  source: 'live' | 'away_working';
}
export interface GapBlockRow {
  id: string;
  segmentId: string;
  startMs: number;
  endMs: number;
  name: string;
  /** P105: Sleep outside work hours under `asleepScope` All day; a plain break otherwise. */
  tag: 'break' | 'sleep';
  createdMs: number;
}
export interface AwayInsertRow {
  id: string;
  startMs: number;
  endMs: number;
  reason: AwayReason;
  interruptedSessionId: string | null;
}
export interface AwayUpdateRow {
  id: string;
  classification: AwayClassification;
  label: string | null;
  classifiedMs: number;
}

export type Effect =
  | { db: 'insertSession'; row: SessionInsertRow }
  | { db: 'updateSession'; row: SessionUpdateRow }
  | { db: 'openSegment'; row: SegmentRow }
  | { db: 'closeSegment'; row: { id: string; endMs: number } }
  /** A block cut before it lasted a second (Stop right after Start): removed, not kept as a 0 s block. */
  | { db: 'discardSession'; id: string }
  /** P95: an ended break block over time Spyder was asleep or off, asked about on return. */
  | { db: 'insertGapBlock'; row: GapBlockRow }
  /** A block ended; the host shows the accounting prompt (P60). */
  | { blockEnded: string }
  /** An away interval ended; kept in memory as a hint (P61). */
  | { awayEnded: { startMs: number; endMs: number } }
  | { openReview: string }
  | { setDayOverride: { date: string; endMin: number } }
  | { saveHeartbeat: true };

export type EngineError = { error: 'invalid'; message: string };

export interface ReduceResult {
  state: EngineState;
  effects: Effect[];
  error?: EngineError;
}
