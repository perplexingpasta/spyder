/// <reference lib="dom" />
// P107: the "How I'll improve" gadget. In e2e the window is invisible and isn't handed to the desktop (QUIET).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';
import { Db } from '../../src/main/db/db';
import { loadMigrationsFromDisk } from '../../src/main/db/loadFromDisk';
import { migrate } from '../../src/main/db/migrate';
import { freshDataDir, launch, ROOT, shot, windowByHash, type Launched as Session } from './helpers';

const LONG =
  'Plan tomorrow the evening before, in writing, with the three things that matter most and when each one happens';

async function gadgetOf(s: Session): Promise<Page> {
  const g = await windowByHash(s.app, 'gadget');
  await g.waitForLoadState('domcontentloaded');
  await expect(g.getByTestId('gadget-header')).toBeVisible();
  return g;
}
const texts = (g: Page) => g.getByTestId('gadget-text').allTextContents();
const row = (g: Page, text: string) =>
  g.getByTestId('gadget-row').filter({ has: g.getByTestId('gadget-text').getByText(text, { exact: true }) });
const dbRows = (s: Session) =>
  s
    .db()
    .prepare(
      'SELECT date, text, color, ticked_ms IS NOT NULL AS ticked, removed_ms IS NOT NULL AS removed FROM gadget_rows ORDER BY date, sort, created_ms',
    )
    .all() as {
    date: string;
    text: string;
    color: string | null;
    ticked: number;
    removed: number;
  }[];
const saveItem = (s: Session, date: string, kind: 'win' | 'improve', text: string, sort = 0) =>
  s.dashboard.evaluate((it) => window.spyder.saveReviewItem(it), { date, kind, text, sort });
const gadgetVisible = async (s: Session) => (await s.debug.state()).gadgetVisible;

async function write(g: Page, ...lines: string[]) {
  await g.getByTestId('gadget-add').click();
  const input = g.getByTestId('gadget-draft-input');
  for (const l of lines) {
    await input.fill(l);
    await input.press('Enter');
  }
  await input.press('Escape');
}

/** A wrapping text is taller than one line, and none of it is hidden. */
async function wrapsFully(el: Locator) {
  const m = await el.evaluate((t) => ({ h: t.clientHeight, sh: t.scrollHeight }));
  expect(m.h).toBeGreaterThan(40);
  expect(m.sh).toBeLessThanOrEqual(m.h);
}

test('first run: the gadget starts with the last day that has improvements, in review order', async () => {
  const dir = freshDataDir();
  const db = new Db(join(dir, 'spyder.db'));
  migrate(
    db,
    loadMigrationsFromDisk(join(ROOT, 'src/main/db/migrations')).filter((m) => m.version <= 10),
    0,
  );
  const item = (date: string, kind: string, text: string, sort: number) =>
    db.run(
      'INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES (?, ?, ?, ?, ?, 0)',
      `${date}${kind}${sort}`,
      date,
      kind,
      text,
      sort,
    );
  item('2026-11-20', 'improve', 'Older one', 0);
  item('2026-11-23', 'improve', 'Second', 1);
  item('2026-11-23', 'improve', 'First', 0);
  item('2026-11-23', 'win', 'A win', 0);
  db.close();
  const s = await launch({ dataDir: dir });
  try {
    const g = await gadgetOf(s);
    await expect.poll(() => texts(g)).toEqual(['First', 'Second']);
    await expect(g.getByTestId('gadget-date').first()).toHaveText('Nov 23');
  } finally {
    await s.close();
  }
});

