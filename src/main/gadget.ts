// The gadget's rows in the db (P107). The rules (order, dedupe, dates) are in src/core/gadget.ts.
import { randomUUID } from 'node:crypto';
import {
  cleanText,
  importView,
  isLabelColor,
  orderRows,
  sameImprovement,
  type GadgetRow,
  type ImportDay,
  type LabelColor,
} from '../core/gadget';
import type { Db } from './db/db';

interface RowRec {
  id: string;
  date: string;
  text: string;
  color: string | null;
  ticked_ms: number | null;
  sort: number;
  created_ms: number;
}

const toRow = (r: RowRec): GadgetRow => ({
  id: r.id,
  date: r.date,
  text: r.text,
  color: isLabelColor(r.color) ? r.color : null,
  tickedMs: r.ticked_ms,
  createdMs: r.created_ms,
  sort: r.sort,
});

/** The rows on the gadget (not removed), in the order it shows them. */
export function listRows(db: Db): GadgetRow[] {
  return orderRows(
    db
      .all<RowRec>(
        'SELECT id, date, text, color, ticked_ms, sort, created_ms FROM gadget_rows WHERE removed_ms IS NULL',
      )
      .map(toRow),
  );
}

/** A row written on the gadget, dated today. Nothing when the text is empty. */
export function addRow(db: Db, text: string, today: string, nowMs: number): GadgetRow | null {
  const t = cleanText(text);
  if (!t) return null;
  const id = randomUUID();
  db.run(
    'INSERT INTO gadget_rows (id, date, text, sort, created_ms) VALUES (?, ?, ?, 0, ?)',
    id,
    today,
    t,
    nowMs,
  );
  return { id, date: today, text: t, color: null, tickedMs: null, createdMs: nowMs, sort: 0 };
}

export interface RowPatch {
  text?: string;
  ticked?: boolean;
  color?: LabelColor | null;
  /** false is the Undo of a removal. */
  removed?: boolean;
}

/** An empty text removes the row. */
export function editRow(db: Db, id: string, p: RowPatch, nowMs: number): void {
  if (p.text !== undefined) {
    const t = cleanText(p.text);
    if (t) db.run('UPDATE gadget_rows SET text = ? WHERE id = ?', t, id);
    else p = { ...p, removed: true };
  }
  if (p.ticked !== undefined)
    db.run('UPDATE gadget_rows SET ticked_ms = ? WHERE id = ?', p.ticked ? nowMs : null, id);
  if (p.color !== undefined) db.run('UPDATE gadget_rows SET color = ? WHERE id = ?', p.color, id);
  if (p.removed !== undefined)
    db.run('UPDATE gadget_rows SET removed_ms = ? WHERE id = ?', p.removed ? nowMs : null, id);
}

/** Removes every ticked row; returns their ids. */
export function clearTicked(db: Db, nowMs: number): string[] {
  const ids = db
    .all<{ id: string }>('SELECT id FROM gadget_rows WHERE removed_ms IS NULL AND ticked_ms IS NOT NULL')
    .map((r) => r.id);
  db.run('UPDATE gadget_rows SET removed_ms = ? WHERE removed_ms IS NULL AND ticked_ms IS NOT NULL', nowMs);
  return ids;
}

/** Improvements just saved: each one the gadget hasn't had yet is added. A removed row counts as had, so it isn't brought back. Callers may run it inside their own transaction. */
export function autoAdd(
  db: Db,
  date: string,
  items: { text: string; sort: number }[],
  nowMs: number,
): number {
  const had = db.all<{ date: string; text: string }>(
    'SELECT date, text FROM gadget_rows WHERE date = ?',
    date,
  );
  return insertNew(
    db,
    items.map((it) => ({ ...it, date })),
    had,
    nowMs,
  );
}

/** The Import picker. */
export function importList(db: Db): ImportDay[] {
  const items = db.all<{ date: string; text: string; sort: number }>(
    "SELECT date, text, sort FROM review_items WHERE kind = 'improve' ORDER BY date, sort",
  );
  const days = new Map<string, { text: string; sort: number }[]>();
  for (const it of items) days.set(it.date, [...(days.get(it.date) ?? []), { text: it.text, sort: it.sort }]);
  const onGadget = db.all<{ date: string; text: string }>(
    'SELECT date, text FROM gadget_rows WHERE removed_ms IS NULL',
  );
  return importView(
    [...days].map(([date, its]) => ({ date, items: its })),
    onGadget,
  );
}

/** Picked in Import: each one not on the gadget now is added, so a removed row can come back. One batch shares one time. */
export function importRows(
  db: Db,
  items: { date: string; text: string; sort: number }[],
  nowMs: number,
): number {
  return db.transaction(() =>
    insertNew(
      db,
      items,
      db.all<{ date: string; text: string }>('SELECT date, text FROM gadget_rows WHERE removed_ms IS NULL'),
      nowMs,
    ),
  );
}

function insertNew(
  db: Db,
  items: { date: string; text: string; sort: number }[],
  had: { date: string; text: string }[],
  nowMs: number,
): number {
  let n = 0;
  for (const it of items) {
    const text = cleanText(it.text);
    if (!text || had.some((h) => sameImprovement(h, { date: it.date, text }))) continue;
    db.run(
      'INSERT INTO gadget_rows (id, date, text, sort, created_ms) VALUES (?, ?, ?, ?, ?)',
      randomUUID(),
      it.date,
      text,
      it.sort,
      nowMs,
    );
    had.push({ date: it.date, text });
    n++;
  }
  return n;
}
