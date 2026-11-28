# Spyder design spec

Visual source of truth for the renderer. Behavior lives in `SPYDER_PLAN.md` §12. References: `design/reference/INDEX.md`.
The bar follows Rize's desktop widget (P23, P43). The dashboard is Linear/Vercel-style (P56): neutral greys, small type, Spyder purple as the only accent, colour only where it carries meaning, now in an Arc-style glass frame with soft rounded shapes (P87). Light, dark or follow Windows (P57).

**Brand rule:** no Rize logo, wordmark, name, or the purple "agent orb". Spyder's own mark is a spider web (tray/app icon only, P91). In the widget the orb's slot is taken by a functional **workday ring**.

## 1. Tokens (light and dark, P57)

`nativeTheme.themeSource` (Settings → Theme: System / Light / Dark, default System) drives `prefers-color-scheme` in every window, so the CSS tokens switch live. Dark values are the `@theme` defaults; light values override them under `@media (prefers-color-scheme: light)`. `src/main/theme.ts` sets the dashboard's native background to match `--color-bg`.

### Colours (`src/renderer/styles.css`)
| Token | Dark | Light | Use |
|---|---|---|---|
| `--color-bg` | `#0E0E10` | `#FFFFFF` | dashboard content background |
| `--color-sidebar` | `#09090B` | `#F7F7F8` | dashboard and prompt glass tint (at 55 % by default, P89; Settings → Glass tint, P90; prompt P92) |
| `--color-surface` | `#141417` | `#FFFFFF` | cards, tables, bar, prompt window |
| `--color-surface-2` | `#1C1C20` | `#F3F3F5` | hover, selected nav, segmented control, timeline track |
| `--color-border` | `#232328` | `#E8E8EC` | hairline borders, row dividers |
| `--color-border-strong` | `#313138` | `#D5D5DB` | bar border, popovers, checkbox outline |
| `--color-text` | `#ECECEF` | `#18181B` | primary text |
| `--color-muted` | `#8F8F99` | `#6C6C77` | secondary text, labels |
| `--color-faint` | `#5E5E68` | `#A3A3AD` | tertiary text, axis labels, untracked |
| `--color-accent` | `#7B61FF` | `#6A4FF0` | primary buttons, selection, answered blocks (Settings → Accent colour replaces it in both themes, P93) |
| `--color-on-accent` | `#FFFFFF` | `#FFFFFF` | text on accent |
| `--color-red` | `#EF5157` | `#DC3A40` | distraction, destructive |
| `--color-orange` | `#F2A33A` | `#C97A10` | warnings |
| `--color-green` | `#3FB27F` | `#1F9D63` | goal met |
| `--color-open` / `break` | | | block states (see `styles.css`) |
| `--color-gym` / `food` | `#E8853D` / `#D9669B` | same | P74 Gym and Food blocks; Settings can change both |
| `--color-sleep` | `#E8DCC4` | same | P105 Sleep blocks (beige, P106); Settings can change it |
| `--color-work` | `#3FB27F` | `#3FB27F` | work blocks (P67); replaced at runtime by the Settings pick |
| `--color-away` | | | start reminder, Week chart |
| `--color-planned` / `timed` | | | spare series colours (Month KPI lines) |
| `--color-productive` / `neutral` / `distracting` / `uncategorized` | `#3FB27F` / … | `#1F9D63` / … | activity categories; productive is the goal green (P81) |
| `--color-app-1` … `app-8` | `#3987e5` `#d95926` `#199e70` `#c98500` `#d55181` `#0ca30c` `#9085e9` `#e66767` | `#2a78d6` `#eb6834` `#1baf7a` `#eda100` `#e87ba4` `#008300` `#6250d6` `#e34948` | the timeline's app track's automatic colours, slot fixed per app (P77, P79) |

