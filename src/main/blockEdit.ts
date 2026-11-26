// Editing blocks after the fact (P64, P66, P73, P74, P75, P86, P95): delete, merge, unmerge, tag, rate and fill untracked time, each with one-step Undo. Answering and
// re-answering go through EngineHost.answer. The running block can't be edited until it ends.
import { randomUUID } from 'node:crypto';
import { alikeRuns, dayLog, neighbours } from '../core/aggregate';
import { dateKey } from '../core/schedule';
import { TAG_LABEL, tagOf, type Efficiency, type EngineError, type Tag } from '../core/types';
import type { AppCtx } from './context';
import type { Db, Row } from './db/db';
import { BREAK_NAME, insertEndedBlock } from './db/repo';
import type { EngineHost } from './engineHost';
import { refreshReview, summaryFor } from './report';

export type EditResult = { ok: true; undoId: string; message: string } | EngineError;

interface Undo {
  id: string;
  /** Full `sessions` rows as they were before the edit. */
  blocks: Row[];
  /** Segment → block links before a merge. */
  segments: { id: string; session_id: string }[];
  flags: { id: string; session_id: string | null }[];
  dates: string[];
  /** P86: merge records this edit made (dropped on Undo) or removed (put back on Undo). */
  madeMerges?: string[];
  removedMerge?: MergeRecord;
}

/** A row of `merges` (P86): what one merge combined, so it can be unmerged later. */
interface MergeRecord {
  id: string;
  keep_id: string;
  created_ms: number;
  /** JSON of the blocks, segments and flags as they were before the merge. */
  before: string;
}

type Snapshot = Pick<Undo, 'blocks' | 'segments' | 'flags'>;

const COLUMNS = ['kind', 'tag', 'name', 'efficiency', 'status', 'started_ms', 'ended_ms', 'elapsed_sec', 'deleted_ms'] as const;

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');
const invalid = (message: string): EngineError => ({ error: 'invalid', message });
const answerOf = (r: Row) =>
  r.kind === 'break' && r.name === BREAK_NAME ? TAG_LABEL[tagOf(r as { kind: string; tag: string | null })] : ((r.name as string | null) ?? 'Unanswered block');
const rowTag = (r: Row) => tagOf(r as { kind: string; tag: string | null });

export class BlockEditor {
  private last: Undo | null = null;
  private readonly app: AppCtx;
  private readonly host: EngineHost;

  constructor(app: AppCtx, host: EngineHost) {
    this.app = app;
    this.host = host;
  }

  private get db(): Db {
    return this.app.db;
  }

  /** The rows for `ids`, or why they can't be edited. */
  private load(ids: string[]): Row[] | EngineError {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return invalid('Pick a block');
    const rows = this.db.all(`SELECT * FROM sessions WHERE id IN (${marks(uniq.length)}) ORDER BY started_ms`, ...uniq);
    if (rows.length !== uniq.length || rows.some((r) => r.deleted_ms !== null)) return invalid('No such block');
    const running = this.host.state.loop?.block.id;
    if (rows.some((r) => r.id === running || r.status !== 'done')) return invalid('The running block can’t be edited until it ends');
    return rows;
  }

  private finish(u: Undo, message: string): EditResult {
    this.last = u;
    for (const d of u.dates) refreshReview(this.db, d, this.app.clock.now(), this.app.settings);
    this.host.dataChanged();
    return { ok: true, undoId: u.id, message };
  }

  /** The blocks are hidden and their time becomes untracked. */
  delete(ids: string[]): EditResult {
    const rows = this.load(ids);
    if (!Array.isArray(rows)) return rows;
    this.db.run(`UPDATE sessions SET deleted_ms = ? WHERE id IN (${marks(rows.length)})`, this.app.clock.now(), ...rows.map((r) => r.id));
    const message = rows.length === 1 ? `Deleted “${answerOf(rows[0])}”` : `Deleted ${rows.length} blocks`;
    return this.finish({ id: randomUUID(), blocks: rows, segments: [], flags: [], dates: [...new Set(rows.map((r) => dateKey(r.started_ms as number)))] }, message);
  }

