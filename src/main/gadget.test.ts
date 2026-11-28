import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Db } from './db/db';
import { loadMigrationsFromDisk } from './db/loadFromDisk';
import { migrate } from './db/migrate';
import { addRow, autoAdd, clearTicked, editRow, importList, importRows, listRows } from './gadget';
import { saveReflection } from './reflect';

const MIGRATIONS = loadMigrationsFromDisk(join(__dirname, 'db', 'migrations'));
let db: Db;
const texts = () => listRows(db).map((r) => r.text);
const improve = (date: string, text: string, sort: number) =>
  db.run(
    "INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES (?, ?, 'improve', ?, ?, 0)",
    `${date}-${sort}`,
    date,
    text,
    sort,
  );

beforeEach(() => {
  db = new Db(':memory:');
  migrate(db, MIGRATIONS, 0);
});

describe('migration 011', () => {
  it('seeds the gadget with the last day that has improvements, in review order', () => {
    const old = new Db(':memory:');
    migrate(
      old,
      MIGRATIONS.filter((m) => m.version <= 10),
      0,
    );
    db = old;
    improve('2026-11-20', 'Old one', 0);
    improve('2026-11-25', 'Second', 1);
    improve('2026-11-25', 'First', 0);
    db.run(
      "INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES ('w', '2026-11-26', 'win', 'A win', 0, 0)",
    );
    migrate(db, MIGRATIONS, 0);
    expect(listRows(db).map((r) => [r.date, r.text])).toEqual([
      ['2026-11-25', 'First'],
      ['2026-11-25', 'Second'],
    ]);
  });
});

describe('gadget rows', () => {
  it('auto-adds new and reworded improvements only, and never brings a removed row back', () => {
    expect(autoAdd(db, '2026-11-26', [{ text: 'Sleep by midnight', sort: 0 }], 1)).toBe(1);
    expect(autoAdd(db, '2026-11-26', [{ text: ' sleep  BY midnight ', sort: 0 }], 2)).toBe(0);
    expect(autoAdd(db, '2026-11-26', [{ text: 'Sleep by 11', sort: 0 }], 3)).toBe(1);
    expect(autoAdd(db, '2026-11-27', [{ text: 'Sleep by midnight', sort: 0 }], 4)).toBe(1);
    const id = listRows(db).find((r) => r.text === 'Sleep by 11')!.id;
    editRow(db, id, { removed: true }, 5);
    expect(autoAdd(db, '2026-11-26', [{ text: 'Sleep by 11', sort: 0 }], 6)).toBe(0);
    expect(texts()).not.toContain('Sleep by 11');
    // Import can bring it back.
    improve('2026-11-26', 'Sleep by 11', 0);
    expect(importList(db).find((d) => d.date === '2026-11-26')!.items).toEqual([
      { text: 'Sleep by 11', sort: 0, added: false },
    ]);
    expect(importRows(db, [{ date: '2026-11-26', text: 'Sleep by 11', sort: 0 }], 7)).toBe(1);
    expect(importRows(db, [{ date: '2026-11-26', text: 'Sleep by 11', sort: 0 }], 8)).toBe(0);
    expect(importList(db).find((d) => d.date === '2026-11-26')!.items[0].added).toBe(true);
  });

  it('the midnight card adds its improvements, but not its wins', () => {
    saveReflection(
      db,
      '2026-11-26',
      { win: ['Shipped'], improve: ['Fewer tabs', 'Lunch away from desk'] },
      10,
    );
    expect(texts()).toEqual(['Fewer tabs', 'Lunch away from desk']);
    saveReflection(db, '2026-11-26', null, 11);
    expect(texts()).toHaveLength(2);
  });

  it('adds, edits, ticks, colours, removes and undoes', () => {
    expect(addRow(db, '  \n ', '2026-11-28', 1)).toBeNull();
    const r = addRow(db, 'Walk\nafter lunch', '2026-11-28', 1)!;
    expect(r.text).toBe('Walk after lunch');
    editRow(db, r.id, { text: 'Walk after lunch daily', color: 'green' }, 2);
    expect(listRows(db)[0]).toMatchObject({ text: 'Walk after lunch daily', color: 'green', tickedMs: null });
    editRow(db, r.id, { ticked: true }, 3);
    expect(listRows(db)[0].tickedMs).toBe(3);
    editRow(db, r.id, { ticked: false, color: null }, 4);
    expect(listRows(db)[0]).toMatchObject({ tickedMs: null, color: null });
    editRow(db, r.id, { text: '   ' }, 5);
    expect(listRows(db)).toEqual([]);
    editRow(db, r.id, { removed: false }, 6);
    expect(texts()).toEqual(['Walk after lunch daily']);
  });

  it('Clear ticked removes only ticked rows', () => {
    const a = addRow(db, 'A', '2026-11-28', 1)!;
    addRow(db, 'B', '2026-11-28', 2);
    editRow(db, a.id, { ticked: true }, 3);
    expect(clearTicked(db, 4)).toEqual([a.id]);
    expect(texts()).toEqual(['B']);
  });
});
