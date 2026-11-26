// Loads a day's rows and builds the report view models (plan §10). No electron import, so the
// e2e tests can compute the same numbers from the same DB.
import { randomUUID } from 'node:crypto';
import { daySummary, type DayData, type DaySummary } from '../core/aggregate';
import { leftovers, type DayVM, type Kpi, type ReviewItem, type ReviewVM } from '../core/review';
import { addDays, dateKey, dayStartFromKey, workWindow } from '../core/schedule';
import type { Settings } from '../core/settings';
import { streak } from '../core/streaks';
import { relabelFirefox } from '../core/titlePatterns';
import type { DayActivity } from '../core/aggregate';
import { toAsk, type AskRow } from '../core/asks';
import { dayLite, type RangeVM } from '../core/trends';
import type { Db } from './db/db';
import * as repo from './db/repo';
import { reflectedMs } from './reflect';

const DAY_MS = 86_400_000;

function rawActivity(db: Db, d0: number, d1: number): DayData['activity'] {
  return db
    .all<{ start_ms: number; end_ms: number; exe: string; app_name: string; title: string | null; domain: string | null; browser: DayData['activity'][number]['browser']; is_private: number }>(
      // The lower start bound lets the index work; activity rows are far shorter than a day.
      'SELECT start_ms, end_ms, exe, app_name, title, domain, browser, is_private FROM activity WHERE start_ms >= ? AND start_ms < ? AND end_ms > ? ORDER BY start_ms',
      d0 - DAY_MS, d1, d0,
    )
    .map((r) => ({
      startMs: r.start_ms, endMs: r.end_ms, exe: r.exe, appName: r.app_name, title: r.title, domain: r.domain,
      browser: r.browser, isPrivate: !!r.is_private,
    }));
}

export function loadDayData(db: Db, date: string, nowMs: number): DayData {
  const d0 = dayStartFromKey(date);
  const d1 = addDays(d0, 1);
  const sessions = db
    .all<{
      id: string; kind: DayData['sessions'][number]['kind']; name: string | null; project_id: string | null;
      pname: string | null; pcolor: string | null; planned_sec: number | null; status: DayData['sessions'][number]['status'];
      started_ms: number; ended_ms: number | null; end_reason: DayData['sessions'][number]['endReason']; tag: 'gym' | 'food' | 'sleep' | null;
      efficiency: number | null; merged: number;
    }>(
      `SELECT s.id, s.kind, s.name, s.project_id, p.name AS pname, p.color AS pcolor, s.planned_sec, s.status,
              s.started_ms, s.ended_ms, s.end_reason, s.tag, s.efficiency,
              EXISTS (SELECT 1 FROM merges m WHERE m.keep_id = s.id) AS merged
         FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
        WHERE s.deleted_ms IS NULL
          AND ((s.started_ms >= ? AND s.started_ms < ?)
           OR s.id IN (SELECT session_id FROM segments WHERE start_ms < ? AND COALESCE(end_ms, ?) > ?))`,
      d0, d1, d1, nowMs, d0,
    )
    .map((r) => ({
      id: r.id, kind: r.kind, name: r.name, projectId: r.project_id, projectName: r.pname, projectColor: r.pcolor,
      plannedSec: r.planned_sec, status: r.status, startedMs: r.started_ms, endedMs: r.ended_ms, endReason: r.end_reason, tag: r.tag, efficiency: r.efficiency,
      merged: !!r.merged,
    }));
  const ids = sessions.map((s) => s.id);
  const segments = ids.length
    ? db
        .all<{ session_id: string; start_ms: number; end_ms: number | null }>(
          `SELECT session_id, start_ms, end_ms FROM segments WHERE session_id IN (${ids.map(() => '?').join(',')})`,
          ...ids,
        )
        .map((r) => ({ sessionId: r.session_id, startMs: r.start_ms, endMs: r.end_ms }))
    : [];
  const away = db
    .all<{ id: string; start_ms: number; end_ms: number; reason: DayData['away'][number]['reason']; classification: DayData['away'][number]['classification']; label: string | null }>(
      'SELECT id, start_ms, end_ms, reason, classification, label FROM away_periods WHERE start_ms < ? AND end_ms > ?',
      d1, d0,
    )
    .map((r) => ({ id: r.id, startMs: r.start_ms, endMs: r.end_ms, reason: r.reason, classification: r.classification, label: r.label }));
  const activity = relabelFirefox(rawActivity(db, d0, d1), repo.loadTitlePatterns(db));
  const flags = db
    .all<{ ts_ms: number; target: string; continuous_sec: number; session_id: string | null }>(
      'SELECT ts_ms, target, continuous_sec, session_id FROM distraction_flags WHERE ts_ms >= ? AND ts_ms < ?',
      d0, d1,
    )
    .map((r) => ({ tsMs: r.ts_ms, target: r.target, continuousSec: r.continuous_sec, sessionId: r.session_id }));
  const window = workWindow(d0, repo.loadSchedule(db), repo.loadOverrides(db));
  return { sessions, segments, away, activity, flags, window, nowMs };
}

