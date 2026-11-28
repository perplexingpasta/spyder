# Plan: the "How I'll improve" gadget (P107)

**Behaviour:** `docs/product-decisions.md` P107. **Window mechanism:** `docs/adr/0012-gadget-owned-by-the-desktop.md` (proposed until phase 1 passes). **Look:** `design/DESIGN.md` §2b. **Terms:** `CONTEXT.md` (Gadget, Gadget row, Ticked).

**Status:** built 2026-11-28 (phases 0–9 done; results of phases 1 and 8 below and in ADR-0012).

This plan says *how* and *in what order*. Where it and P107 disagree, P107 wins. Each phase ends green on `npm run typecheck`, `npm run lint` and `npm test`. Phases that touch windows or the renderer also run `npm run test:e2e`. No phase starts before the previous one is verified.

---

## Phase 0: Before starting

1. **P106 (Sleep is beige)** was uncommitted in files P107 also touches. Done: it was committed on its own as `7a490b6`.
2. Read the `CHANGELOG.md` entries newer than the last pull.
3. Check that `resources/UrlHelper.exe` builds (`npm run build:helper`).

**Verify:** the working tree holds only the P107 docs (CONTEXT.md, P107, ADR-0012, DESIGN §2b, this file), or P106 is committed.

---

## Phase 1: Spike: keeping the gadget on the desktop (gates ADR-0012)

The riskiest part goes first, because if it fails, the window part of the design changes.

**Build**
- `src/native/UrlHelper.cs`: a new one-shot mode `UrlHelper.exe desktop <hwnd>`:
  - `FindWindow("Progman", null)`. If there's none, run `Back(hwnd)` and exit 2 (the fallback).
  - If `GetWindow(hwnd, GW_OWNER)` isn't already Progman, `SetWindowLongPtr(hwnd, GWLP_HWNDPARENT = -8, progman)`.
  - Then `Back(hwnd)`. Exit 0 if the owner is Progman afterwards, else 1.
  - Update the header comment listing the modes.
- A throwaway Electron script in the scratchpad (not the repo) that opens a frameless acrylic window and calls the helper.

**Check on the real desktop** (this disturbs the user's windows; the user OK'd it on 2026-11-28):
1. After `desktop`, a maximised app covers the gadget, and the gadget doesn't show over it.
2. **Win+D**: the gadget is still visible. Check with `WindowFromPoint` at its centre, which should return its hwnd, and with a screenshot. Win+D again restores the apps over it.
3. Click the gadget and type: keys arrive. On `blur`, `back` drops it under the app that takes focus. Also measure how long it shows over a partly overlapping app after a click.
4. Acrylic still draws once it's owned.
5. **Explorer restart** (`taskkill /f /im explorer.exe`, then `start explorer`): see whether the window survives or is destroyed. Running `desktop` again re-owns it to the new Progman.
6. Two displays, if available: the gadget on the second screen behaves the same.

**Outcomes**
- All pass: set ADR-0012 to **accepted** with what was observed, and replace any "expected" wording with facts.
- Win+D hides it: try owning it by the `WorkerW` that holds `SHELLDLL_DefView` instead. If that fails too, **stop and ask the user**: either accept bottom-of-z-order (hidden by Win+D), or go back to the WorkerW-child route with "lift while typing" and an opaque card (their original fallback answers).
- Destroyed on Explorer restart: phase 4's recreate-on-`closed` covers it. Note it in the ADR.

**Verify:** a short write-up of each check (passed or failed, and how it was checked) goes into ADR-0012. The helper builds.

---

## Phase 2: Pure core (`src/core/gadget.ts`, Vitest)

There's no Electron, fs or sqlite here (ADR-0006), and time only comes in as arguments.

- `type LabelColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'` and `LABEL_COLORS` (in menu order), plus `isLabelColor`.
- `interface GadgetRow { id; date; text; color: LabelColor | null; tickedMs: number | null; createdMs: number; sort: number }`.
- `normText(t)`: trim, collapse whitespace, lower-case. `sameImprovement(a, b)` compares the date and `normText`.
- `cleanText(t)`: turns line breaks into spaces and trims, as P101 does.
- `orderRows(rows)`: fresh rows first, by `date` descending, then `createdMs` descending, then `sort` ascending. Ticked rows after them, by `tickedMs` descending.
- `gadgetDate(date, today)`: `Nov 26`, or `Nov 26, 2025` when the year differs.
- `importView(days, rows)`: for each past day with improvements, newest first, the improvements with `added = rows.some(r => !removed && sameImprovement)`.

**Tests** (`gadget.test.ts`): normalisation (case, inner spaces, ends); ordering (fresh before ticked; dates newest first; a batch keeps its review order; a newer manual row on the same date sits on top; ticked rows most recent first; unticking puts a row back in its date place); date labels around a year change; `added` flags, and a removed row not counting as added.

