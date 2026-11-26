// Prompt view models and copy for the block loop (P59, P60, P70) and the midnight card (P98).
import type { AskRow } from './asks';
import { fmtDuration, fmtTime } from './format';
import { addDays, dateKey, dayStartFromKey } from './schedule';

/** An ended block waiting to be accounted for, with its hints. */
export interface PendingBlock {
  id: string;
  startMs: number;
  endMs: number;
  /** Minutes the user was away within the block (P61). */
  awaySec: number;
  /** Top apps or sites used in the block, most time first. */
  apps: string[];
  /** P95: a break block filled over time Spyder was asleep or off. */
  gap?: boolean;
  /** P105: that filled block is Sleep (outside work hours), not a break. */
  sleep?: boolean;
}

export interface AccountBlockVM extends PendingBlock {
  range: string;
  length: string;
  hint: string | null;
}

export interface AccountVM {
  view: 'account';
  heading: string;
  title: string;
  blocks: AccountBlockVM[];
  /** The latest answer today, for "Same as last". */
  lastAnswer: string | null;
  /** The loop was cut by the end of work hours: offer Keep working (P62). */
  canContinue: boolean;
  /** P70: apps and sites used in these blocks that still want the user's label, most time first. */
  asks: AskRow[];
  askTitle: string;
  /** P99: the last day's improvements, until the first block of today is answered. */
  improves: ImprovesVM | null;
}

/** P99: what the user said they'd improve, on the last day with blocks. */
export interface ImprovesVM {
  title: string;
  items: string[];
}

/** P70: the prompt asks about at most this many apps and sites. */
export const PROMPT_ASKS = 3;

export interface ReminderVM {
  view: 'reminder';
  heading: string;
  title: string;
  body: string;
  lengthSec: number;
  improves: ImprovesVM | null;
}

/** P98: after a day ends, its wins and how I'll improve (both optional). */
export interface ReflectVM {
  view: 'reflect';
  heading: string;
  title: string;
  date: string;
  /** What the day's review already has, filled in and editable. */
  wins: string[];
  improves: string[];
}

export type PromptVM = AccountVM | ReminderVM | ReflectVM;

/** P95: the hint on a block filled over time Spyder was asleep or off. */
export const GAP_HINT = 'Computer asleep or off · a break until answered';
/** P105: the hint on a Sleep block filled over time asleep or off outside work hours. */
export const SLEEP_GAP_HINT = 'Computer asleep or off · sleep until answered';

const range = (b: PendingBlock) => `${fmtTime(b.startMs)}–${fmtTime(b.endMs)}`;

export function blockHint(b: PendingBlock): string | null {
  const parts: string[] = [];
  if (b.gap) parts.push(b.sleep ? SLEEP_GAP_HINT : GAP_HINT);
  if (b.awaySec >= 60) parts.push(`Away ${fmtDuration(b.awaySec)}`);
  if (b.apps.length) parts.push(b.apps.join(', '));
  return parts.length ? parts.join(' · ') : null;
}

export function accountView(
  blocks: PendingBlock[],
  lastAnswer: string | null,
  canContinue: boolean,
  asks: AskRow[] = [],
  improves: ImprovesVM | null = null,
): AccountVM {
  const one = blocks.length === 1;
  return {
    view: 'account',
    heading: one ? 'Block ended' : `${blocks.length} blocks`,
    title: one ? `What did you do ${range(blocks[0])}?` : `What did you do in these ${blocks.length} blocks?`,
    blocks: blocks.map((b) => ({ ...b, range: range(b), length: fmtDuration(Math.round((b.endMs - b.startMs) / 1000)), hint: blockHint(b) })),
    lastAnswer,
    canContinue,
    asks: asks.slice(0, PROMPT_ASKS),
    askTitle: asks.length === 1 ? 'How does this count?' : 'How do these count?',
    improves,
  };
}

export function reminderView(lengthSec: number, improves: ImprovesVM | null = null): ReminderVM {
  return {
    view: 'reminder',
    heading: 'Not started',
    title: 'Work hours have started',
    body: `Press Start to begin ${fmtDuration(lengthSec)} blocks.`,
    lengthSec,
    improves,
  };
}

const isYesterday = (date: string, today: string) => dateKey(addDays(dayStartFromKey(today), -1)) === date;
const weekday = (date: string) => new Date(dayStartFromKey(date)).toLocaleDateString('en-US', { weekday: 'long' });

export function reflectView(date: string, today: string, wins: string[], improves: string[]): ReflectVM {
  const yesterday = isYesterday(date, today);
  return {
    view: 'reflect',
    heading: yesterday ? 'Yesterday' : new Date(dayStartFromKey(date)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    title: `How did ${yesterday ? 'yesterday' : weekday(date)} go?`,
    date,
    wins,
    improves,
  };
}

/** P99: "Your “How I'll improve” from yesterday", or the weekday of an older day ("… from Friday"). */
export function improvesView(date: string, today: string, items: string[]): ImprovesVM | null {
  if (!items.length) return null;
  return { title: `Your “How I'll improve” from ${isYesterday(date, today) ? 'yesterday' : weekday(date)}`, items };
}