test('improvements saved on Review or the midnight card are added; wins are not; the same text twice is one row', async () => {
  const env = { SPYDER_DEFAULTS: JSON.stringify({ trackFromStartup: false, barPercent: 'day' }) };
  const s = await launch({ now: '2026-11-24T16:30:00', env });
  try {
    const g = await gadgetOf(s);
    await expect(g.getByTestId('gadget-empty')).toBeVisible();
    await shot(g, 'gadget-empty');
    await saveItem(s, '2026-11-23', 'improve', 'Walk at lunch');
    await saveItem(s, '2026-11-23', 'win', 'Shipped it');
    await expect.poll(() => texts(g)).toEqual(['Walk at lunch']);
    await expect(g.getByTestId('gadget-date')).toHaveText(['Nov 23']);

    // Dedupe: the same day and text (ignoring case and spaces) is one row; a reworded one is new.
    await saveItem(s, '2026-11-23', 'improve', '  walk AT   lunch ', 1);
    await saveItem(s, '2026-11-23', 'improve', 'Walk after lunch', 2);
    await expect.poll(() => texts(g)).toEqual(['Walk after lunch', 'Walk at lunch']); // the newer one on top
    // A removed row isn't auto-added back, but Import brings it back.
    await row(g, 'Walk after lunch').hover();
    await row(g, 'Walk after lunch').getByTestId('gadget-remove').click();
    await saveItem(s, '2026-11-23', 'improve', 'Walk after lunch', 2);
    await expect.poll(() => texts(g)).toEqual(['Walk at lunch']);
    await g.getByTestId('gadget-import').click();
    const items = g.getByTestId('gadget-import-item');
    await expect(items.filter({ hasText: 'Walk after lunch' }).first()).toHaveAttribute(
      'data-added',
      'false',
    );
    await items.filter({ hasText: 'Walk after lunch' }).first().getByTestId('gadget-check').click();
    await g.getByTestId('gadget-import-go').click();
    await expect.poll(() => texts(g)).toEqual(['Walk after lunch', 'Walk at lunch']);

    // The midnight card (P98).
    await s.prompt.getByTestId('reminder-start').click();
    await expect
      .poll(async () => ((await s.debug.state()).host as { engine: { loop: unknown } }).engine.loop)
      .not.toBeNull();
    await s.debug.setNow(new Date('2026-11-24T16:50:00').getTime());
    await s.debug.setNow(new Date('2026-11-25T00:00:05').getTime());
    const card = s.prompt.getByTestId('prompt-reflect');
    await expect(card).toBeVisible();
    await card.getByTestId('reflect-win').getByTestId('reflect-line').first().fill('A good day');
    await card
      .getByTestId('reflect-improve')
      .getByTestId('reflect-line')
      .first()
      .fill('Sleep before midnight');
    await s.prompt.getByTestId('reflect-done').click();
    await expect.poll(() => texts(g)).toEqual(['Sleep before midnight', 'Walk after lunch', 'Walk at lunch']);
    await expect(g.getByTestId('gadget-date')).toHaveText(['Nov 24', 'Nov 23', 'Nov 23']);
  } finally {
    await s.close();
  }
});

test('+ writes rows dated today; Enter opens the next, Esc or an empty blur discards; long text wraps with the date on the right', async () => {
  const s = await launch();
  try {
    const g = await gadgetOf(s);
    await g.getByTestId('gadget-add').click();
    const input = g.getByTestId('gadget-draft-input');
    await expect(input).toBeFocused();
    await input.fill('Fewer tabs');
    await input.press('Enter');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await input.fill('Not this one');
    await input.press('Escape');
    await expect(g.getByTestId('gadget-draft')).toHaveCount(0);
    await g.getByTestId('gadget-add').click();
    await input.blur();
    await expect(g.getByTestId('gadget-draft')).toHaveCount(0);
    await expect.poll(() => texts(g)).toEqual(['Fewer tabs']);
    await expect(g.getByTestId('gadget-date')).toHaveText(['Nov 24']);

    await write(g, LONG);
    await expect.poll(() => texts(g)).toEqual([LONG, 'Fewer tabs']);
    const long = row(g, LONG);
    await wrapsFully(long.getByTestId('gadget-text'));
    const t = (await long.getByTestId('gadget-text').boundingBox())!;
    const d = (await long.getByTestId('gadget-date').boundingBox())!;
    const r = (await long.boundingBox())!;
    expect(Math.abs(d.y - t.y)).toBeLessThan(4); // on the first line
    expect(r.x + r.width - (d.x + d.width)).toBeLessThan(16); // far right
    expect(d.x).toBeGreaterThan(t.x + t.width - 1);
  } finally {
    await s.close();
  }
});