**Verify:** `npm test` green, and the new file is fully covered by its tests.

---

## Phase 3: Storage, auto-add and settings

**Migration `011_gadget.sql`**
```sql
-- P107 (2026-11-28): the "How I'll improve" gadget's rows. Copies of improvements, or written on the gadget.
CREATE TABLE gadget_rows (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,          -- the review's day, or the day it was written on the gadget ('YYYY-MM-DD' local)
  text TEXT NOT NULL,
  color TEXT,                  -- red | orange | yellow | green | blue | purple; NULL = none
  ticked_ms INTEGER,           -- NULL = fresh
  sort INTEGER NOT NULL DEFAULT 0,  -- the improvement's place in its review, so a batch keeps its order
  created_ms INTEGER NOT NULL,
  removed_ms INTEGER           -- kept, so auto-add doesn't bring a removed row back
);
CREATE INDEX gadget_rows_date ON gadget_rows(date);
-- First run: the last day that has improvements.
INSERT INTO gadget_rows (id, date, text, sort, created_ms)
  SELECT lower(hex(randomblob(16))), date, text, sort, 0 FROM review_items
  WHERE kind = 'improve' AND date = (SELECT MAX(date) FROM review_items WHERE kind = 'improve');
```
Register it in `migrations/index.ts`.

**`src/main/gadget.ts`** (the db side, using core for the rules):
- `listRows(db)`: rows that aren't removed, in `orderRows` order.
- `addRow(db, text, today, now)`.
- `editRow(db, id, patch: { text?, ticked?, color?, removed? })`. An empty text means removed. `ticked: true` sets `ticked_ms = now`. `removed: false` is the Undo.
- `clearTicked(db, now)`: returns the ids it removed.
- `autoAdd(db, date, texts[], now)`: skips any text that matches a row with the same date and text, *including removed rows*.
- `importList(db)`: for `importView`.
- `importRows(db, items[], now)`: skips only rows that match one still on the gadget, so a removed row can come back. Each import batch shares one `created_ms`, with `sort` = the review's sort.

**Hooks**
- `ipc.ts` `saveReviewItem`: when `kind === 'improve'`, call `autoAdd(date, [text])`.
- `reflect.ts` `saveReflection`: when there are lists, call `autoAdd(date, lists.improve)` in the same transaction.
- Both then push the gadget's new rows (phase 4).

**Settings** (`src/core/settings.ts`, with defaults and `cleanSettings`):
- `gadget: boolean` (true).
- `gadgetHidden: boolean` (false).
- `gadgetBounds: { x, y, width, height } | null` (null). It needs a validation branch like `widgetPos`: four finite numbers, with width and height at or above the minimums.

**Tests**
- Vitest: `cleanSettings` for the new keys.
- An integration-style Vitest of `src/main/gadget.ts` against a temp `Db`, if the existing test setup allows importing `node:sqlite` outside core. Otherwise these cases move to phase 7's e2e: auto-add dedupe, removed rows not auto-added back but importable, Clear ticked, Undo.

**Verify:** a fresh data dir migrates. The phase 7 migration test covers the seed from an old database.

---

## Phase 4: The window, the tray and IPC (main process)

**`src/main/windows.ts`**
- `GADGET_MIN = { width: 260, height: 160 }` and `GADGET_DEFAULT = { width: 340, height: 420 }`.
- `gadgetBoundsFor(saved)`: keep the saved bounds if they're still on a connected display (as `widgetPosition` does). Otherwise place it 24 px in from the top right of the primary work area.
- `createGadget(ctx)`: frameless, `backgroundMaterial: 'acrylic'`, transparent background, resizable with the minimums, `skipTaskbar`, not always on top, minimizable and maximizable off, `show: false`. It loads `/gadget` and saves its bounds on `move`/`resize`, debounced 500 ms, to `gadgetBounds`. On `ready-to-show` it shows inactive, then `toDesktop`. Its close only hides (as the other windows do). On `closed` while not quitting, it's recreated (the Explorer-restart case, ADR-0012).
- `toDesktop(win)`: spawn `UrlHelper.exe desktop <hwnd>`. It's skipped under `QUIET` and when the helper is missing.
- `on('focus')` / `on('blur')`: spawn `back` (reusing `sendToBack`).
- While the gadget is shown, a 30 s interval runs `toDesktop`. It's cleared when the gadget is hidden.
- `showGadget(ctx)`: sets `gadgetHidden = false`, saves it, shows inactive and runs `toDesktop`. `minimizeGadget(ctx)`: sets `gadgetHidden = true`, saves it and hides. `applyGadget(ctx)`: shown iff `gadget && !gadgetHidden`. It's created lazily the first time it's needed.
- `ctx.gadget: BrowserWindow | null` in `context.ts`. `applyStyle` and `applyTheme` include it, and `load()` already applies the style per window.