export function summaryFor(db: Db, date: string, nowMs: number, settings: Settings): DaySummary {
  return daySummary(date, loadDayData(db, date, nowMs), repo.loadRules(db), settings);
}

/** Current streak as of today (P27). Days after today never count. */
export function currentStreak(db: Db, nowMs: number, settings: Settings): number {
  const today = dateKey(nowMs);
  const schedule = repo.loadSchedule(db);
  const overrides = repo.loadOverrides(db);
  return streak(today, (key) => {
    const scheduled = workWindow(dayStartFromKey(key), schedule, overrides) !== null;
    return { scheduled, goalMet: scheduled && summaryFor(db, key, nowMs, settings).goalMet };
  });
}

export function dayVM(db: Db, date: string | undefined, nowMs: number, settings: Settings): DayVM {
  const today = dateKey(nowMs);
  const d = date ?? today;
  return { date: d, today, nowMs, summary: summaryFor(db, d, nowMs, settings), streak: currentStreak(db, nowMs, settings) };
}

/** Week / Month pages: one DayLite per date in [from, to] (inclusive). */
export function rangeVM(db: Db, from: string, to: string, nowMs: number, settings: Settings): RangeVM {
  const today = dateKey(nowMs);
  const days = [];
  for (let ms = dayStartFromKey(from); dateKey(ms) <= to && days.length < 62; ms = addDays(ms, 1)) {
    days.push(dayLite(summaryFor(db, dateKey(ms), nowMs, settings), today));
  }
  return {
    from,
    to,
    today,
    days,
    streak: currentStreak(db, nowMs, settings),
    kpis: listKpis(db).filter((k) => !k.archived).map(({ id, name, unit }) => ({ id, name, unit })),
    kpiValues: db
      .all<{ date: string; kpi_id: string; value: number }>('SELECT date, kpi_id, value FROM kpi_values WHERE date >= ? AND date <= ? ORDER BY date', from, to)
      .map((r) => ({ date: r.date, kpiId: r.kpi_id, value: r.value })),
  };
}

/** P70: apps and sites still waiting for the user's own label, from their time in [fromMs, toMs) (default: all time). */
export function listToAsk(db: Db, fromMs = 0, toMs = Number.MAX_SAFE_INTEGER, minSec?: number): AskRow[] {
  const rows = db
    .all<{ exe: string; app_name: string; title: string | null; domain: string | null; browser: DayActivity['browser']; is_private: number; ms: number }>(
      `SELECT exe, app_name, title, domain, browser, is_private, SUM(MIN(end_ms, ?) - MAX(start_ms, ?)) AS ms FROM activity
        WHERE start_ms < ? AND end_ms > ? GROUP BY exe, app_name, title, domain, browser, is_private`,
      toMs, fromMs, toMs, fromMs,
    )
    .map((r) => ({ exe: r.exe, appName: r.app_name, title: r.title, domain: r.domain, browser: r.browser, isPrivate: !!r.is_private, ms: r.ms }));
  return toAsk(relabelFirefox(rows, repo.loadTitlePatterns(db)), repo.loadRules(db), minSec);
}

// ---- review (P24) -------------------------------------------------------------------
export function listKpis(db: Db): Kpi[] {
  return db
    .all<{ id: string; name: string; unit: string | null; archived: number; sort: number }>('SELECT * FROM kpis ORDER BY sort, name')
    .map((r) => ({ ...r, archived: !!r.archived }));
}