  /**
   * P95: untracked time in [startMs, endMs) becomes one ended block with `answer` and `tag` (a work block needs an
   * answer). Refused if any of it already belongs to a block or hasn't happened yet.
   */
  fill(startMs: number, endMs: number, answer: string | null, tag: Tag): EditResult {
    const now = this.app.clock.now();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs < 1000) return invalid('Pick a span of time');
    if (endMs > now) return invalid('Only time that has passed can be accounted for');
    if (dateKey(startMs) !== dateKey(endMs - 1)) return invalid('Account for one day at a time');
    const taken = this.db.get(
      `SELECT 1 AS x FROM segments g JOIN sessions s ON s.id = g.session_id
        WHERE s.deleted_ms IS NULL AND g.start_ms < ? AND COALESCE(g.end_ms, ?) > ? LIMIT 1`,
      endMs, now, startMs,
    );
    if (taken) return invalid('Some of that time already belongs to a block');
    const text = answer?.trim() || null;
    if (tag === 'work' && text === null) return invalid('Say what you did, or pick Break');
    const id = randomUUID();
    insertEndedBlock(this.db, { id, segmentId: randomUUID(), startMs, endMs, tag, name: text, createdMs: now });
    // Undo hides the new block again, so its time is untracked as before.
    const row = { ...this.db.get('SELECT * FROM sessions WHERE id = ?', id)!, deleted_ms: now };
    return this.finish({ id: randomUUID(), blocks: [row], segments: [], flags: [], dates: [dateKey(startMs)] }, `Accounted for “${text ?? TAG_LABEL[tag]}”`);
  }

  /** The day's log, as Today shows it. */
  private log(date: string) {
    return dayLog(summaryFor(this.db, date, this.app.clock.now(), this.app.settings));
  }

  /** Neighbouring blocks of one tag (P73) become the earliest one, longer, with one answer (a break's may be null). */
  merge(ids: string[], answer: string | null): EditResult {
    const rows = this.load(ids);
    if (!Array.isArray(rows)) return rows;
    if (rows.length < 2) return invalid('Pick at least two blocks');
    const date = dateKey(rows[0].started_ms as number);
    if (!neighbours(this.log(date), rows.map((r) => r.id as string))) return invalid('Only blocks next to each other can be merged');
    const tags = new Set(rows.map(rowTag));
    if (tags.has('work') && tags.size > 1) return invalid('A break can’t be merged with work blocks. Change their tags first.');
    if (tags.size > 1) return invalid('Blocks with different tags can’t be merged. Change their tags first.');
    const tag = rowTag(rows[0]);
    // A work block needs an answer; a break, gym or food block may have none (P66, P74).
    const text = answer?.trim() || null;
    if (tag === 'work' && text === null) return invalid('Say what you did, or pick Break');
    const name = text ?? BREAK_NAME;
    const { mergeId, ...moved } = this.db.transaction(() => this.combine(rows, name));
    return this.finish({ id: randomUUID(), blocks: rows, ...moved, dates: [date], madeMerges: [mergeId] }, `Merged ${rows.length} blocks into “${text ?? TAG_LABEL[tag]}”`);
  }

  /** P73: every run of neighbouring blocks with the same tag and answer on `date` becomes one block; one Undo. */
  mergeRepeats(date: string): EditResult {
    const runs = alikeRuns(this.log(date)).map((ids) => this.load(ids));
    const bad = runs.find((r) => !Array.isArray(r));
    if (bad) return bad as EngineError;
    if (!runs.length) return invalid('No neighbouring blocks share an answer');
    const u: Undo = { id: randomUUID(), blocks: [], segments: [], flags: [], dates: [date], madeMerges: [] };
    this.db.transaction(() => {
      for (const rows of runs as Row[][]) {
        const moved = this.combine(rows, rows[0].name as string);
        u.blocks.push(...rows);
        u.segments.push(...moved.segments);
        u.flags.push(...moved.flags);
        u.madeMerges!.push(moved.mergeId);
      }
    });
    const n = u.blocks.length;
    return this.finish(u, `Merged ${n} blocks into ${runs.length}`);
  }

  /**
   * Moves the later blocks' time into the first one and records the merge (P86); call inside a transaction.
   * Returns the links it changed and the merge record's id.
   */
  private combine(rows: Row[], name: string): Pick<Undo, 'segments' | 'flags'> & { mergeId: string } {
    const db = this.db;
    const keep = rows[0];
    const rest = rows.slice(1).map((r) => r.id as string);
    const inList = `IN (${marks(rest.length)})`;
    const segments = db.all<{ id: string; session_id: string }>(`SELECT id, session_id FROM segments WHERE session_id ${inList}`, ...rest);
    const flags = db.all<{ id: string; session_id: string | null }>(`SELECT id, session_id FROM distraction_flags WHERE session_id ${inList}`, ...rest);
    const end = rows[rows.length - 1].ended_ms as number;
    // P75: the merged block keeps the time-weighted mean of the rated blocks' efficiency (null if none was rated).
    const rated = rows.filter((r) => r.efficiency !== null);
    const ratedSec = rated.reduce((t, r) => t + (r.elapsed_sec as number), 0);
    const efficiency = !rated.length
      ? null
      : Math.round(
          ratedSec > 0
            ? rated.reduce((t, r) => t + (r.elapsed_sec as number) * (r.efficiency as number), 0) / ratedSec
            : rated.reduce((t, r) => t + (r.efficiency as number), 0) / rated.length,
        );
    db.run(`UPDATE segments SET session_id = ? WHERE session_id ${inList}`, keep.id, ...rest);
    db.run(`UPDATE distraction_flags SET session_id = ? WHERE session_id ${inList}`, keep.id, ...rest);
    db.run(`UPDATE sessions SET deleted_ms = ? WHERE id ${inList}`, this.app.clock.now(), ...rest);
    db.run(
      `UPDATE sessions SET name = ?, ended_ms = ?, efficiency = ?,
         elapsed_sec = (SELECT COALESCE(ROUND(SUM(end_ms - start_ms) / 1000.0), 0) FROM segments WHERE session_id = ?) WHERE id = ?`,
      name, end, efficiency, keep.id, keep.id,
    );
    const mergeId = randomUUID();
    const before: Snapshot = { blocks: rows, segments, flags };
    db.run('INSERT INTO merges (id, keep_id, created_ms, before) VALUES (?, ?, ?, ?)', mergeId, keep.id as string, this.app.clock.now(), JSON.stringify(before));
    return { segments, flags, mergeId };
  }

  /**
   * P86: splits a merged block back into the blocks its latest merge combined, each exactly as it was before that
   * merge (answer, tag, rating); edits made to the merged block since are dropped. A block merged twice unmerges one
   * step at a time.
   */
  unmerge(id: string): EditResult {
    const rows = this.load([id]);
    if (!Array.isArray(rows)) return rows;
    const rec = this.db.get<MergeRecord>('SELECT * FROM merges WHERE keep_id = ? ORDER BY rowid DESC LIMIT 1', id);
    if (!rec) return invalid('This block wasn’t made by a merge');
    const before = JSON.parse(rec.before) as Snapshot;
    const ids = before.blocks.map((r) => r.id as string);
    const segIds = before.segments.map((g) => g.id);
    const flagIds = before.flags.map((f) => f.id);
    // What Undo puts back: the blocks and links as they are now.
    const now: Snapshot = {
      blocks: this.db.all(`SELECT * FROM sessions WHERE id IN (${marks(ids.length)})`, ...ids),
      segments: this.db.all(`SELECT id, session_id FROM segments WHERE id IN (${marks(segIds.length)})`, ...segIds),
      flags: this.db.all(`SELECT id, session_id FROM distraction_flags WHERE id IN (${marks(flagIds.length)})`, ...flagIds),
    };
    this.db.transaction(() => {
      this.put(before);
      this.db.run('DELETE FROM merges WHERE id = ?', rec.id);
    });
    const dates = [...new Set(before.blocks.map((r) => dateKey(r.started_ms as number)))];
    return this.finish({ id: randomUUID(), ...now, dates, removedMerge: rec }, `Unmerged “${answerOf(rows[0])}” into ${ids.length} blocks`);
  }

  /** Writes blocks and links back as a snapshot holds them; call inside a transaction. */
  private put(b: Snapshot): void {
    const db = this.db;
    for (const r of b.blocks) db.run(`UPDATE sessions SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...COLUMNS.map((c) => r[c] ?? null), r.id);
    for (const g of b.segments) db.run('UPDATE segments SET session_id = ? WHERE id = ?', g.session_id, g.id);
    for (const f of b.flags) db.run('UPDATE distraction_flags SET session_id = ? WHERE id = ?', f.session_id, f.id);
  }

  /**
   * Sets the blocks' tag (P66, P74). Answers stay; a break without an answer of its own that becomes work isn't
   * accounted for any more, and an unanswered block that becomes a break is.
   */
  tag(ids: string[], tag: Tag): EditResult {
    const rows = this.load(ids);
    if (!Array.isArray(rows)) return rows;
    const list = `IN (${marks(rows.length)})`;
    const rowIds = rows.map((r) => r.id);
    if (tag !== 'work') {
      // P75: a break has no efficiency, so a rating doesn't linger to come back if it's tagged Work again.
      this.db.run(`UPDATE sessions SET kind = 'break', tag = ?, name = COALESCE(name, ?), efficiency = NULL WHERE id ${list}`, tag === 'break' ? null : tag, BREAK_NAME, ...rowIds);
    } else {
      this.db.run(`UPDATE sessions SET name = CASE WHEN kind = 'break' AND name = ? THEN NULL ELSE name END, kind = 'open', tag = NULL WHERE id ${list}`, BREAK_NAME, ...rowIds);
    }
    const as: Record<Tag, string> = { work: 'work', break: 'a break', gym: 'gym', food: 'food', sleep: 'sleep' };
    const message = rows.length === 1 ? `“${answerOf(rows[0])}” is now ${as[tag]}` : `Tagged ${rows.length} blocks ${TAG_LABEL[tag]}`;
    return this.finish({ id: randomUUID(), blocks: rows, segments: [], flags: [], dates: [...new Set(rows.map((r) => dateKey(r.started_ms as number)))] }, message);
  }

  /** P75: rate work blocks 25, 50, 75 or 100%, or clear the rating (null). */
  rate(ids: string[], efficiency: Efficiency | null): EditResult {
    const rows = this.load(ids);
    if (!Array.isArray(rows)) return rows;
    if (rows.some((r) => rowTag(r) !== 'work')) return invalid('Only work blocks have an efficiency');
    this.db.run(`UPDATE sessions SET efficiency = ? WHERE id IN (${marks(rows.length)})`, efficiency, ...rows.map((r) => r.id));
    const what = efficiency === null ? 'not rated' : `${efficiency}% efficient`;
    const message = rows.length === 1 ? `“${answerOf(rows[0])}” is ${what}` : `${rows.length} blocks are ${what}`;
    return this.finish({ id: randomUUID(), blocks: rows, segments: [], flags: [], dates: [...new Set(rows.map((r) => dateKey(r.started_ms as number)))] }, message);
  }

  /** Puts the last edit back exactly. Only the most recent edit can be undone. */
  undo(undoId: string): { ok: true } | EngineError {
    const u = this.last;
    if (!u || u.id !== undoId) return invalid('Nothing to undo');
    this.last = null;
    const db = this.db;
    db.transaction(() => {
      this.put(u);
      if (u.madeMerges?.length) db.run(`DELETE FROM merges WHERE id IN (${marks(u.madeMerges.length)})`, ...u.madeMerges);
      const m = u.removedMerge;
      if (m) db.run('INSERT INTO merges (id, keep_id, created_ms, before) VALUES (?, ?, ?, ?)', m.id, m.keep_id, m.created_ms, m.before);
    });
    for (const d of u.dates) refreshReview(db, d, this.app.clock.now(), this.app.settings);
    this.host.dataChanged();
    return { ok: true };
  }
}