### Type
- Family: `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` (ships with Windows 11; no web-font download). Settings → Font can switch every window to the installed Atkinson Hyperlegible Next (P78); `src/main/theme.ts` overrides `--font-sans`, falling back to Segoe UI. All numbers use `font-variant-numeric: tabular-nums`.
- Scale (px / weight / line-height):
  - `timer-xl` 22 / 700 / 1 — widget timer
  - `stat` 20 / 600 / 1.2 — dashboard stat numbers
  - `h1` 14 / 600 — page title (top bar)
  - `section-title` 13 / 600 — section and card titles
  - `body` 13 / 400 / 1.45
  - `small` 12 / 400
  - `caps` 9 / 700 / 1.05, `letter-spacing: .06em`, uppercase — widget caption (Rize two-line caption)
  - `section-label` 12 / 500, sentence case, muted — labels above values; sidebar groups 11 / 500 faint

### Radii, spacing, shadows
- Radii: `pill` 9999 · `card` 12 · `control` 8 · `chip` 4 · `bar` 2 (P87). Stat tiles 14, block rows 10, nav pills 9.
- Spacing: 4-px grid (4, 8, 12, 16, 20, 24, 32). Card padding 16 (20 on dashboard stat cards).
- Shadows: `--shadow-float` for the prompt window, `--shadow-pop` for menus, tooltips, the merge panel and the toast. Dashboard cards have no shadow, only the 1 px border.
- Motion: 150 ms ease-out for hover/expand; pages fade in (200 ms, 6 px rise), stat tiles lift 2 px on hover, the sidebar pill slides (220 ms) (P87). All off under reduced motion. The timer never animates digits.
- Glass (P87): the dashboard and prompt windows use Windows 11 acrylic (`backgroundMaterial`); glass shows only while the window is focused, otherwise Windows paints a flat colour. Frosted fills are `--color-text` at 6–16 % (`.glass-*` in `styles.css`). The dashboard's glass frame (sidebar and the edge around the content card) is tinted with `sidebar` at 55 %: smoke, charcoal in dark and frost in light (P89). The strength is Settings → Look → Glass tint, 0–100 % (P90).

## 2. Widget (`#/widget`)

The bar is the only widget (P50; Full and Compact were removed). The BrowserWindow is transparent: the bar plus an 8 px margin on every side, **528 × 50**. It is display-only; Start, Stop and the block length live in the dashboard sidebar (P59).

### Bar (P43, P49, P50, P63) — 512 × 34, sharp corners
Modelled on the real Rize widget (described in `design/reference/INDEX.md`): a flat status strip, no title, no ring, no rounded corners. Window 528 × 50. No hover card and no panel. No drop shadow (the 8 px window margin would clip it into a visible box); the distracted pulse is the 4 px red ring only.
```
┌──┬───────────────────────────────────────────────────────────────┬───┬──┐
│▦▦│   04:32 BLOCK        0 min PRODUCTIVE    14% PERCENT            │ – │⋮⋮│
│▦▦│         OF 15M             TODAY               OF DAY           │   │  │
└──┴───────────────────────────────────────────────────────────────┴───┴──┘
```
- **Dashboard button** (32 px, left-most, `surface-2` tint, right border, 2×2 grid icon): opens the dashboard on Today. It's the only way in from the bar.
- Three cells, each as wide as its content and spread evenly (`justify-around`, P49). Each is a 19/700 tabular number + a two-line `caps` label (muted). **Cells do nothing when clicked**; they drag like the gaps.
  1. **Block timer**, counting up within the current block (P63), captioned `BLOCK / OF 15M`; `DISTRACTED / youtube.com` in `red` when distracted. Without a loop: `Not started` (15/600 `orange`, captioned `PRESS START / IN SPYDER`) during work hours, with the whole bar tinted orange and an orange border (P59); otherwise `Off hours` (muted) captioned `WORKDAY / DONE`, `DAY / OFF` or `BEFORE / WORK HOURS`. An orange dot at its top-right while blocks wait to be accounted for.
  2. **Productive today** in `accent` (`23 min`, `2h 14m` from an hour); `green` once the goal is met.
  3. **Percent of day** (`14%`, `–` on a day off) or **Percent of goal** (productive time ÷ daily goal, can pass 100 %), as chosen in Settings → Look → Bar percent (P82; default goal).
