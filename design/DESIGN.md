# Spyder design spec

Visual source of truth for the renderer. Behavior lives in `SPYDER_PLAN.md` §12. References: `design/reference/INDEX.md`.
The bar follows Rize's desktop widget (P23, P43). The dashboard is Linear/Vercel-style (P56): neutral greys, hairline borders, dense tables, small type, Spyder purple as the only accent, colour only where it carries meaning. Light, dark or follow Windows (P57).

**Brand rule:** no Rize logo, wordmark, name, or the purple "agent orb". Spyder's own mark is an accent circle with a white "S" (tray/app icon only). In the widget the orb's slot is taken by a functional **workday ring**.

## 1. Tokens (light and dark, P57)

`nativeTheme.themeSource` (Settings → Theme: System / Light / Dark, default System) drives `prefers-color-scheme` in every window, so the CSS tokens switch live. Dark values are the `@theme` defaults; light values override them under `@media (prefers-color-scheme: light)`. `src/main/theme.ts` sets the dashboard's native background to match `--color-bg`.

### Colours (`src/renderer/styles.css`)
| Token | Dark | Light | Use |
|---|---|---|---|
| `--color-bg` | `#0E0E10` | `#FFFFFF` | dashboard content background |
| `--color-sidebar` | `#09090B` | `#F7F7F8` | dashboard sidebar |
| `--color-surface` | `#141417` | `#FFFFFF` | cards, tables, bar, prompt window |
| `--color-surface-2` | `#1C1C20` | `#F3F3F5` | hover, selected nav, segmented control, timeline track |
| `--color-border` | `#232328` | `#E8E8EC` | hairline borders, row dividers |
| `--color-border-strong` | `#313138` | `#D5D5DB` | bar border, popovers, checkbox outline |
| `--color-text` | `#ECECEF` | `#18181B` | primary text |
| `--color-muted` | `#8F8F99` | `#6C6C77` | secondary text, labels |
| `--color-faint` | `#5E5E68` | `#A3A3AD` | tertiary text, axis labels, untracked |
| `--color-accent` | `#7B61FF` | `#6A4FF0` | primary buttons, selection, answered blocks |
| `--color-on-accent` | `#FFFFFF` | `#FFFFFF` | text on accent |
| `--color-red` | `#EF5157` | `#DC3A40` | distraction, destructive |
| `--color-orange` | `#F2A33A` | `#C97A10` | warnings |
| `--color-green` | `#3FB27F` | `#1F9D63` | goal met |
| `--color-open` / `break` | | | block states (see `styles.css`) |
| `--color-gym` / `food` | `#E8853D` / `#D9669B` | same | P74 Gym and Food blocks; Settings can change both |
| `--color-work` | `#3FB27F` | `#3FB27F` | work blocks (P67); replaced at runtime by the Settings pick |
| `--color-away` | | | start reminder, Week chart |
| `--color-planned` / `timed` | | | spare series colours (Month KPI lines) |
| `--color-productive` / `neutral` / `distracting` / `uncategorized` | | | activity categories |
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
- Radii: `pill` 9999 · `card` 8 · `control` 6 · `chip` 4 · `bar` 2.
- Spacing: 4-px grid (4, 8, 12, 16, 20, 24, 32). Card padding 16 (20 on dashboard stat cards).
- Shadows: `--shadow-float` for the prompt window, `--shadow-pop` for menus, tooltips, the merge panel and the toast. Dashboard cards have no shadow, only the 1 px border.
- Motion: 150 ms ease-out for hover/expand; the timer never animates digits.

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
  3. **Percent of day** (`14%`, `–` on a day off).
- **Minimize** (32 px, left border, `–`): hides the bar; the tray or the hotkey brings it back. Not remembered across launches.
- **Drag handle** (24 px, `surface-2` tint, ⋮⋮ grip, `cursor: move`) at the far right. Everything except the two buttons drags.
- Red border when distracted, which also tints the fill red and pulses once. No sound anywhere (P60).

## 3. Prompt window (`#/prompt`)

420 px wide, height = content (main resizes to `document.body.scrollHeight`). Fill `surface`, border 1 px `border-strong`, radius card, `shadow-float`, 20 px padding. Styled like the reference popover card (`rize-autotag-example.png` in `design/reference/INDEX.md`). It pops on top when it appears and again whenever another block ends (P60); it never closes on Esc.

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

### Start reminder (P59)
Heading `NOT STARTED` in `away`, title `Work hours have started`, body `Press Start to begin 15m blocks.`, then `Start` (primary) and `Not now`.

## 4. Dashboard (`#/dashboard/*`)