**`src/main/main.ts`**: create it after the widget when `applyGadget` says so.

**`src/main/tray.ts`**: `Show How I'll improve` after `Show widget`, only while `settings.gadget` is on. The menu is rebuilt on right-click already, so it follows the setting.

**`src/main/ipc.ts`** (all through `h`):
- `getGadget`, which returns `{ rows, today }`.
- `addGadgetRow(text)`, `editGadgetRow(id, patch)` and `clearTicked()`.
- `gadgetImportList()` and `importGadgetRows(items)`.
- `minimizeGadget()`.
- `setSettings`: when `gadget` is in the change, call `applyGadget`.
- Inputs are validated: ids and texts are strings, a colour passes `isLabelColor` or is null, and dates match `YYYY-MM-DD`.

**Push:** after any change (gadget IPC, `saveReviewItem`, `saveReflection`), send `spyder:gadget` with `{ rows, today }` to the gadget window. `today` changes at midnight, so the date labels' year rule follows it, and the push also fires on the host's day change.

**Preload and contract:** add the methods to `methods`, add `onGadget: on('gadget')`, and type all of it in `api.d.ts`.

**Debug** (`debug.ts`): `state` gets `gadgetVisible` and `gadgetDesktop`, the latter being the last `toDesktop` exit code, or null when it was skipped.

**Verify:** typecheck and lint pass. `security.spec.ts` still passes, since the new handlers refuse foreign pages.

---

## Phase 5: The gadget page (renderer)

- `router.tsx`: route `gadget` → `<Gadget/>`, with body class `gadget`.
- `styles.css`:
  - `body.gadget` gets the same smoke tint as `body.prompt` (P89/P90) and `overflow: hidden`.
  - `--color-label-{red,orange,yellow,green,blue,purple}`, dark and light (`:root` plus the light media block).
  - The 16 % tint and the 3 px edge come from `data-color`.
- `src/renderer/gadget/Gadget.tsx`, following DESIGN §2b. The `data-testid`s are in brackets.
  - **Header** (`gadget-header`, drag): `gadget-add`, `gadget-import`, `gadget-clear` (only with ticked rows) and `gadget-minimize`.
  - **List** (`gadget-list`): `gadget-row` with `data-ticked` and `data-color`. Inside it: `gadget-check`, `gadget-text`, `gadget-date`, `gadget-color` and `gadget-remove`.
  - **Draft row** from + (`gadget-draft`): Enter saves and opens a new draft. Esc, or blurring it empty, discards it. Blurring it with text saves.
  - **Editing**: an auto-growing textarea (`gadget-edit`). Enter or blur saves, Esc reverts, and empty removes the row (with the Undo bar). A pasted line break becomes a space.
  - **Colour menu** (`gadget-color-menu`, swatches `gadget-swatch-<name>` and `gadget-swatch-none`): opened from right-click or the hover dot, closed by Esc or clicking outside. It's positioned inside the window.
  - **Undo bar** (`gadget-undo`): 5 s, and a new removal replaces the old one.
  - **Clear confirm** (`gadget-clear-confirm`): Remove and Cancel.
  - **Empty state** (`gadget-empty`).
  - **Import view** (`gadget-import-view`): per day `gadget-import-day` with `gadget-import-all`, per item `gadget-import-item`, with `data-added` for those already on the gadget. Then `gadget-import-go` (`Import N`) and Cancel.
  - Rows come from `getGadget()` and `onGadget`. Edits are optimistic, and the push from main decides the final state.
- Keyboard: every control can be reached with Tab, and Space toggles the checkbox.

**Verify:** screenshots in phase 7. Open the PNGs and compare them with DESIGN §2b, dark and light.

---

## Phase 6: The Settings toggle

`Settings.tsx` → the **Goal** card, under "Ask about the day at midnight": a field labelled `How I'll improve gadget` with the hint `on your desktop, never over your apps`, and `Toggle testId="set-gadget"`.

**Verify:** covered in phase 7.

---

## Phase 7: End-to-end tests (`tests/e2e/gadget.spec.ts`)

In QUIET mode the window is invisible and `toDesktop` is skipped. Find the page with `windowByHash(app, 'gadget')`.