- **Minimize** (32 px, left border, `–`): on top, it drops the bar behind every window (no longer always on top; clicking it brings it forward like any window). Already behind, it hides the bar. The tray or the hotkey brings it back on top (P83). Not remembered across launches.
- **Drag handle** (24 px, `surface-2` tint, ⋮⋮ grip, `cursor: move`) at the far right. Everything except the two buttons drags.
- Red border when distracted, which also tints the fill red and pulses once. No sound anywhere (P60).

## 2b. Gadget (`#/gadget`, P107)

"How I'll improve" on the desktop: never above an app, still there on Show desktop (ADR-0012). It's an acrylic glass window like the prompt: the whole window is the smoke-tinted frame (`sidebar` at the Glass tint, P89/P90), and Windows draws the rounded corners and the shadow. It's resizable (min 260 × 160) and starts at **340 × 420**, 24 px in from the top right of the primary display's work area. Size and place are remembered.
```
 ╭────────────────────────────────────────╮
 │ HOW I'LL IMPROVE        [+] [⇩] [✓̶] [–] │  ← header 36 px, drags; caps muted title; 28 px ghost icon buttons
 ├────────────────────────────────────────┤
 │ ☐  Sleep before midnight         Nov 27 │  ← fresh rows, newest date first
 │ ☐  Plan tomorrow the evening     Nov 27 │
 │    before, in writing                   │  ← text wraps; the date stays on the first line
 │ ☐  Take the stairs               Nov 24 │  ← tinted row (colour label)
 │ ☑  ̶W̶a̶l̶k̶ ̶a̶f̶t̶e̶r̶ ̶l̶u̶n̶c̶h̶            Nov 20 │  ← ticked: struck through, muted, below the fresh rows
 ╰────────────────────────────────────────╯
```
- **Header** (36 px, the drag area, no border, 12 px side padding): the caps `HOW I'LL IMPROVE` in muted on the left. On the right, 28 px ghost icon buttons (muted, `text` on hover, `surface-2` hover fill, radius control) with tooltips: **+** `Add` (plus), **Import** (tray-arrow-down), **Clear ticked** (a check with a strike, shown only with ticked rows) and **Minimize** (`–`, `Minimize to the tray`). The buttons don't drag.
- **Rows** (13 px `text`, 6 px × 12 px padding, radius control, 2 px apart, in a scroll area under the header with 8 px side margins): a 16 px checkbox (radius chip, 1.5 px outline in `text` at 35 %, so it shows on a tinted row in light too; ticked = `accent` fill with an `on-accent` check), 10 px gap, then the text, which wraps (long words break) and takes the free width. The date is 12 px `faint` tabular at the far right on the first line. On hover, two 20 px ghost controls appear just left of the date: a colour dot (opens the colour menu) and an `×` (Remove). The row gets a `surface-2`/50 % fill on hover when it has no colour.
- **Ticked rows**: the text is struck through in `muted`, the date is `faint`, and the tint drops to half strength. No divider separates them from the fresh rows.
- **Editing**: clicking the text turns it into a borderless auto-growing field of the same size (`surface` 60 % fill, 1 px `accent` 40 % outline, radius chip). The new row from + looks the same, with a `faint` placeholder `How will you improve?`.
- **Colour labels**: red, orange, yellow, green, blue or purple. The tint is `color-mix(label 16 %, transparent)` on the row, with a 3 px left edge in the full colour. The menu (right-click or the hover dot) is a `surface` popover (`shadow-pop`, radius control, 6 px padding) holding seven 18 px swatches in a line, the last one `None` (a slashed circle). The current one has a 2 px `text` ring. The label tokens are `--color-label-<name>` in `styles.css`, stepped for light and dark like the app colours.
- **Undo** after ×: a 32 px bar at the bottom of the window (`surface`, `shadow-pop`, 12 px) reading `Removed · Undo` (Undo in `accent`) for 5 s.
- **Clear ticked confirm**: the same bar reads `Remove 3 ticked rows?` with `Remove` (red text) and `Cancel`.
- **Empty**: centred 13 px muted `Nothing to improve yet`, and under it a 12 px faint `+ to write one, or Import from a past review`.
- **Import** replaces the rows, keeping the header, which now has a back arrow and the title `IMPORT`. It lists days newest first. Each day has a caps date line (`THU, NOV 27`) with an `All` checkbox on the right, then its improvements as rows with checkboxes. Ones already on the gadget are `faint` with `added` in place of the checkbox. A sticky footer has a primary pill `Import 4` (disabled at 0) and a ghost `Cancel`. With no past improvements: muted `No past improvements yet`.