1200 × 800, min 960 × 640, framed window, background `bg`.
- **Sidebar** 216 px, `sidebar` fill, right border. Top: 20 px accent square mark + "Spyder" 14/600. Groups with 11/500 faint headings: Today (Today, Review), Trends (Week, Month), Setup (Rules, Settings). Nav items 32 px tall, 16 px icons (inline SVG, 1.5 px stroke), radius control; active = `surface-2` fill, `text`, 500; inactive `muted`, hover `surface-2` at 60 %. A badge (accent pill) on Review shows pending items.
- **Sidebar footer** (a small bordered `surface` card, P59): state dot + caption (`Block · 15m` with the timer, `Not started` in orange, or `Off hours`), then the block-length box (56 px number input, `min blocks`; Enter or blur applies it from the next block), then `Start` (primary, full width), or `Stop` (secondary) while the loop runs. Off hours: `Keep working +N` (P20, P62). Then a `Show widget` ghost button.
- **Top bar** (48 px, bottom border): page title `h1`, `‹ ›` (28 px ghost) and the date, right side page actions (Review: `Complete review` primary). Export lives in Settings only (P72).
- **Content:** padding 24, 12-column grid, gap 16. Cards: `surface`, 1 px `border`, radius card, padding 16, header = `section-title` + optional right-aligned muted total.
- **Toast** (P52): bottom centre, `surface` card with `shadow-pop`, one line + `Undo` (accent text) + ×; gone after 8 s. Errors show in `red` without Undo.

