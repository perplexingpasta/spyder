import { describe, expect, it } from 'vitest';
import {
  cleanText,
  gadgetDate,
  importView,
  isLabelColor,
  normText,
  orderRows,
  sameImprovement,
  type GadgetRow,
} from './gadget';

const row = (id: string, date: string, o: Partial<GadgetRow> = {}): GadgetRow => ({
  id,
  date,
  text: id,
  color: null,
  tickedMs: null,
  createdMs: 0,
  sort: 0,
  ...o,
});
const ids = (rows: GadgetRow[]) => rows.map((r) => r.id);

describe('gadget text', () => {
  it('normalises case, inner spaces and ends', () => {
    expect(normText('  Sleep   by\tMidnight ')).toBe('sleep by midnight');
    expect(
      sameImprovement(
        { date: '2026-11-26', text: 'Sleep by midnight' },
        { date: '2026-11-26', text: ' sleep  BY midnight' },
      ),
    ).toBe(true);
    expect(
      sameImprovement({ date: '2026-11-26', text: 'Sleep' }, { date: '2026-11-27', text: 'Sleep' }),
    ).toBe(false);
    expect(
      sameImprovement(
        { date: '2026-11-26', text: 'Sleep early' },
        { date: '2026-11-26', text: 'Sleep earlier' },
      ),
    ).toBe(false);
  });

  it('turns line breaks into spaces', () => {
    expect(cleanText(' one\ntwo\r\nthree\rfour ')).toBe('one two three four');
  });

  it('knows the six label colours', () => {
    expect(isLabelColor('green')).toBe(true);
    expect(isLabelColor('pink')).toBe(false);
    expect(isLabelColor(null)).toBe(false);
  });
});

describe('orderRows', () => {
  it('puts fresh rows first, newest date first', () => {
    const rows = [
      row('old', '2026-11-20'),
      row('t', '2026-11-27', { tickedMs: 5 }),
      row('new', '2026-11-26'),
    ];
    expect(ids(orderRows(rows))).toEqual(['new', 'old', 't']);
  });

  it('keeps a batch in review order, with a newer row on the same date on top', () => {
    const rows = [
      row('b', '2026-11-26', { sort: 1, createdMs: 10 }),
      row('a', '2026-11-26', { sort: 0, createdMs: 10 }),
      row('manual', '2026-11-26', { createdMs: 20 }),
    ];
    expect(ids(orderRows(rows))).toEqual(['manual', 'a', 'b']);
  });

  it('shows ticked rows most recently ticked first, and unticking puts a row back in its date place', () => {
    const rows = [
      row('x', '2026-11-26', { tickedMs: 100 }),
      row('y', '2026-11-20', { tickedMs: 200 }),
      row('z', '2026-11-24'),
    ];
    expect(ids(orderRows(rows))).toEqual(['z', 'y', 'x']);
    rows[0].tickedMs = null;
    expect(ids(orderRows(rows))).toEqual(['x', 'z', 'y']);
  });
});

describe('gadgetDate', () => {
  it('shows the year only when it is not this year', () => {
    expect(gadgetDate('2026-11-26', '2026-11-28')).toBe('Nov 26');
    expect(gadgetDate('2025-12-31', '2026-01-01')).toBe('Dec 31, 2025');
    expect(gadgetDate('2026-01-01', '2026-01-01')).toBe('Jan 1');
  });
});

describe('importView', () => {
  it('lists days newest first in review order and flags what is already on the gadget', () => {
    const days = [
      {
        date: '2026-11-20',
        items: [
          { text: 'B', sort: 1 },
          { text: 'A', sort: 0 },
        ],
      },
      { date: '2026-11-25', items: [{ text: 'C', sort: 0 }] },
      { date: '2026-11-22', items: [] },
    ];
    const v = importView(days, [
      { date: '2026-11-20', text: ' a ' },
      { date: '2026-11-25', text: 'B' },
    ]);
    expect(v).toEqual([
      { date: '2026-11-25', items: [{ text: 'C', sort: 0, added: false }] },
      {
        date: '2026-11-20',
        items: [
          { text: 'A', sort: 0, added: true },
          { text: 'B', sort: 1, added: false },
        ],
      },
    ]);
  });
});
