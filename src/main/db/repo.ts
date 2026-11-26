// SQL for the engine host and data IPC. All rows use epoch ms (plan §3).
import { randomUUID } from 'node:crypto';
import type { Rule } from '../../core/categorize';
import type { ActivityRow } from '../../core/merge';
import type { DayOverride } from '../../core/schedule';
import type { TitlePattern } from '../../core/titlePatterns';
import type { ScheduleRow } from '../../core/settings';
import type { Effect, Efficiency, EngineState, Heartbeat, Tag } from '../../core/types';
import type { Db, SqlValue } from './db';

type DbEffect = Extract<Effect, { db: string }>;

const n = (v: unknown): SqlValue => (v === undefined ? null : (v as SqlValue));

/** Applies engine DB effects in order, in one transaction. */
export function applyDbEffects(db: Db, effects: DbEffect[]): void {
  if (!effects.length) return;
  db.transaction(() => {
    for (const e of effects) applyOne(db, e);
  });
}

const SESSION_COLS = {
  name: 'name',
  projectId: 'project_id',
  plannedSec: 'planned_sec',
  status: 'status',
  endedMs: 'ended_ms',
  elapsedSec: 'elapsed_sec',
  overtimeSec: 'overtime_sec',
  endReason: 'end_reason',
};

function applyOne(db: Db, e: DbEffect): void {
  switch (e.db) {
    case 'insertSession': {
      const r = e.row;
      db.run(
        `INSERT INTO sessions (id, kind, name, project_id, planned_sec, direction, status, started_ms, created_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.id, r.kind, r.name, r.projectId, r.plannedSec, r.direction, r.status, r.startedMs, r.createdMs,
      );
      return;
    }
    case 'updateSession': {
      const r = e.row as unknown as Record<string, unknown> & { id: string };
      const set = Object.entries(SESSION_COLS).filter(([k]) => k in r);
      if (!set.length) return;
      db.run(
        `UPDATE sessions SET ${set.map(([, c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
        ...set.map(([k]) => n(r[k])),
        r.id,
      );
      return;
    }
    case 'openSegment':
      db.run(
        'INSERT INTO segments (id, session_id, start_ms, end_ms, source) VALUES (?, ?, ?, NULL, ?)',
        e.row.id, e.row.sessionId, e.row.startMs, e.row.source,
      );
      return;
    case 'closeSegment':
      db.run('UPDATE segments SET end_ms = ? WHERE id = ?', e.row.endMs, e.row.id);
      return;
    case 'discardSession':
      db.run('DELETE FROM segments WHERE session_id = ?', e.id);
      db.run('DELETE FROM sessions WHERE id = ?', e.id);
      return;
    case 'insertGapBlock':
      insertEndedBlock(db, e.row);
      return;
  }
}

/** An ended block with one segment over [startMs, endMs): a filled gap (P95). A break's name is never NULL. */
export function insertEndedBlock(
  db: Db,
  b: { id: string; segmentId: string; startMs: number; endMs: number; tag: Tag; name: string | null; createdMs: number },
): void {
  db.run(
    `INSERT INTO sessions (id, kind, tag, name, status, started_ms, ended_ms, elapsed_sec, end_reason, created_ms)
     VALUES (?, ?, ?, ?, 'done', ?, ?, ?, 'done', ?)`,
    b.id, b.tag === 'work' ? 'open' : 'break', b.tag === 'work' || b.tag === 'break' ? null : b.tag,
    b.tag === 'work' ? b.name : (b.name ?? BREAK_NAME), b.startMs, b.endMs, Math.round((b.endMs - b.startMs) / 1000), b.createdMs,
  );
  db.run(`INSERT INTO segments (id, session_id, start_ms, end_ms, source) VALUES (?, ?, ?, ?, 'live')`, b.segmentId, b.id, b.startMs, b.endMs);
}

// ---- heartbeat ---------------------------------------------------------------
export function loadHeartbeat(db: Db): Heartbeat | null {
  const r = db.get<{ ts_ms: number; engine_state: string }>('SELECT ts_ms, engine_state FROM heartbeat WHERE id = 1');
  if (!r) return null;
  try {
    return { tsMs: r.ts_ms, state: JSON.parse(r.engine_state) as EngineState };
  } catch {
    return null;
  }
}

export function saveHeartbeat(db: Db, tsMs: number, state: EngineState): void {
  db.run(
    `INSERT INTO heartbeat (id, ts_ms, engine_state) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ts_ms = excluded.ts_ms, engine_state = excluded.engine_state`,
    tsMs,
    JSON.stringify(state),
  );
}

// ---- schedule ----------------------------------------------------------------
export function loadSchedule(db: Db): ScheduleRow[] {
  return db
    .all<{ weekday: number; enabled: number; start_min: number; end_min: number }>('SELECT * FROM schedule')
    .map((r) => ({ weekday: r.weekday, enabled: !!r.enabled, startMin: r.start_min, endMin: r.end_min }));
}

export function loadOverrides(db: Db): Map<string, DayOverride> {
  const rows = db.all<{ date: string; enabled: number; start_min: number; end_min: number }>(
    'SELECT * FROM day_overrides',
  );
  return new Map(
    rows.map((r) => [r.date, { date: r.date, enabled: !!r.enabled, startMin: r.start_min, endMin: r.end_min }]),
  );
}

export function saveSchedule(db: Db, rows: ScheduleRow[]): void {
  db.transaction(() => {
    for (const r of rows) {
      db.run(
        `INSERT INTO schedule (weekday, enabled, start_min, end_min) VALUES (?, ?, ?, ?)
         ON CONFLICT(weekday) DO UPDATE SET enabled = excluded.enabled, start_min = excluded.start_min, end_min = excluded.end_min`,
        r.weekday, r.enabled ? 1 : 0, r.startMin, r.endMin,
      );
    }
  });
}

export function deleteOverride(db: Db, date: string): void {
  db.run('DELETE FROM day_overrides WHERE date = ?', date);
}

export function upsertOverride(db: Db, o: DayOverride): void {
  db.run(
    `INSERT INTO day_overrides (date, enabled, start_min, end_min) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET enabled = excluded.enabled, start_min = excluded.start_min, end_min = excluded.end_min`,
    o.date, o.enabled ? 1 : 0, o.startMin, o.endMin,
  );
}

// ---- sessions & projects -------------------------------------------------------
// ---- blocks (ADR-0011: a block is a session row of kind 'open' or 'break') ---------
/** Ended blocks in [fromMs, toMs) not accounted for yet, oldest first (P60). */
/** Ended work blocks without an answer, plus the filled gaps in `gapIds` still reading `gapName` (P95). */
export function pendingBlocks(
  db: Db,
  fromMs: number,
  toMs: number,
  gapIds: string[] = [],
  gapName = '',
): { id: string; start_ms: number; end_ms: number; tag: string | null }[] {
  return db.all(
    `SELECT id, started_ms AS start_ms, ended_ms AS end_ms, tag FROM sessions
      WHERE ((kind = 'open' AND name IS NULL) OR (id IN (${gapIds.map(() => '?').join(',')}) AND name = ?))
        AND status = 'done' AND deleted_ms IS NULL AND ended_ms IS NOT NULL
        AND started_ms >= ? AND started_ms < ? ORDER BY started_ms`,
    ...gapIds, gapName, fromMs, toMs,
  );
}

/** The most recent work answer, for "Same as last". */
export function lastAnswer(db: Db): string | null {
  return (
    db.get<{ name: string }>(
      `SELECT name FROM sessions WHERE kind = 'open' AND name IS NOT NULL AND deleted_ms IS NULL ORDER BY COALESCE(ended_ms, started_ms) DESC LIMIT 1`,
    )?.name ?? null
  );
}

/** Apps or sites with the most foreground time in [startMs, endMs), most first. */
export function topApps(db: Db, startMs: number, endMs: number, limit = 3): string[] {
  return db
    .all<{ k: string }>(
      `SELECT COALESCE(domain, app_name) AS k, SUM(MIN(end_ms, ?) - MAX(start_ms, ?)) AS ms FROM activity
        WHERE start_ms < ? AND end_ms > ? AND is_private = 0 GROUP BY k ORDER BY ms DESC LIMIT ?`,
      endMs, startMs, endMs, startMs, limit,
    )
    .map((r) => r.k);
}

/**
 * One block's answer (P60, P66, P74): free text, or null for none (only a work block needs one). `tag` sets Work,
 * Break, Gym or Food; left out, the block keeps its tag.
 */
export interface BlockAnswer {
  id: string;
  answer: string | null;
  tag?: Tag;
  /** P75: a work block's rating; null clears it, left out keeps it. */
  efficiency?: Efficiency | null;
}

/** A break block with no answer of its own stores the name 'Break' (as before P66), so a break's name is never NULL. */
export const BREAK_NAME = 'Break';

export function writeAnswers(db: Db, answers: { id: string; answer: string | null; tag: Tag; efficiency?: Efficiency | null }[]): void {
  db.transaction(() => {
    for (const a of answers) {
      if (a.efficiency !== undefined) db.run('UPDATE sessions SET efficiency = ? WHERE id = ?', a.efficiency, a.id);
      // P75: a break has no efficiency.
      if (a.tag !== 'work') db.run(`UPDATE sessions SET kind = 'break', tag = ?, name = ?, efficiency = NULL WHERE id = ?`, a.tag === 'break' ? null : a.tag, a.answer ?? BREAK_NAME, a.id);
      else db.run(`UPDATE sessions SET kind = 'open', tag = NULL, name = ? WHERE id = ?`, a.answer, a.id);
    }
  });
}

export function sessionRow(db: Db, id: string): { name: string | null; elapsed_sec: number; planned_sec: number | null } | undefined {
  return db.get('SELECT name, elapsed_sec, planned_sec FROM sessions WHERE id = ?', id);
}

/** Earlier work answers starting with `prefix`, most recent first. */
export function answerSuggestions(db: Db, prefix: string): string[] {
  return db
    .all<{ name: string }>(
      `SELECT name FROM sessions WHERE name IS NOT NULL AND deleted_ms IS NULL AND name LIKE ? ESCAPE '\\' AND kind != 'break'
       GROUP BY name COLLATE NOCASE ORDER BY MAX(started_ms) DESC LIMIT 8`,
      `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    )
    .map((r) => r.name);
}

export interface ProjectRow {
  id: string;
  name: string;
  color: string;
  archived: boolean;
}

export function listProjects(db: Db): ProjectRow[] {
  return db
    .all<{ id: string; name: string; color: string; archived: number }>(
      'SELECT id, name, color, archived FROM projects ORDER BY name COLLATE NOCASE',
    )
    .map((r) => ({ ...r, archived: !!r.archived }));
}

export function saveProject(
  db: Db,
  p: { id?: string; name: string; color?: string; archived?: boolean },
  nowMs: number,
): ProjectRow {
  const id = p.id ?? randomUUID();
  db.run(
    `INSERT INTO projects (id, name, color, archived, created_ms) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, archived = excluded.archived`,
    id, p.name.trim(), p.color ?? '#7B61FF', p.archived ? 1 : 0, nowMs,
  );
  return listProjects(db).find((r) => r.id === id)!;
}

// ---- rules & flags -----------------------------------------------------------
export function loadRules(db: Db): Rule[] {
  return db
    .all<{ match_type: Rule['matchType']; pattern: string; category: Rule['category']; is_default: number }>(
      'SELECT match_type, pattern, category, is_default FROM rules',
    )
    .map((r) => ({ matchType: r.match_type, pattern: r.pattern, category: r.category, isDefault: !!r.is_default }));
}

export interface RuleRow extends Rule {
  id: string;
}

export function listRules(db: Db): RuleRow[] {
  return db
    .all<{ id: string; match_type: Rule['matchType']; pattern: string; category: Rule['category']; is_default: number }>(
      'SELECT id, match_type, pattern, category, is_default FROM rules ORDER BY is_default, match_type, pattern',
    )
    .map((r) => ({ id: r.id, matchType: r.match_type, pattern: r.pattern, category: r.category, isDefault: !!r.is_default }));
}

/**
 * Upserts a user rule (is_default = 0); a user rule beats any default (§9.4). With `id` (editing a
 * user rule) the old row is replaced. Default rows are never changed; a category change on one
 * creates a user rule with the same pattern.
 */
export function saveRule(
  db: Db,
  r: { id?: string; matchType: Rule['matchType']; pattern: string; category: Rule['category'] },
  nowMs: number,
): void {
  if (!r.pattern.trim()) return;
  db.transaction(() => {
    if (r.id) db.run('DELETE FROM rules WHERE id = ? AND is_default = 0', r.id);
    db.run(
    `INSERT INTO rules (id, match_type, pattern, category, is_default, created_ms) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(match_type, pattern, is_default) DO UPDATE SET category = excluded.category`,
    randomUUID(), r.matchType, r.pattern.trim().toLowerCase(), r.category, nowMs,
    );
  });
}

export function deleteRule(db: Db, id: string): void {
  db.run('DELETE FROM rules WHERE id = ? AND is_default = 0', id);
}

export interface TitlePatternRow extends TitlePattern {
  id: string;
  isDefault: boolean;
}

export function listTitlePatternRows(db: Db): TitlePatternRow[] {
  return db
    .all<{ id: string; match: TitlePattern['match']; pattern: string; domain: string; is_default: number }>(
      'SELECT id, match, pattern, domain, is_default FROM title_patterns ORDER BY is_default, domain, pattern',
    )
    .map((r) => ({ id: r.id, match: r.match, pattern: r.pattern, domain: r.domain, isDefault: !!r.is_default }));
}

/** Adds or edits a user title pattern. Default patterns are read-only. */
export function saveTitlePattern(db: Db, p: { id?: string; match: TitlePattern['match']; pattern: string; domain: string }): void {
  const pattern = p.pattern.trim();
  const domain = p.domain.trim().toLowerCase().replace(/^www\./, '');
  if (!pattern || !domain) return;
  if (p.id) db.run('UPDATE title_patterns SET match = ?, pattern = ?, domain = ? WHERE id = ? AND is_default = 0', p.match, pattern, domain, p.id);
  else db.run('INSERT INTO title_patterns (id, match, pattern, domain, is_default) VALUES (?, ?, ?, ?, 0)', randomUUID(), p.match, pattern, domain);
}

export function deleteTitlePattern(db: Db, id: string): void {
  db.run('DELETE FROM title_patterns WHERE id = ? AND is_default = 0', id);
}

export function awayRow(
  db: Db,
  id: string,
): { start_ms: number; end_ms: number; interrupted_session_id: string | null } | undefined {
  return db.get('SELECT start_ms, end_ms, interrupted_session_id FROM away_periods WHERE id = ?', id);
}

export function insertFlag(
  db: Db,
  f: { tsMs: number; sessionId: string | null; target: string; continuousSec: number },
): void {
  db.run(
    'INSERT INTO distraction_flags (id, ts_ms, session_id, target, continuous_sec) VALUES (?, ?, ?, ?, ?)',
    randomUUID(), f.tsMs, f.sessionId, f.target, f.continuousSec,
  );
}

// ---- activity capture (plan §9) ----------------------------------------------------
export function insertActivity(db: Db, rows: ActivityRow[]): void {
  if (!rows.length) return;
  db.transaction(() => {
    for (const r of rows) {
      db.run(
        'INSERT INTO activity (start_ms, end_ms, exe, app_name, title, domain, browser, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        r.startMs, r.endMs, r.exe, r.appName, r.title, r.domain, r.browser, r.isPrivate ? 1 : 0,
      );
    }
  });
}

export function loadTitlePatterns(db: Db): TitlePattern[] {
  return db.all<TitlePattern>('SELECT match, pattern, domain FROM title_patterns');
}