export function reviewVM(db: Db, date: string | undefined, nowMs: number, settings: Settings): ReviewVM {
  const today = dateKey(nowMs);
  const d = date ?? today;
  const summary = summaryFor(db, d, nowMs, settings);
  const row = db.get<{ completed_ms: number | null }>('SELECT completed_ms FROM reviews WHERE date = ?', d);
  return {
    date: d,
    today,
    summary,
    completedMs: row?.completed_ms ?? null,
    reflectedMs: reflectedMs(db, d),
    items: db.all<ReviewItem>('SELECT id, date, kind, text, sort FROM review_items WHERE date = ? ORDER BY sort, created_ms', d),
    kpis: listKpis(db).filter((k) => !k.archived),
    kpiValues: Object.fromEntries(
      db.all<{ kpi_id: string; value: number }>('SELECT kpi_id, value FROM kpi_values WHERE date = ?', d).map((r) => [r.kpi_id, r.value]),
    ),
    leftoverCount: leftovers(summary),
  };
}

export function saveReviewItem(db: Db, it: Omit<ReviewItem, 'id'> & { id?: string }, nowMs: number): ReviewItem {
  const id = it.id ?? randomUUID();
  db.run(
    `INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, sort = excluded.sort, kind = excluded.kind`,
    id, it.date, it.kind, it.text, it.sort, nowMs,
  );
  return { ...it, id };
}

export function deleteReviewItem(db: Db, id: string): void {
  db.run('DELETE FROM review_items WHERE id = ?', id);
}

export function saveKpi(db: Db, k: { id?: string; name: string; unit?: string | null; archived?: boolean }): Kpi {
  const id = k.id ?? randomUUID();
  const sort = k.id ? undefined : (db.get<{ m: number | null }>('SELECT MAX(sort) AS m FROM kpis')?.m ?? -1) + 1;
  db.run(
    `INSERT INTO kpis (id, name, unit, archived, sort) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, unit = excluded.unit, archived = excluded.archived`,
    id, k.name.trim(), k.unit?.trim() || null, k.archived ? 1 : 0, sort ?? 0,
  );
  return listKpis(db).find((x) => x.id === id)!;
}

export function setKpiValue(db: Db, date: string, kpiId: string, value: number | null): void {
  if (value === null || !Number.isFinite(value)) db.run('DELETE FROM kpi_values WHERE date = ? AND kpi_id = ?', date, kpiId);
  else
    db.run(
      'INSERT INTO kpi_values (date, kpi_id, value) VALUES (?, ?, ?) ON CONFLICT(date, kpi_id) DO UPDATE SET value = excluded.value',
      date, kpiId, value,
    );
}

/** P52: after an edit, a completed review's snapshot numbers follow the day (completion time unchanged). */
export function refreshReview(db: Db, date: string, nowMs: number, settings: Settings): void {
  if (!db.get('SELECT 1 AS x FROM reviews WHERE date = ? AND completed_ms IS NOT NULL', date)) return;
  const s = summaryFor(db, date, nowMs, settings);
  db.run(
    'UPDATE reviews SET productive_sec = ?, work_sec = ?, scheduled_sec = ?, goal_sec = ?, goal_met = ?, score = ? WHERE date = ?',
    s.productiveSec, s.workSec, s.scheduledSec, s.goalSec, s.goalMet ? 1 : 0, s.score, date,
  );
}

/** Writes the `reviews` snapshot. Refused while leftovers remain. */
export function completeReview(db: Db, date: string, nowMs: number, settings: Settings): { ok: true } | { error: 'leftovers'; count: number } {
  const s = summaryFor(db, date, nowMs, settings);
  const count = leftovers(s);
  if (count > 0) return { error: 'leftovers', count };
  db.run(
    `INSERT INTO reviews (date, completed_ms, productive_sec, work_sec, scheduled_sec, goal_sec, goal_met, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET completed_ms = excluded.completed_ms, productive_sec = excluded.productive_sec,
       work_sec = excluded.work_sec, scheduled_sec = excluded.scheduled_sec, goal_sec = excluded.goal_sec,
       goal_met = excluded.goal_met, score = excluded.score`,
    date, nowMs, s.productiveSec, s.workSec, s.scheduledSec, s.goalSec, s.goalMet ? 1 : 0, s.score,
  );
  return { ok: true };
}