## 3. Prompt window (`#/prompt`)

420 px wide, height = content (main resizes to the content's height). Acrylic glass window (P87): Windows draws the rounded corners and shadow. Like the dashboard (P92): the whole window is the smoke-tinted glass frame (`sidebar` at the Glass tint, P89/P90), and inside it, 8 px in, sits the content card (12 px radius, 97 % solid `bg`, the dashboard content card's shadow, 20 px padding) with plain controls. Styled like the reference popover card (`rize-autotag-example.png` in `design/reference/INDEX.md`). It pops on top when it appears and again whenever another block ends (P60); it never closes on Esc.

### Accounting (P60)
```
 ╭──────────────────────────────────────────╮
 │ ● BLOCK ENDED                Keep working│  ← caps accent; Keep working only after a cut at the end of work hours
 │ What did you do 11:00–11:15?             │  ← 15/600 text
 │ 11:00–11:15  15m  Away 9m · Code, github │  ← range 12/500, length faint, hints muted
 │ [ What did you do?  (autocomplete)     ] │
 │ [Save] [Break] [Same: Replying to emails]│  ← pills: primary, secondary, ghost
 ╰──────────────────────────────────────────╯
```
- Asks (P70): under a hairline, a muted caps `HOW DO THESE COUNT?` (`HOW DOES THIS COUNT?` for one), then up to 3 rows: key 12/400 `text` · time `faint`, and under it small `[Productive][Neutral][Distracting]` buttons, the current category outlined. A pick removes the row; Save doesn't wait for them.
- Several ended blocks: heading `4 BLOCKS`, title `What did you do in these 4 blocks?`, a segmented `One answer for all | Each separately`. All: the block lines, then one input and the same buttons. Each: per block its line, an input and a small `Break` toggle (outline when on); `Save` saves the filled rows, `Blocks left empty stay for later.`
- Efficiency (P75): between the input and the buttons, a muted caps `EFFICIENCY` and a `surface-2` group of `25% 50% 75% 100%` (24 px, 12/500, picked = `accent` fill, `on-accent` text; clicking it again clears). In "Each separately" the same group without the label sits at the right of each block line, hidden while the row's Break is on.
- Errors 12 px `red` under the buttons.

### Midnight card (P98)
```
 ╭──────────────────────────────────────────╮
 │ ● YESTERDAY                              │  ← caps green; or the date: FRI, NOV 20
 │ How did yesterday go?                    │  ← 15/600 text
 │ WINS                                     │  ← caps muted (P100)
 │ •  Shipped the midnight card             │  ← one field per line, 13 px, borderless until hover/focus; long text wraps and the field grows (P101)
 │ •  │                                     │     Enter adds a line, Backspace on an empty one removes it
 │    + Add                                 │  ← 12 px muted; gone at 10 lines (P100)
 │ HOW I'LL IMPROVE                         │
 │ •  One thing to do differently           │  ← placeholder faint
 │    + Add                                 │
 │ [Skip]                                   │  ← secondary pill; `Save` primary once anything changed (P99)
 ╰──────────────────────────────────────────╯
```

