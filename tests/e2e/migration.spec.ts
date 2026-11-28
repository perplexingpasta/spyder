/// <reference lib="dom" />
// P65: old sessions and away periods convert to blocks once (migration 003), including a session
// still running when Spyder last ran.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { loadMigrationsFromDisk } from '../../src/main/db/loadFromDisk';
import { migrate } from '../../src/main/db/migrate';
import { freshDataDir, launch, ROOT } from './helpers';

const T = (h: number, m = 0) => new Date(2026, 10, 24, h, m).getTime();

test('old sessions become one block each; away periods become blocks or untracked (P65)', async () => {
  const dir = freshDataDir();
  const db = new Db(join(dir, 'spyder.db'));
  migrate(db, loadMigrationsFromDisk(join(ROOT, 'src/main/db/migrations')).filter((m) => m.version <= 2), T(9));
  db.run("INSERT INTO projects (id, name, color, archived, created_ms) VALUES ('p1', 'Client A', '#22D3EE', 0, 0)");
  const session = (id: string, kind: string, name: string | null, s: number, e: number | null, status: string, project: string | null = null) => {
    db.run(
      `INSERT INTO sessions (id, kind, name, project_id, planned_sec, direction, status, started_ms, ended_ms, elapsed_sec, created_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, kind, name, project, kind === 'planned' || kind === 'timed' ? 1800 : null, kind === 'planned' ? 'down' : null, status, s, e,
      e === null ? 0 : (e - s) / 1000, s,
    );
    db.run('INSERT INTO segments (id, session_id, start_ms, end_ms, source) VALUES (?, ?, ?, ?, ?)', `g-${id}`, id, s, e, 'live');
  };
  session('a', 'planned', 'Replying to emails', T(10), T(10, 50), 'done', 'p1');
  session('b', 'timed', 'Inbox zero', T(10, 50), T(11, 5), 'done');
  session('c', 'open', null, T(11, 30), null, 'running'); // Spyder stopped while this ran
  const away = (id: string, s: number, e: number, c: string | null, label: string | null = null) =>
    db.run('INSERT INTO away_periods (id, start_ms, end_ms, reason, classification, label) VALUES (?, ?, ?, ?, ?, ?)', id, s, e, 'idle', c, label);
  away('w1', T(11, 5), T(11, 10), 'break');
  away('w2', T(11, 10), T(11, 20), 'meeting', 'Standup');
  away('w3', T(11, 20), T(11, 25), 'offline_work', 'Whiteboard');
  away('w4', T(11, 25), T(11, 30), 'not_working');
  db.run("INSERT INTO heartbeat (id, ts_ms, engine_state) VALUES (1, ?, '{\"mode\":\"working\",\"current\":{\"id\":\"c\"},\"prompts\":[]}')", T(11, 40));
  db.run("INSERT INTO settings (key, value) VALUES ('checkInIntervalSec', '900'), ('defaultDirection', '\"up\"')");
  db.close();

  const s = await launch({ dataDir: dir, now: '2026-11-24T12:00:00' });
  try {
    const rows = s.db().prepare('SELECT kind, name, project_id, planned_sec, status, started_ms, ended_ms FROM sessions WHERE deleted_ms IS NULL ORDER BY started_ms').all();
    expect(rows).toEqual([
      { kind: 'open', name: 'Replying to emails', project_id: null, planned_sec: null, status: 'done', started_ms: T(10), ended_ms: T(10, 50) },
      { kind: 'open', name: 'Inbox zero', project_id: null, planned_sec: null, status: 'done', started_ms: T(10, 50), ended_ms: T(11, 5) },
      { kind: 'break', name: 'Break', project_id: null, planned_sec: null, status: 'done', started_ms: T(11, 5), ended_ms: T(11, 10) },
      { kind: 'open', name: 'Standup', project_id: null, planned_sec: null, status: 'done', started_ms: T(11, 10), ended_ms: T(11, 20) },
      { kind: 'open', name: 'Whiteboard', project_id: null, planned_sec: null, status: 'done', started_ms: T(11, 20), ended_ms: T(11, 25) },
      // The running session ends at the last heartbeat and waits for an answer.
      { kind: 'open', name: null, project_id: null, planned_sec: null, status: 'done', started_ms: T(11, 30), ended_ms: T(11, 40) },
    ]);
    expect(s.db().prepare('SELECT COUNT(*) AS n FROM away_periods').get()).toEqual({ n: 0 });
    expect(s.db().prepare("SELECT COUNT(*) AS n FROM settings WHERE key IN ('checkInIntervalSec', 'defaultDirection')").get()).toEqual({ n: 0 });
    // Not working became untracked; the cut block is asked about; nothing is running.
    const vm = await s.dashboard.evaluate(() => window.spyder.getDay('2026-11-24'));
    expect(vm.summary.untracked.map((u) => [u.startMs, u.endMs])).toContainEqual([T(11, 25), T(11, 30)]);
    await expect(s.prompt.getByTestId('prompt-account')).toContainText('What did you do 11:30–11:40?');
    expect(((await s.debug.state()).host as { engine: { loop: unknown } }).engine.loop).toBeNull();
  } finally {
    await s.close();
  }
});

test('the old indigo Sleep default becomes beige; a picked colour stays (P106)', () => {
  const migrations = loadMigrationsFromDisk(join(ROOT, 'src/main/db/migrations'));
  const run = (stored: string) => {
    const db = new Db(join(freshDataDir(), 'spyder.db'));
    migrate(db, migrations.filter((m) => m.version <= 9), T(9));
    db.run("INSERT INTO settings (key, value) VALUES ('sleepColor', ?)", JSON.stringify(stored));
    migrate(db, migrations, T(9));
    const v = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'sleepColor'")!.value;
    db.close();
    return JSON.parse(v) as string;
  };
  expect(run('#6c71c4')).toBe('#e8dcc4');
  expect(run('#123456')).toBe('#123456');
});