test('editing: Enter saves, Esc reverts, emptying removes with Undo', async () => {
  const s = await launch();
  try {
    const g = await gadgetOf(s);
    await write(g, 'Stand up every hour');
    await row(g, 'Stand up every hour').getByTestId('gadget-text').click();
    const edit = g.getByTestId('gadget-edit');
    await edit.fill('Stand up every half hour');
    await edit.press('Enter');
    await expect.poll(() => texts(g)).toEqual(['Stand up every half hour']);
    expect(dbRows(s).map((r) => r.text)).toEqual(['Stand up every half hour']);

    await g.getByTestId('gadget-text').click();
    await edit.fill('Something else');
    await edit.press('Escape');
    await expect.poll(() => texts(g)).toEqual(['Stand up every half hour']);

    await g.getByTestId('gadget-text').click();
    await edit.fill('');
    await edit.press('Enter');
    await expect(g.getByTestId('gadget-row')).toHaveCount(0);
    await expect(g.getByTestId('gadget-undo')).toContainText('Removed');
    await g.getByTestId('gadget-undo-btn').click();
    await expect.poll(() => texts(g)).toEqual(['Stand up every half hour']);
  } finally {
    await s.close();
  }
});

test('ticking strikes a row and moves it below the fresh rows, most recently ticked first; unticking puts it back', async () => {
  const s = await launch();
  try {
    const g = await gadgetOf(s);
    await saveItem(s, '2026-11-20', 'improve', 'Oldest');
    await write(g, 'C', 'B', 'A');
    await expect.poll(() => texts(g)).toEqual(['A', 'B', 'C', 'Oldest']);
    await row(g, 'B').getByTestId('gadget-check').click();
    await expect.poll(() => texts(g)).toEqual(['A', 'C', 'Oldest', 'B']);
    await expect(row(g, 'B')).toHaveAttribute('data-ticked', 'true');
    await expect(row(g, 'B').getByTestId('gadget-text')).toHaveCSS('text-decoration-line', 'line-through');
    await s.debug.advance(5);
    await row(g, 'Oldest').getByTestId('gadget-check').click();
    await expect.poll(() => texts(g)).toEqual(['A', 'C', 'Oldest', 'B']);
    await s.debug.advance(5);
    await row(g, 'A').getByTestId('gadget-check').click();
    await expect.poll(() => texts(g)).toEqual(['C', 'A', 'Oldest', 'B']);
    await row(g, 'Oldest').getByTestId('gadget-check').click();
    await expect.poll(() => texts(g)).toEqual(['C', 'Oldest', 'A', 'B']);
    await g.reload();
    await expect.poll(() => texts(g)).toEqual(['C', 'Oldest', 'A', 'B']);
    await expect(row(g, 'A')).toHaveAttribute('data-ticked', 'true');
  } finally {
    await s.close();
  }
});