### Start reminder (P59)
Heading `NOT STARTED` in `away`, title `Work hours have started`, body `Press Start to begin 15m blocks.`, then `Start` (primary) and `Not now`.

### Yesterday's improvements (P99)
At the bottom of the Block ended card (above the asks) and the start reminder, until a block of today is answered: a hairline, a muted caps `YOUR “HOW I'LL IMPROVE” FROM YESTERDAY` (or `… FROM FRIDAY`), then one 13 px `text` line per improvement with a `faint` bullet.

## 4. Dashboard (`#/dashboard/*`)

1200 × 800, min 960 × 640, acrylic glass window with no title bar (P87): Windows' min/max/close sit over the glass, and the top 36 px strip drags the window.
- **Sidebar** 216 px, smoke-tinted glass (P89); text and icons carry a soft glow in `bg` (P87). Top: 20 px app icon (the spider web, P94) + "Spyder" 14/600, in the drag strip. Groups with 11/600 headings (`text` 55 %): Day (Today, Review, Visualizer) (P80, P88), Trends (Week, Month), Setup (Rules, Settings). Nav items 36 px tall, 16 px icons (inline SVG, 1.5 px stroke), radius 9; active = a frosted pill that slides to it, `text`, 600; inactive `text` 80 %, hover frosted. A badge (accent pill) on Review shows pending items.
- **Sidebar footer** (a small frosted card, P59, P87; secondary buttons and the length box frosted): state dot + caption (`Block · 15m` with the timer, `Not started` in orange, or `Off hours`), then the block-length box (56 px number input, `min blocks`; Enter or blur applies it from the next block), then `Start` (primary, full width), or `Stop` (secondary) while the loop runs. Off hours: `Keep working +N` (P20, P62). Then a `Show widget` ghost button.
- **Top bar** (56 px, no border, P87): page title 20/700, `‹ ›` (28 px ghost) and the date, right side page actions (Review: `Complete review` primary, replaced by the green `✓ Reviewed at HH:MM` chip once complete, P96). Export lives in Settings only (P72).
- **Content:** on a floating card (P87): 36 px below the window top, 8 px from the right and bottom edges, radius 12, `bg` at 97 %, soft shadow. Inside, padding 24, 12-column grid, gap 16. Cards: `surface`, 1 px `border`, radius card, padding 16, header = `section-title` + optional right-aligned muted total.
- **Toast** (P52): bottom centre, `surface` card with `shadow-pop`, one line + `Undo` (accent text) + ×; gone after 8 s. Errors show in `red` without Undo.

