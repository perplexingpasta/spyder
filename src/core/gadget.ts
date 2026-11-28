// The "How I'll improve" gadget's rules (P107). Pure: the db side is src/main/gadget.ts.

/** The window's smallest and starting sizes (DESIGN.md §2b). */
export const GADGET_MIN = { width: 260, height: 160 };
export const GADGET_DEFAULT = { width: 340, height: 420 };

export const LABEL_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];
export const isLabelColor = (v: unknown): v is LabelColor => LABEL_COLORS.includes(v as LabelColor);

export interface GadgetRow {
  id: string;
  /** The review's day, or the day it was written on the gadget ('YYYY-MM-DD'). */
  date: string;
  text: string;
  color: LabelColor | null;
  /** null = fresh. */
  tickedMs: number | null;
  createdMs: number;
  /** The improvement's place in its review, so a batch keeps its order. */
  sort: number;
}

/** Case and spaces don't make a different improvement. */
export const normText = (t: string): string => t.trim().replace(/\s+/g, ' ').toLowerCase();

export const sameImprovement = (
  a: { date: string; text: string },
  b: { date: string; text: string },
): boolean => a.date === b.date && normText(a.text) === normText(b.text);

/** One line, as everywhere else (P101): a line break becomes a space. */
export const cleanText = (t: string): string => t.replace(/\r?\n|\r/g, ' ').trim();

/** Fresh rows newest date first (a newer row on the same date on top, a batch in review order); ticked rows below, most recently ticked first. */
export function orderRows<T extends GadgetRow>(rows: T[]): T[] {
  const fresh = rows.filter((r) => r.tickedMs === null);
  const ticked = rows.filter((r) => r.tickedMs !== null);
  fresh.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.createdMs - a.createdMs || a.sort - b.sort,
  );
  ticked.sort((a, b) => (b.tickedMs as number) - (a.tickedMs as number));
  return [...fresh, ...ticked];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Nov 26`, or `Nov 26, 2025` when it isn't today's year. */
export function gadgetDate(date: string, today: string): string {
  const [y, m, d] = date.split('-');
  const label = `${MONTHS[Number(m) - 1]} ${Number(d)}`;
  return y === today.slice(0, 4) ? label : `${label}, ${y}`;
}

export interface ImportDay {
  date: string;
  items: { text: string; sort: number; added: boolean }[];
}

/** The Import picker: past days with improvements, newest first; `added` when a row on the gadget already has it. */
export function importView(
  days: { date: string; items: { text: string; sort: number }[] }[],
  rows: { date: string; text: string }[],
): ImportDay[] {
  return [...days]
    .filter((d) => d.items.length)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => ({
      date: d.date,
      items: [...d.items]
        .sort((a, b) => a.sort - b.sort)
        .map((it) => ({
          ...it,
          added: rows.some((r) => sameImprovement(r, { date: d.date, text: it.text })),
        })),
    }));
}