test('colour labels from right-click or the hover dot; None clears; a ticked row keeps its colour; kept across a restart', async () => {
  const dir = freshDataDir();
  let s = await launch({ dataDir: dir });
  try {
    const g = await gadgetOf(s);
    await write(g, 'Blue one', 'Green one');
    await row(g, 'Green one').click({ button: 'right' });
    const menu = g.getByTestId('gadget-color-menu');
    await expect(menu).toBeVisible();
    await shot(g, 'gadget-color-menu');
    await menu.getByTestId('gadget-swatch-green').click();
    await expect(menu).toHaveCount(0);
    await expect(row(g, 'Green one')).toHaveAttribute('data-color', 'green');
    await row(g, 'Blue one').hover();
    await row(g, 'Blue one').getByTestId('gadget-color').click();
    await g.getByTestId('gadget-swatch-blue').click();
    await expect(row(g, 'Blue one')).toHaveAttribute('data-color', 'blue');
    await row(g, 'Blue one').click({ button: 'right' });
    await g.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await row(g, 'Green one').getByTestId('gadget-check').click();
    await expect(row(g, 'Green one')).toHaveAttribute('data-color', 'green');
    await expect(row(g, 'Green one')).toHaveAttribute('data-ticked', 'true');
  } finally {
    await s.close();
  }
  s = await launch({ dataDir: dir });
  try {
    const g = await gadgetOf(s);
    await expect(row(g, 'Green one')).toHaveAttribute('data-color', 'green');
    await row(g, 'Blue one').click({ button: 'right' });
    await g.getByTestId('gadget-swatch-none').click();
    await expect(row(g, 'Blue one')).toHaveAttribute('data-color', '');
    expect(dbRows(s).find((r) => r.text === 'Blue one')!.color).toBeNull();
  } finally {
    await s.close();
  }
});

test('× removes with Undo; Clear ticked asks first', async () => {
  const s = await launch();
  try {
    const g = await gadgetOf(s);
    await write(g, 'One', 'Two', 'Three');
    await row(g, 'Two').hover();
    await row(g, 'Two').getByTestId('gadget-remove').click();
    await expect.poll(() => texts(g)).toEqual(['Three', 'One']);
    await g.getByTestId('gadget-undo-btn').click();
    await expect.poll(() => texts(g)).toEqual(['Three', 'Two', 'One']);

    await expect(g.getByTestId('gadget-clear')).toHaveCount(0);
    await row(g, 'One').getByTestId('gadget-check').click();
    await row(g, 'Two').getByTestId('gadget-check').click();
    await g.getByTestId('gadget-clear').click();
    await expect(g.getByTestId('gadget-clear-confirm')).toContainText('Remove 2 ticked rows?');
    await g.getByTestId('gadget-clear-cancel').click();
    await expect(g.getByTestId('gadget-row')).toHaveCount(3);
    await g.getByTestId('gadget-clear').click();
    await g.getByTestId('gadget-clear-go').click();
    await expect.poll(() => texts(g)).toEqual(['Three']);
    await expect(g.getByTestId('gadget-clear')).toHaveCount(0);
    expect(
      dbRows(s)
        .filter((r) => r.removed)
        .map((r) => r.text)
        .sort(),
    ).toEqual(['One', 'Two']);
  } finally {
    await s.close();
  }
});

test('Import lists past days newest first, marks what is added, picks a whole day with All', async () => {
  const s = await launch();
  try {
    const g = await gadgetOf(s);
    const ins = s
      .db()
      .prepare(
        "INSERT INTO review_items (id, date, kind, text, sort, created_ms) VALUES (?, ?, 'improve', ?, ?, 0)",
      );
    ins.run('a', '2026-11-20', 'Drink water', 0);
    ins.run('b', '2026-11-20', 'Lunch away from the desk', 1);
    ins.run('c', '2026-11-22', 'Fewer meetings', 0);
    ins.run('d', '2025-12-30', 'Read more', 0);
    await s.dashboard.evaluate(() =>
      window.spyder.importGadgetRows([{ date: '2026-11-22', text: 'Fewer meetings', sort: 0 }]),
    );
    await expect.poll(() => texts(g)).toEqual(['Fewer meetings']);

    await g.getByTestId('gadget-import').click();
    const days = g.getByTestId('gadget-import-day');
    await expect(days).toHaveCount(3);
    expect(await days.evaluateAll((els) => els.map((e) => e.getAttribute('data-date')))).toEqual([
      '2026-11-22',
      '2026-11-20',
      '2025-12-30',
    ]);
    await expect(days.nth(0)).toContainText('SUN, NOV 22');
    await expect(days.nth(2)).toContainText('TUE, DEC 30, 2025');
    await expect(days.nth(0).getByTestId('gadget-import-item')).toHaveAttribute('data-added', 'true');
    await expect(days.nth(0).getByTestId('gadget-import-all')).toHaveCount(0);
    await expect(g.getByTestId('gadget-import-go')).toBeDisabled();
    await days.nth(1).getByTestId('gadget-import-all').click();
    await days.nth(2).getByTestId('gadget-check').click();
    await expect(g.getByTestId('gadget-import-go')).toHaveText('Import 3');
    await shot(g, 'gadget-import');
    await g.getByTestId('gadget-import-go').click();
    await expect
      .poll(() => texts(g))
      .toEqual(['Fewer meetings', 'Drink water', 'Lunch away from the desk', 'Read more']);
    await expect(g.getByTestId('gadget-date')).toHaveText(['Nov 22', 'Nov 20', 'Nov 20', 'Dec 30, 2025']);
  } finally {
    await s.close();
  }
});