### Today (P55 — core first)
One centred column, max 960 px, 32 px between sections. Section heads: `section-title` left, muted totals right.
1. **Stat row** (P80, P87): 4 separate rounded tiles (`surface-2` at 50 %, radius 14, gap 12; values 26/700) (the shared `StatStrip`, also on Week and Month): Productive, the headline (green when the goal is met, a 4 px progress bar in `productive`, `green` once met, `of 5h goal · met`), Work (`1h break`), Efficiency (P75: `75%`, `3h effective`, or `—` / `no blocks rated`), Streak (`goal met in a row`). Each label has a 14 px line icon before it (P102, 1.8 px stroke, label colour): target, briefcase, gauge, flame (`orange` while the streak is above 0). Day score is on Review, Week and Month. Values `stat`, labels `section-label`.
2. **Block log** (P64, P87): blocks and untracked spans in time order as soft rounded tiles (44 px, radius 10, `surface-2` at 45 %, gap 4; joined blocks form one tile), checkbox and dropdown arrows shown on hover or when ticked: checkbox (hidden on the running block) · time range (`11:00–now` while running) · 3 px colour bar (`work` when answered, `open` grey when not, break 50 %) · answer (click to re-answer; `Not accounted for` in orange; `● Running` on the running block, a ring pinging out of the dot, P102) · tag dropdown (P66, P74: a 2 px-radius swatch in the tag's colour + `Work`/`Break`/`Gym`/`Food` 12 px `muted` + chevron, 80 px, borderless until hover; disabled on the running block) · duration · efficiency dropdown on work blocks, right of the duration (P103) (P75: when not rated, empty until the row is hovered, then `—` `faint` (P102); else `75%` `muted`, 64 px, same style; an empty 64 px on breaks) · on hover, ✎ and 🗑 icon buttons, with ↶ Unmerge before them on a merged block (P86; 88 px column). Neighbouring blocks (nothing shown between them, P73) with the same tag and answer are joined, and start **collapsed** into one row (P102): the whole span, the total duration, and a `3 blocks · 45m ›` caption (11 px faint, hover tint) that opens them; its tick, tag, rating (when they differ, their time-weighted mean, e.g. `67%`, P104), ✎ and 🗑 act on all of them. Opened: no divider between them, the colour bar runs through, later rows' answers in `faint`, and the first carries the caption with its chevron turned down. Untracked rows are muted and read-only. Header right: `22 blocks · 2 not accounted for · 15m untracked`, then a small `Merge repeats` secondary button while any blocks are joined (P73); with ticks: `2 selected · Tag… · Rate… · Answer… · Merge… · Delete · Clear` (`Rate…` only while every ticked block is work) (`Tag…` is a bordered dropdown: Work / Break).
   - **Re-answer** turns the row into the answer input + `Save` / `Break` / `Cancel`; Enter saves, Esc cancels.
   - **Answer…** and **Merge…** open a panel above the table: an answer input (Merge pre-fills a shared answer and says `They become one 45m block, 12:45–13:30, with one answer.`), `Save`/`Merge` primary and `Break` (answer only; a merge of breaks may leave the answer empty). When a merge isn't allowed, its reason shows in red instead of the input: `Only blocks next to each other can be merged`, `A break can’t be merged with work blocks. Change their tags first.`
   - Delete and merge apply at once and show the toast with Undo.
3. **Timeline**, two tracks (P55, P77): 30 px block track; work hours lit (`surface-2`), the rest at 45 %. Blocks in their log colour, breaks at 40 %, untracked hatched `faint`. Under it the **app track** (P77): 26 px, same lane background, one run per stretch on an app or site (every switch, however short), each app or site in its own colour: the user's pick (P79) or its fixed automatic slot `app-1…8` (chosen from its name, so the same every day; slots repeat), the name in 11 px ink inside runs wide enough (truncated with …; dark ink, light on a dark picked colour), 1 px gap between runs; a legend row (11 px `muted`, swatch · name, the 12 biggest apps then `+N more · Settings → App colours` `faint`) under the axis; clicking a swatch opens the native colour picker for that app (P79). Small red triangles above the block track for flags, an accent `now` line through both tracks. Hour labels 11 px `faint`. Hover: tooltip card (answer, time range · duration; on the app track: app or site, category · time range). Clicking a block outlines it, dims the rest and highlights its log row. Legend (Work · Not accounted for · Break · Gym and Food only on days that have them · Untracked, P80) at the right of the head. Under the timeline (after the app legend) a small **App track** switch (11 px muted label) swaps the app track and its legend for the timeline as it was before P77: a 4 px category strip under the block track (each stretch in its category colour, no lane behind it), the hour axis under it; the choice is kept (P85). Review's small timeline always shows the track.
4. **Apps & sites** (scope right): a 6 px stacked category bar with an inline legend, then the top 5 in a bordered table: the app's colour square (its app-track colour; click picks it, P81) · the app's own 16 px icon (P102; a site shows its browser's; an empty 16 px until the program is known) · name · `1h 26m` · faint `%` · quiet category label (click opens the 3-option menu). `Show all N` reveals the rest.
5. **Distractions**, only when there is distracting time or a flag: head right `1 flag · 7m distracting`, then one row per flag (red dot · time · target · `5m straight`).
6. Off-hours note, 12 px faint.

### Week
Stat strip of 5, as on Today (P80): Productive, Work, Avg day score, Efficiency `83%` · `38m effective` (P75), Goals hit `3/5`; label icons as on Today (P102): target, briefcase, star, gauge, check circle. Stacked bar chart (8 cols, 280 px): one bar per day, stacks productive / neutral / distracting / uncategorized / break / away. Goal-hit marker: green ✓ dot above the bar. Right (5 cols): "Apps & sites", the top 10 ranked. Under them, once any block in the week is rated (P80), a full-width "Efficiency · by day" card: a 150 px line (0–100 %, a dot per day so a lone day shows).

### Month
The Week stat strip on top (P80). Calendar heatmap (custom SVG, 7 columns Mon–Sun, 44 px cells, radius 6): fill = `productive` at opacity (P80) scaled by productive hours (0 h → `surface-2`, ≥ goal → 100 %), day number top-left 11 px (dark ink above half the goal), a green dot ringed in `surface` if goal met; unscheduled days outlined only. Right: trend line charts (productive hours in `productive`, day score, efficiency (P75, 0–100 %, days off too, dots; only once a block is rated, P80)) and one small line chart per KPI.

### Review
Two columns. Left (7 cols): Day summary card first, then the "Leftover" card (P97). "Leftover" card listing blocks not accounted for (`What did you do 16:30–16:45? (15m)`), each with the answer input, `Save`, `Break` and a `Delete block` ghost link (P60, P64); a check-mark empty state "All time accounted for". Day summary card: Productive alone on the first row, 32/700 `tabular`, as `5h 23m/6h` (productive / daily goal), `red` under the goal, `green` at or over it, `text` on a day off (P97); then one row of 5 mini stats at 15/600 (Work, Day score, Efficiency with `23m effective` (or `no blocks rated`) 11 px `muted` under it (P75), Break, Distracting); under a hairline, the **time split** (P68): a 132 px donut (outer r 62, inner r 42, 2 px `surface` gaps) of Work (`work`), Break (`break`), Not accounted for (`open`), Untracked (hatched `faint`), the total in the middle (15/600) over `in total`, and a legend on the right (swatch · label `muted` · duration · share `muted`); hovering a slice or a legend row dims the others and shows its share and label in the middle; then the small timeline. Right (5 cols): "Today's wins" and "How I'll improve" bullet editors (each item a row with drag handle `⋮⋮`, text input without border until focus, delete ×; `Enter` adds a row), KPIs (P80: set up here; label + number input + unit; `Edit` (accent text, card head) turns the rows into name and unit inputs with a `Remove` ghost button, which archives; `+ Add KPI` under them). `Complete review` primary in the top bar, disabled with a tooltip while leftovers exist; completed state shows a green "Reviewed at 17:12" chip.

### Visualizer (P88)
Today as a 24-hour star clock on a dark night sky (always dark, in both themes), drawn in an 800 × 800 box scaled to fit the card (max 760 px). From the middle out: the bar's readout (caption 9–15 px caps `muted`; the block timer, 600 tabular, ~10 % of the dial, soft accent glow; `Not started` orange, `Off hours` muted, distracted red; Productive in light accent, `green` once the goal is met, and the percent cell as the bar shows it; the time `faint`) · goal ring r 164 (2.4 px, light accent, `green` once met) · **star ring** r 194 (canvas: ~520 twinkling stars and 14 four-point sparkles, one turn every 2 min, purple halo; stars lit purple from the work-hours start to now; a comet with a tail at now) · flags r 216 (red triangles) · block track r 224–254 (block colours as the timeline, breaks 50 %, the running block accent with a soft glow, untracked hatched, away `away` 35 %) · app track r 260–284 (app colours, P79) · ticks every 15 min from r 292 (hour 8, every 6 h 12 and white) · hour labels `00`–`23` at r 318 (every 6 h 16/700, the current hour 18/700 white, else 12 `faint`). Both lanes are dim all day and lit over work hours. A now hand (light accent, glow) crosses both tracks. Hover: dark tooltip card (title · time range · duration). Under the dial, two centred legend rows (11 px): Block track (Work · Not accounted for · Break · Gym and Food when present · Untracked) and App track (top 10, then `+N more`).

### Rules
Tabs (segmented): Rules · Title patterns · To sort (KPIs are on Review, P80). Each is an editable table with an `+ Add` row at top. Default rows show a muted `default` chip; user rows win. To sort (P70): rows `key · default chip (if pre-labelled) · time, all time · [Productive][Neutral][Distracting]` one-click buttons, the current category outlined; empty state "Everything you use has a category you picked".

### Settings
Sections as cards, one per subject (P80), in two columns. Left (7 cols): Work hours (an "Every day" row first: a toggle (P84). On, it shows one start–end that turns all 7 days on with those hours (empty until both are filled, P82), and the 7-row grid and the "Today only" row collapse. Off, the label is muted with no range, and the 7-row grid (toggle, start time, end time) and the "Today only" override row show. It starts on while all 7 days are on with the same hours.), Blocks & nudges (Track from startup toggle (P76), then idle, keep-working step, nudge after, repeat nudge, distraction reset — number inputs with unit suffix; block length is only in the sidebar, P59). Right (5 cols): Goal; Look (Theme System / Light / Dark segmented control, P57; Font System / Atkinson Hyperlegible segmented control, P78; Glass tint, P90: a 96 px accent range slider (0–100 %, step 5) + the value + a `Reset` ghost once changed; Bar percent Of day / Of goal segmented control, P82; Accent colour, P93: a 40 × 32 native colour swatch (shows the theme's purple until picked) + `Reset to default` ghost button once changed; Work colour, P67, Gym colour and Food colour, P74: each a 40 × 32 native colour swatch + `Reset to default` ghost button once changed; App colours, P79: a hint, one row per picked app — 36 × 28 native colour swatch · name · `Reset` ghost — then a name input + `Add`); Tracking (sample interval, app % scope); System (autostart toggle, widget hotkey field, data folder path + `Open folder`, `Export…` button). Orange warning banner at the top if the hotkey couldn't be registered; capture-unavailable banner: orange, top of page.

Toggles: 32 × 18 track, `surface-2` off / `accent` on, white 14 px knob.

## 5. Charts (Recharts + custom SVG)
- Background transparent on the card; gridlines `border` 1 px, horizontal only, dashed `3 3`. Axis text `11px muted`, no axis lines, ticks off.
- Bars radius `[3,3,0,0]` on the top stack only, max width 28. Lines 2 px, no dots except on hover (4 px). Donut: inner radius 62 %, padding angle 1, centre label = total `1h 26m` (`stat` 20) + `section` caption.
- Colours: categories use the category tokens; breaks and away use their block-state tokens; KPI lines use `planned`.
- Tooltip: `surface` card, 1 px `border`, `shadow-pop`, radius control, 12 px, values tabular.
- Durations displayed as `2h 15m` everywhere on screen, tables and charts too, `38m` under an hour, `0m` under a minute (P102). Only the exported files use `h:mm`. Timers are `mm:ss`.

## 6. Tray & icon
- Icon (P91): a spider web, dark outline with slate-blue fill (`resources/icon.png`, 256 px, transparent; edit the PNG directly). Tray uses the PNG resized to 16/32; electron-builder makes the .ico.
- Tray menu: `Show widget`, `Show How I'll improve` (only while the gadget is on in Settings, P107), `Open dashboard`, then Start/Stop, then `Quit`.
- Notifications (nudge toast) use the system toast; title `Spyder`, body per plan §8.