### Today (P55 — core first)
One centred column, max 960 px, 32 px between sections. Section heads: `section-title` left, muted totals right.
1. **Stat row**: one bordered strip of 5 cells divided by hairlines: Productive (green when the goal is met, a 4 px progress bar, `of 5h goal · met`), Worked (`1h break`), Day score (`of 7h scheduled`), Efficiency (P75: `75%`, `3h effective`, or `—` / `no blocks rated`), Streak (`goal met in a row`). Values `stat`, labels `section-label`.
2. **Block log** (P64): a bordered table of blocks and untracked spans in time order, 40 px rows: checkbox (hidden on the running block) · time range (`11:00–now` while running) · 3 px colour bar (`work` when answered, `open` grey when not, break 50 %) · answer (click to re-answer; `Not accounted for` in orange; `● Running` on the running block) · tag dropdown (P66, P74: a 2 px-radius swatch in the tag's colour + `Work`/`Break`/`Gym`/`Food` 12 px `muted` + chevron, 80 px, borderless until hover; disabled on the running block) · efficiency dropdown on work blocks (P75: `—` `faint` when not rated, else `75%` `muted`, 64 px, same style; an empty 64 px on breaks) · duration · on hover, ✎ and 🗑 icon buttons. Neighbouring blocks (nothing shown between them, P73) with the same tag and answer are joined: no divider between them, the colour bar runs through, later rows' answers in `faint`, and the first carries `3 blocks · 45m` (11 px faint). Untracked rows are muted and read-only. Header right: `22 blocks · 2 not accounted for · 15m untracked`, then a small `Merge repeats` secondary button while any blocks are joined (P73); with ticks: `2 selected · Tag… · Rate… · Answer… · Merge… · Delete · Clear` (`Rate…` only while every ticked block is work) (`Tag…` is a bordered dropdown: Work / Break).
   - **Re-answer** turns the row into the answer input + `Save` / `Break` / `Cancel`; Enter saves, Esc cancels.
   - **Answer…** and **Merge…** open a panel above the table: an answer input (Merge pre-fills a shared answer and says `They become one 45m block, 12:45–13:30, with one answer.`), `Save`/`Merge` primary and `Break` (answer only; a merge of breaks may leave the answer empty). When a merge isn't allowed, its reason shows in red instead of the input: `Only blocks next to each other can be merged`, `A break can’t be merged with work blocks. Change their tags first.`
   - Delete and merge apply at once and show the toast with Undo.
3. **Timeline**, two tracks (P55, P77): 30 px block track; work hours lit (`surface-2`), the rest at 45 %. Blocks in their log colour, breaks at 40 %, untracked hatched `faint`. Under it the **app track** (P77): 26 px, same lane background, one run per stretch on an app or site (every switch, however short), each app or site in its own colour: the user's pick (P79) or its fixed automatic slot `app-1…8` (chosen from its name, so the same every day; slots repeat), the name in 11 px ink inside runs wide enough (truncated with …; dark ink, light on a dark picked colour), 1 px gap between runs; a legend row (11 px `muted`, swatch · name, the 12 biggest apps then `+N more · Settings → App colours` `faint`) under the axis; clicking a swatch opens the native colour picker for that app (P79). Small red triangles above the block track for flags, an accent `now` line through both tracks. Hour labels 11 px `faint`. Hover: tooltip card (answer, time range · duration; on the app track: app or site, category · time range). Clicking a block outlines it, dims the rest and highlights its log row. Legend (Work · Not yet · Break · Untracked) at the right of the head.
4. **Apps & sites** (scope right): a 6 px stacked category bar with an inline legend, then the top 5 in a bordered table: category square · name · `h:mm` · faint `%` · quiet category label (click opens the 3-option menu). `Show all N` reveals the rest.
5. **Distractions**, only when there is distracting time or a flag: head right `1 flag · 7m distracting`, then one row per flag (red dot · time · target · `5m straight`).
6. Off-hours note, 12 px faint.

### Week
Stat row of 5 (total work, productive, avg score, efficiency `83%` · `38m effective` (P75), goals hit `3/5`). Stacked bar chart (8 cols, 280 px): one bar per day, stacks productive / neutral / distracting / uncategorized / break / away. Goal-hit marker: green ✓ dot above the bar. Right (4 cols): top 10 sites ranked list. Under them, a full-width "Efficiency · by day" card: a 150 px line (0–100 %, a dot per day so a lone day shows). Bottom: estimate accuracy table (session · planned · actual · delta, delta red when over by > 10 %).

### Month
Calendar heatmap (custom SVG, 7 columns Mon–Sun, 44 px cells, radius 6): fill = accent at opacity scaled by productive hours (0 h → `surface-2`, ≥ goal → 100 %), day number top-left 11 px (`on-accent` above half the goal), a green dot ringed in `surface` if goal met; unscheduled days outlined only. Right: trend line charts (productive hours, score, efficiency (P75, 0–100 %, days off too, dots)) and one small line chart per KPI.

### Review
Two columns. Left (7 cols): "Leftover" card listing blocks not accounted for (`What did you do 16:30–16:45? (15m)`), each with the answer input, `Save`, `Break` and a `Delete block` ghost link (P60, P64); a check-mark empty state "All time accounted for". Day summary card: mini stats (3 columns, 2 rows: Work, Productive, Score / Efficiency with `23m effective` (or `no blocks rated`) 11 px `muted` under it (P75), Break, Distracting); under a hairline, the **time split** (P68): a 132 px donut (outer r 62, inner r 42, 2 px `surface` gaps) of Work (`work`), Break (`break`), Not accounted for (`open`), Untracked (hatched `faint`), the total in the middle (15/600) over `in total`, and a legend on the right (swatch · label `muted` · duration · share `muted`); hovering a slice or a legend row dims the others and shows its share and label in the middle; then the small timeline. Right (5 cols): "Today's wins" and "How I'll improve" bullet editors (each item a row with drag handle `⋮⋮`, text input without border until focus, delete ×; `Enter` adds a row), KPI inputs (label + number input + unit). `Complete review` primary in the top bar, disabled with a tooltip while leftovers exist; completed state shows a green "Reviewed at 17:12" chip.

### Rules
Tabs (segmented): Rules · Title patterns · To sort · KPIs. Each is an editable table with an `+ Add` row at top. Default rows show a muted `default` chip; user rows win. To sort (P70): rows `key · default chip (if pre-labelled) · time, all time · [Productive][Neutral][Distracting]` one-click buttons, the current category outlined; empty state "Everything you use has a category you picked".

### Settings
Sections as cards: Work hours (7-row grid: toggle, start time, end time; plus "Today only" override row), Timers (block length, idle, nudge, keep-working step — number inputs with unit suffix), Goal, Widget & hotkey (Theme System / Light / Dark segmented control, P57; Work colour, P67, then Gym colour and Food colour, P74: each a 40 × 32 native colour swatch + `Reset to default` ghost button once changed; Font System / Atkinson Hyperlegible segmented control, P78; hotkey field; orange warning banner if registration failed), Tracking (sample interval, app % scope radio), System (autostart toggle, data folder path + `Open folder`), Export (`Export…` button), App colours (P79, under System: a hint, one row per picked app — 36 × 28 native colour swatch · name · `Reset` ghost — then a name input + `Add`). Capture-unavailable banner: orange, top of page.

Toggles: 32 × 18 track, `surface-2` off / `accent` on, white 14 px knob.

## 5. Charts (Recharts + custom SVG)
- Background transparent on the card; gridlines `border` 1 px, horizontal only, dashed `3 3`. Axis text `11px muted`, no axis lines, ticks off.
- Bars radius `[3,3,0,0]` on the top stack only, max width 28. Lines 2 px, no dots except on hover (4 px). Donut: inner radius 62 %, padding angle 1, centre label = total `h:mm` (`stat` 20) + `section` caption.
- Colours: categories use the category tokens; breaks and away use their block-state tokens; KPI lines use `planned`.
- Tooltip: `surface` card, 1 px `border`, `shadow-pop`, radius control, 12 px, values tabular.
- Durations displayed as `h:mm` in tables, `2h 15m` in prose and prompts, `38m` under an hour.

## 6. Tray & icon
- Icon: 256 px accent (`#7B61FF`) circle with a white bold "S" (`scripts/make-icon.ps1`). Tray uses the PNG resized to 16/32.
- Notifications (nudge toast) use the system toast; title `Spyder`, body per plan §8.