test('minimize sends it to the tray, across restarts; the tray brings it back', async () => {
  const dir = freshDataDir();
  let s = await launch({ dataDir: dir });
  try {
    const g = await gadgetOf(s);
    await expect.poll(() => gadgetVisible(s)).toBe(true);
    await g.getByTestId('gadget-minimize').click();
    await expect.poll(() => gadgetVisible(s)).toBe(false);
  } finally {
    await s.close();
  }
  s = await launch({ dataDir: dir });
  try {
    expect(await gadgetVisible(s)).toBe(false);
    expect(await s.debug.trayClick("Show How I'll improve")).toBe(true);
    await expect.poll(() => gadgetVisible(s)).toBe(true);
    await gadgetOf(s);
  } finally {
    await s.close();
  }
});

test('Settings: turning the gadget off hides it and drops the tray item; improvements still collect', async () => {
  const s = await launch();
  try {
    const g = await gadgetOf(s);
    const d = s.dashboard;
    await d.evaluate(() => (location.hash = '#/dashboard/settings'));
    const toggle = d.getByTestId('set-gadget');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect.poll(() => gadgetVisible(s)).toBe(false);
    expect((await s.debug.trayInfo()).menu).not.toContain("Show How I'll improve");
    await saveItem(s, '2026-11-23', 'improve', 'Collected while off');
    expect(dbRows(s).map((r) => r.text)).toEqual(['Collected while off']);
    await toggle.click();
    await expect.poll(() => gadgetVisible(s)).toBe(true);
    expect((await s.debug.trayInfo()).menu).toContain("Show How I'll improve");
    await expect.poll(() => texts(g)).toEqual(['Collected while off']);
  } finally {
    await s.close();
  }
});

test('screenshots: mixed rows in dark and light', async () => {
  const s = await launch();
  try {
    const g = await gadgetOf(s);
    await saveItem(s, '2026-11-21', 'improve', 'Take the stairs');
    await saveItem(s, '2026-11-20', 'improve', 'Walk after lunch');
    await write(g, LONG, 'Sleep before midnight');
    await expect(g.getByTestId('gadget-row')).toHaveCount(4);
    await row(g, 'Take the stairs').click({ button: 'right' });
    await g.getByTestId('gadget-swatch-green').click();
    await row(g, 'Sleep before midnight').click({ button: 'right' });
    await g.getByTestId('gadget-swatch-purple').click();
    await row(g, 'Walk after lunch').click({ button: 'right' });
    await g.getByTestId('gadget-swatch-orange').click();
    await row(g, 'Walk after lunch').getByTestId('gadget-check').click();
    await expect(row(g, 'Walk after lunch')).toHaveAttribute('data-ticked', 'true');
    await g.mouse.move(0, 0);
    await shot(g, 'gadget');
    await s.dashboard.evaluate(() => window.spyder.setSettings({ theme: 'light' }));
    await g.waitForFunction(() => matchMedia('(prefers-color-scheme: light)').matches);
    await shot(g, 'gadget-light');
  } finally {
    await s.close();
  }
});
