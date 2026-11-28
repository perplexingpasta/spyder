// P98: the midnight card. After a day ends, the prompt asks for its wins and how I'll improve, once per day.
// P99: the next day, the prompt shows those improvements until the first block is answered.
import { randomUUID } from 'node:crypto';
import { dateKey, startOfDay } from '../core/schedule';
import type { Db } from './db/db';
import { autoAdd } from './gadget';

export interface ReflectDay {
  date: string;
  wins: string[];
  improves: string[];
}

/**
 * The last day before today with blocks (the last day Spyder tracked), unless it was already saved or skipped, or its
 * review already has both a win and an improvement.
 */
export function reflectDay(db: Db, nowMs: number): ReflectDay | null {
  const last = lastDay(db, nowMs);
  if (!last || db.get('SELECT 1 AS x FROM reflections WHERE date = ?', last.date)) return null;
  return last.wins.length && last.improves.length ? null : last;
}

/** The last day before today with blocks (Sleep blocks don't count, P105), with its wins and improvements. */
export function lastDay(db: Db, nowMs: number): ReflectDay | null {
  const last = db.get<{ s: number | null }>(
    "SELECT MAX(started_ms) AS s FROM sessions WHERE deleted_ms IS NULL AND tag IS NOT 'sleep' AND started_ms < ?",
    startOfDay(nowMs),
  );
  if (last?.s == null) return null;
  const date = dateKey(last.s);
  const items = db.all<{ kind: string; text: string }>('SELECT kind, text FROM review_items WHERE date = ? ORDER BY sort, created_ms', date);
  return { date, wins: items.filter((i) => i.kind === 'win').map((i) => i.text), improves: items.filter((i) => i.kind === 'improve').map((i) => i.text) };
}

/** P99: a block of today already has the user's answer (a filled gap's preset answer doesn't count). */
export function answeredToday(db: Db, nowMs: number, gapAnswer: string): boolean {
  return !!db.get(
    `SELECT 1 AS x FROM sessions WHERE deleted_ms IS NULL AND started_ms >= ?
      AND ((kind = 'open' AND name IS NOT NULL) OR (kind = 'break' AND name IS NOT ?))`,
    startOfDay(nowMs),
    gapAnswer,
  );
}

/** Saves the card: the lists replace the day's wins and improvements; null (Skip) leaves them. Either way the day is done. */
export function saveReflection(db: Db, date: string, lists: { win: string[]; improve: string[] } | null, nowMs: number): void {
  db.transaction(() => {
    if (lists) {
      for (const kind of ['win', 'improve'] as const) {
        db.run('DELETE FROM review_items WHERE date = ? AND kind = ?', date, kind);
        lists[kind].forEach((text, sort) =>
          db.run('INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), date, kind, text, sort, nowMs),
        );
      }
      autoAdd(db, date, lists.improve.map((text, sort) => ({ text, sort })), nowMs); // P107
    }
    db.run('INSERT INTO reflections (date, done_ms) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET done_ms = excluded.done_ms', date, nowMs);
  });
}

export function reflectedMs(db: Db, date: string): number | null {
  return db.get<{ done_ms: number }>('SELECT done_ms FROM reflections WHERE date = ?', date)?.done_ms ?? null;
}