1. **First-run seed:** build a DB at v10 with improvements on two days (as `migration.spec.ts` does), launch, and check the rows are the later day's improvements in review order.
2. **Auto-add:** save an improvement on the Review page and another from the midnight card (reusing `reflect.spec.ts`'s midnight flow), and check both rows appear with the right dates. A win isn't added.
3. **Dedupe:** re-saving the same text, or the same text with different case and spaces, adds no row. A reworded text adds one. A removed row isn't auto-added back by a re-save, but Import can bring it back.
4. **Adding:** + shows a focused draft at the top dated today. Enter saves it and opens another, Esc discards it, and blurring an empty draft discards it. The text wraps (`wrapsFully`, as in reflect.spec), and the date stays at the far right on the first line.
5. **Editing:** click, change and press Enter to save. Esc reverts. Emptying it removes the row, and Undo brings it back.
6. **Ticking:** a ticked row is struck through and moves below the fresh rows, with the most recently ticked first. Unticking puts it back in its date place. It's still there after a reload.
7. **Colour:** right-click → green sets `data-color="green"` and stays after a restart. The hover dot works the same way. `None` clears it. A ticked row keeps its colour.
8. **Remove and Clear ticked:** × and Undo within 5 s. Clear ticked asks to confirm, and Cancel keeps the rows.
9. **Import:** the picker lists days newest first. Rows already on the gadget show `added` and can't be picked. `All` picks a whole day. `Import N` adds them with their review's dates.
10. **Minimize and tray:** minimize hides the gadget and sets `gadgetHidden`. It's still hidden after a relaunch with the same data dir. The tray menu's `Show How I'll improve` brings it back.
11. **Settings toggle:** off hides the gadget and removes the tray item. Auto-add still adds rows meanwhile (check the db). On shows it again with those rows.
12. **Screenshots:** `gadget` (mixed rows, colours, a ticked one, a wrapped one), `gadget-light`, `gadget-import`, `gadget-empty` and `gadget-color-menu`. Take them with `SPYDER_E2E_SHOW`-independent page screenshots, as the other specs do.

**An existing test changes:** `smoke.spec.ts` asserts the tray menu exactly. It needs `Show How I'll improve` added (the user OK'd it on 2026-11-28).

**Verify:** the whole `npm run test:e2e` run is green. Open each PNG and compare it with DESIGN §2b. Fix what's off.

---

## Phase 8: Manual check on the real desktop

With the user's OK (given 2026-11-28), on a throwaway data dir (`SPYDER_DATA_DIR`), with `npm run build:helper` done:
- The gadget appears at the top right and never covers a focused app.
- It survives Win+D.
- Clicking or typing in it doesn't leave it over apps.
- Resizing and moving are remembered across a relaunch.
- Minimize sends it to the tray, and the tray brings it back.
- After an Explorer restart it comes back within 30 s.

---

## Phase 9: Docs and commit

- `CHANGELOG.md`: a What / Why / If you pull this entry. Under "If you pull this": migration 011, the new settings keys `gadget`, `gadgetHidden` and `gadgetBounds`, the new `UrlHelper.exe desktop` mode (rebuild the helper with `npm run build:helper`), and the fourth window in e2e.
- `AGENTS.md` code map: the renderer's routes get `#/gadget`. Gotchas: "the bar is the only widget" still holds, because the gadget isn't a widget. Add a line saying so.
- ADR-0012 status reflects phase 1, and P107 is amended if anything changed while building.
- One commit on `main`: `feat: the "How I'll improve" gadget on the desktop (P107)`, with the body per AGENTS.md. Don't push.

---

## Phase 8 result (2026-11-28)

The built app on the real desktop (a throwaway data dir, driven by a scratch Playwright script plus `WindowFromPoint` checks):
- It appeared 24 px in from the top right, owned by Progman (`desktop` exit 0), and a maximised app covered it.
- Win+D left it showing; a second Win+D put the apps back over it.
- Clicked on the desktop, + took the typing: Enter saved `Typed here`, dated today, and Esc closed the next draft.
- After Win+D with one window restored over it, clicking the gadget focused it without raising it over that window, twice in a row.
- Moved and resized to 400 × 300 at (200, 150), it came back there after a relaunch.
- Minimize hid it; the tray's `Show How I'll improve` brought it back and handed it to the desktop again.
- After an Explorer restart its owner was gone for a moment; within 37 s it was owned by the new Progman, and Win+D left it showing.
- The installed Spyder bar sat over the gadget's header at the default place and took clicks there: expected, the bar is always on top.

## Answered by the user (2026-11-28)

- Phase 0: commit P106 separately. Done: it landed as `7a490b6` before this plan, so the tree holds only P107 docs.
- Phases 1 and 8: yes, pressing Win+D, restarting Explorer and opening test windows on the real desktop is OK.
- Phase 7: yes, add `Show How I'll improve` to `smoke.spec.ts`'s tray menu assertion.

## Known consequences

- Because a reworded improvement counts as a new one (P107's dedupe rule), fixing a typo on the Review page *after* saving adds a second gadget row. The user can remove the old one. That rule is already decided; it's noted here so it doesn't look like a bug.
- Without `UrlHelper.exe`, the gadget is a normal window, not on top, and Win+D hides it.
