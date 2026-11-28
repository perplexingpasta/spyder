# Changelog

What changed on `main`, newest first, written for whoever pulls next (people and their agents). Each entry says
**what** changed for the user, **why**, and **if you pull this**: anything that behaves differently for you, such as a
changed default, a migration, a new setting or a test-helper change. The full reasoning is in the P decision it cites
(`docs/product-decisions.md`).

Add an entry in the same commit as the change (see AGENTS.md → Commits).

## 2026-11-28: Sleep is beige (P106)

**What**
- The Sleep tag's default colour is beige (`#e8dcc4`) instead of indigo.

**Why**
The user wants Sleep in cream/white/beige.

**If you pull this**
- Migration 010 changes a saved `sleepColor` of `#6c71c4` (the old default) to `#e8dcc4`; a colour you picked yourself stays.

## 2026-11-27: Ask about time asleep or off all day; the Sleep tag (P105)

**What**
- Settings → Blocks & nudges → **Ask about time asleep or off**: `Work hours` (as before) or `All day`.
- With All day, time the laptop was asleep or off outside work hours (while blocks ran) becomes `Computer asleep or off` blocks tagged **Sleep**, one per stretch of a day, which the prompt asks about on wake with a new **Sleep** button.
- **Sleep** is a new tag: neither work nor break time. It has its own colour (Settings → Look), slice in Where the day went, legend entry, tag-dropdown entry and export kind `sleep`.
- Days with only Sleep blocks don't count for the midnight card.

**Why**
Sleep after midnight and a night with the laptop off were left untracked and never asked about; the user wants every minute accounted for without the night swelling break time.

**If you pull this**
- Migration 009 rebuilds `sessions.tag` so its CHECK allows `sleep` (the column moves to the end of the table; no rows change).
- New settings keys `asleepScope` (default `work_hours`, so nothing changes until you pick All day) and `sleepColor`.
- `insertGapBlock` rows carry a `tag` (`break` / `sleep`); `EngineSettings` includes `asleepScope`.

## 2026-11-26: Collapsed rows show their efficiency (P104)

**What**
- A collapsed row whose blocks are rated differently shows their time-weighted mean (e.g. `67%`), the same value a merge would keep, instead of `mixed`.

**Why**
The user asked never to show `mixed`, just the calculated efficiency.

**If you pull this**
- Nothing to do.

## 2026-11-26: Efficiency after the duration (P103)

**What**
- In Today's block log, the efficiency picker moved to the right of the duration.

**Why**
The user asked for the duration next to the tag and the rating after it.

**If you pull this**
- Nothing changes beyond the column order.

## 2026-11-26: Today at a glance (P102)

**What**
- Today's stat tiles have icons: a target (Productive), a briefcase (Work), a gauge (Efficiency) and a flame (Streak), orange while the streak is alive.
- Week and Month's stat tiles have icons too: target, briefcase, a star (Avg day score), gauge and a check circle (Goals hit).
- The running block's dot sends out a ring as it pulses.
- Joined blocks start collapsed into one row with the whole time span and total duration. Click the `3 blocks · 45m ›` caption to open them. The collapsed row ticks, tags, rates (`mixed` when the ratings differ), re-answers and deletes all of its blocks.
- An unrated work block no longer shows `—`; the cell stays empty until you hover the row.
- Every duration on screen reads `1h 26m` (was `1:26` in Apps & sites, Week, Month, Rules and the prompt's app list). Exports are unchanged.
- Apps & sites shows each app's real icon, read from its program file; a site shows its browser's icon.

**Why**
The user wants Today easier to take in at a glance.

**If you pull this**
- Migration 008 adds the `app_paths` table. Apps get their icon once capture has seen them run after this update; older apps show none until then.
- `AppRow` has a new `exe` field. New IPC `appIcons(exes)` and debug hook `rememberAppPath(exe, path)`.
- e2e: block rows of joined blocks are hidden until opened; `openRuns(d)` in `tests/e2e/helpers.ts` opens them all. `fmtHM` is now used only by the export.

## 2026-11-26: Long wins and improvements wrap (P101)

**What**
- On the Review page and in the midnight card, a long win or improvement wraps onto more lines and its field grows to show all of it. Nothing is cut off.
- Enter still adds the next line; it never puts a line break inside an entry.

**Why**
Long entries were cut off in their one-line fields.

**If you pull this**
- Nothing special. Those fields are now `<textarea>`s (new `WrapInput` in `ui/controls.tsx`); the test ids are unchanged.

## 2026-11-26: The midnight card: Wins, + Add, up to 10 (P100)

**What**
- The midnight card's first section reads "Wins" instead of "Today's wins".
- Each section has a "+ Add" button for another line, up to 10 lines each. The card grows with its lines, and scrolls inside once the prompt window is at its tallest.

**Why**
The card is about yesterday, and the user wants an obvious way to add several wins and improvements.

**If you pull this**
- Nothing special.

## 2026-11-26: Clearer heading for yesterday's improvements (P99)

**What**
- The heading above yesterday's improvements on the Block ended card and the start reminder now reads "Your “How I'll improve” from yesterday" (or "from Friday").

**Why**
The user found "Yesterday I'll improve" unclear.

**If you pull this**
- Nothing special.

## 2026-11-26: Yesterday's improvements in the morning (P99)

**What**
- The next day, the Block ended card and the start reminder show yesterday's "How I'll improve" items at the bottom, until you answer your first block of the day.
- The midnight card's button reads "Skip" instead of "Skip for today".

**Why**
The user wants to see yesterday's improvements when starting the day. The start reminder alone wouldn't do, because it never shows with Track from startup on.

**If you pull this**
- Nothing special. `accountView` and `reminderView` take an optional `improves`, and their view models gain an `improves` field.

## 2026-11-26: The midnight card (P98)

**What**
- Once a day ends, the prompt asks for its wins and how I'll improve, the same columns as Review. Both are optional: the button reads "Skip for today" until you type, then "Save". What you save shows on that day's Review.
- If the laptop was asleep or off at midnight, it asks on the next wake or launch, about the last day with blocks. Each day is asked about once, and not at all if its review already has a win and an improvement.
- Settings → Goal → "Ask about the day at midnight" turns it off.

**Why**
The user wants to write the day's wins and improvements every day without opening the dashboard.

**If you pull this**
- Migration 007 adds the `reflections` table. New setting `askReflection` (on by default) and IPC method `saveReflection(date, lists | null)`. `ReviewVM` gains `reflectedMs`.
- The e2e helper's `SPYDER_DEFAULTS` now turns `askReflection` off, so specs that cross midnight don't see the card; `reflect.spec.ts` turns it on.

## 2026-11-26: Productive is the Review headline (P97)

**What**
- On Review, the Day summary card is now first and the Leftover card is under it.
- Day summary leads with **productive time** against the daily goal in large type, e.g. "5h 23m/6h": red under the goal, green at or over it, and the plain text colour on a day off. The other five stats sit in one smaller row under it.

**Why**
Productive time and hitting the daily goal are what matter most to the user.

**If you pull this**
- Nothing special. `review.spec.ts` checks the headline's text and colour (new test id `review-productive`).

## 2026-11-26: No "Update review" (P96)

**What**
- Once a day's **review** is complete, the Review page shows only the green "✓ Reviewed at HH:MM" chip. The "Update review" button is gone.

**Why**
Re-completing only moved the completion time, because the saved day numbers already follow later edits (P52). The second label confused the user.

**If you pull this**
- Nothing special. `review.spec.ts` checks that the button is gone after completing.

## 2026-11-26: Time asleep or off is accounted for (P95)

**What**
- When the laptop sleeps or Spyder isn't running while the loop runs, the work hours of that gap become a **break** block reading "Computer asleep or off". The prompt asks about it on return, alongside the other ended blocks. If it's never answered it stays a break, so it never counts as work. The night (outside work hours) stays untracked.
- Every **untracked** row in Today's block log gets a ✎. It opens the inline answer (Save = work, Break = break), and the span becomes one block, with Undo.

**Why**
The user wants every minute of the day accounted for. A 2-hour nap with the laptop asleep showed only as untracked, with no way to say what it was.

**If you pull this**
- New engine DB effect `insertGapBlock` and IPC method `fillUntracked(startMs, endMs, answer, tag)`. No migration and no new settings.
- Waking after a sleep in work hours now adds a break block before the fresh loop, so specs that count blocks across a sleep or restart may see one more.

## 2026-11-25: Release 0.2.0

**What**
- Spyder 0.2.0: everything from P75 to P94 since 0.1.0, packaged as `Spyder Setup 0.2.0.exe`.

**Why**
The user asked for a new release.

**If you pull this**
- `package.json` version is 0.2.0, tagged `v0.2.0`.

## 2026-11-25: e2e runs stay off your screen

**What**
- `npm run test:e2e` no longer takes over the screen: the test windows are invisible and click-through, never steal focus or keyboard input, stay off the taskbar, and nudge toasts don't pop up. The app itself is unchanged.

**Why**
Test runs hijacked the user's screen and keyboard, so they couldn't work while the suite ran.

**If you pull this**
- New debug-only env var `SPYDER_QUIET=1` (ignored without `SPYDER_DEBUG=1`); the e2e helper sets it. Set `SPYDER_E2E_SHOW=1` to watch a run with real windows.

## 2026-11-25: Spider web in the sidebar (P94)

**What**
- The dashboard's top-left mark beside "Spyder" is now the spider web app icon instead of the purple square with an "S".

**Why**
The user expected the dashboard to show the latest icon.

**If you pull this**
- The renderer imports `resources/icon.png` directly, so replacing that file updates the sidebar too. The mark has `data-testid="sidebar-mark"`.

## 2026-11-25: Accent colour in Settings (P93)

**What**
- Settings → Look has an **Accent colour** swatch: pick any colour and it replaces Spyder purple at once in the dashboard, the bar and the prompt (buttons, selection, toggles, highlights). `Reset to default` brings back the purple.
- Text on the accent turns dark when the picked colour is light, so it stays readable.

**Why**
The user wanted to choose the accent colour themselves.

**If you pull this**
- New setting `accentColor` (`#rrggbb`, or `null` = Spyder purple, the default). Nothing changes until it's set.
- `applyFont` / `applyFontTo` in `src/main/theme.ts` are now `applyStyle` / `applyStyleTo`; they insert the accent CSS along with the font. New e2e screenshot `settings-accent.png` (theme spec).

## 2026-11-25: Prompt glass like the dashboard (P92)

**What**
- The prompt (Block ended, start reminder) now looks like the dashboard: a smoke-tinted glass frame with a solid rounded card inside, so its text is crisp whether or not the window is focused.
- The grey bar at the bottom of the prompt is gone.
- Settings → Glass tint now tints the prompt's frame too.

**Why**
The prompt looked faded and out of place next to the glass dashboard, with a stray grey bar at the bottom.

**If you pull this**
- The prompt's `<body>` has class `prompt` (was `transparent`); the `.glass-prompt` frosting rules are gone. New e2e screenshot `prompt-glass-tint.png` (theme spec).

## 2026-11-25: Spider web icon (P91)

**What**
- Spyder's app, installer and tray icon is now a spider web instead of the purple circle with an "S".

**Why**
The user wanted a spider web as Spyder's icon.

**If you pull this**
- `resources/icon.png` is now the source image; `scripts/make-icon.ps1` and `npm run icon` are gone (running it would have overwritten the web).

## 2026-11-25: Glass tint slider in Settings (P90)

**What**
- Settings → Look has a **Glass tint** slider: 0 % is clear glass, 100 % is a solid sidebar colour, in steps of 5. It retints the dashboard's glass frame live as you drag and is kept; `Reset` brings back 55 %.

**Why**
The user wanted to choose how dark or see-through the glass is.

**If you pull this**
- New setting `glassTint` (whole percent 0–100, default 55); the dashboard reads it into the CSS variable `--glass-tint`. E2e: the slider is `set-glassTint`, its reset `reset-glassTint`; new screenshot `settings-glass-tint.png`.

## 2026-11-25: Smoke-tinted glass sidebar (P89)

**What**
- The dashboard's glass frame (the sidebar and the edge around the content card) has a see-through smoke tint: charcoal in dark, frost in light. The glass still shows through, but the colour no longer follows the wallpaper.

**Why**
The user disliked the untinted sidebar's colour and wanted a calm, even one while keeping the Arc glass look.

**If you pull this**
- `--color-sidebar` is in use again, as the tint colour (at 55 %). `theme.spec.ts` checks the tint in both themes.

## 2026-11-25: Visualizer page, today as a 24-hour star clock (P88)

**What**
- A **Visualizer** item in the sidebar's Day group, after Review, shows today as a 24-hour star clock (00 at the top, 12 at the bottom) on an always-dark night sky.
- A slowly spinning ring of stars carries the bar: a comet at now, stars lit purple across the work hours passed. The bar's numbers sit in the middle.
- Outward rings: the block track, then the app track (Today's timeline colours), with distraction flags, a now hand and hour labels; an inner ring fills toward the daily goal. Hover shows the timeline's details. View only, today only; stars hold still under reduced motion.

**Why**
The user wanted a clock view of the day as its own page, so nothing else in the app changes.

**If you pull this**
- New e2e spec `tests/e2e/visualizer.spec.ts` and screenshot `__shots__/visualizer.png`. Nav id `visualizer`, route `#/dashboard/visualizer`.

## 2026-11-25: Arc look, glass dashboard and prompt, soft shapes (P87)

**What**
- The dashboard window is Windows 11 acrylic glass with no title bar; Windows' min/max/close sit over the glass and the top strip drags the window.
- The sidebar is see-through glass; the current page is a frosted pill that slides between items; the timer card is frosted.
- Each page sits on a floating rounded card. Bigger page title, stats as separate rounded tiles, block rows as soft rounded tiles (joined blocks form one tile). A row's checkbox and dropdown arrows show on hover or when ticked.
- Short motion (page fade-in, tile lift, sliding pill), off when Windows animations are off.
- The prompt window is acrylic glass too. The bar is unchanged.

**Why**
The user wanted Spyder much prettier, Arc-style, with real see-through glass. Appearance only; amends P56's flat style.

**If you pull this**
- Glass shows only on the focused window; unfocused, in battery saver or with Transparency effects off, Windows paints a flat colour.
- `theme.spec.ts` now checks the resolved `--color-bg` token instead of `body`'s background, which is see-through. Screenshots in `__shots__` can't capture acrylic, so the sidebar looks washed out there.
- `windowBackground()` is gone from `src/main/theme.ts`; use `titleBarOverlay()` for the dashboard's window buttons.
- Known failure: `widget.spec.ts` test 8 fails most runs at `widgetOnTop` before the first minimize. The dashboard window's acrylic causes it (without it, the test passes). Merged as is on the user's call; the bar may sometimes drop behind other apps while the glass dashboard is open.

## 2026-11-25: Unmerge a merged block any time (P86)

**What**
- A merged block on Today shows a small **Unmerge** icon (↶) next to the pencil and trash on hover. It splits the block back into the blocks it was made from, each with its own answer, tag and rating as before the merge. It works any time, after restarts too; the Undo toast still undoes the unmerge.

**Why**
A merge could only be undone from the Undo toast, which is gone after a few seconds, the next edit or a restart.

**If you pull this**
- Migration 006 adds a `merges` table recording what each merge combined. Merges made before it can't be unmerged.
- New IPC call `unmergeBlock(id)`; `SessionLine` gains `merged`. E2e: the icon is `block-unmerge`.

## 2026-11-25: README brought up to date (P75–P85)

**What**
- The README describes Track from startup (on by default), Every day work hours, the bar's goal/workday percent, two-step minimize, efficiency ratings, the Today stats and app track, and the theme, font and app colour settings. The old "Nothing starts by itself" line is gone.

**Why**
The README still described the app as of P74.

**If you pull this**
- Nothing special.

## 2026-11-25: App track switch under Today's timeline (P85)

**What**
- A small **App track** switch under Today's timeline. Off, the timeline is back to how it looked before the app track (P77): the blocks with the thin category strip under them, and no app legend. It's on by default and remembers your choice.

**Why**
The app track shows every app switch, which makes the timeline busy. The user wants to be able to hide it.

**If you pull this**
- New settings key `showAppTrack` (boolean, default `true`). No migration. E2e: the switch is `app-track-toggle`.

## 2026-11-25: Every day is a toggle in Work hours (P84)

`3f4d947`

**What**
- In **Settings → Work hours**, **Every day** has a switch. When it's on, you set one start–end for all 7 days, and the weekday rows and **Today only** are hidden. When it's off, the weekday rows and Today only show as before.
- The `days differ` hint is gone. The switch now shows whether all 7 days share the same hours.

**Why**
The user wants a short card when every day has the same hours, and the full grid only when they differ.

**If you pull this**
- Nothing special: no setting or migration. The switch starts on when all 7 days already match. E2e: the Every day switch is `sched-all-enabled`, and the `sched-all-start`/`-end` fields only exist while it's on.

## 2026-11-25: Minimize in two steps (P83)

`43b7e48`

**What**
- The bar's **minimize** button no longer hides the bar straight away. While the bar is on top, it drops the bar behind all your windows. Pressed again while the bar is behind, it sends the bar to the tray.
- A tray click, **Show widget** or the hotkey puts the bar back on top. If the bar is behind your windows, the hotkey brings it back on top instead of hiding it.

**Why**
The user wanted the bar out of the way of their apps but still on the desktop, with the tray one more press away.

**If you pull this**
- Run `npm run build:helper`: `UrlHelper.exe` has a new `back <hwnd>` mode that puts the bar behind other windows. Without the rebuilt helper the bar only stops being on top.
- New IPC `minimizeWidget` (`hideWidget` still hides straight away). The debug `state()` has a new `widgetOnTop` field.

## 2026-11-25: Local reinstall on push, not on every commit

**What**
- The maintainer's auto-reinstall now runs after a successful `git push` of `main` (`.githooks/pre-push`), not after every commit. The `.githooks/post-commit` hook is gone.

**Why**
A rebuild after every commit was slow and ran several reinstalls back to back. Pushing is the point where a change is meant to be used.

**If you pull this**
- Only matters if you turned the hooks on (`core.hooksPath .githooks`, maintainer only). Committing no longer reinstalls. Pushing `main` does, about 3 minutes later. To reinstall without pushing, run `npm run install:local`.

## 2026-11-25: Bar percent setting, Every day work hours, Track from startup on by default (P82)

`6eaa43d`

**What**
- **Track from startup is on by default.** On a fresh install the loop starts by itself at launch, without pressing Start.
- New setting **Settings → Look → Bar percent**: `Of day` shows how much of today's work hours has passed (the workday %). `Of goal` shows today's productive time ÷ the daily goal (the goal %). Default: `Of goal`. The bar no longer chooses the percent from Track from startup.
- **Work hours** has a new **Every day** row at the top: one start–end that turns all 7 days on with those hours. It's empty and shows `days differ` until all 7 days match. 12 AM as the end means midnight.

**Why**
Under Track from startup the user still wants to see how much of their usual work hours (11 AM–12 AM every day) has passed and how much is left, without entering the same hours 7 times.

**If you pull this**
- An existing install that already **saved Track from startup off** keeps it off and gets `Bar percent = Of day`, so its bar looks the same. Every other install gets the new defaults (seeded at boot, `src/main/db/seedDefaults.ts`).
- Using Every day turns **weekends on**, so streak and day score count every day.
- New settings key `barPercent` (`'day' | 'goal'`). `EngineSettings` includes it.
- **Tests:** `launch()` in `tests/e2e/helpers.ts` now sets `SPYDER_DEFAULTS` to `{"trackFromStartup":false,"barPercent":"day"}`, so existing e2e tests keep the old first-run behaviour. To test the real defaults, pass `env: { SPYDER_DEFAULTS: '{}' }`. Unit tests use `trackFromStartup: false` through `engine.testkit.ts`.
- New debug env var `SPYDER_DEFAULTS` (JSON, only with `SPYDER_DEBUG=1`) sets first-run settings.

## 2026-11-24: Coherence pass, productive green, one colour per app (P80, P81)

`1ed1404` (PR #7)

**What**
- Productive time is the headline number: it leads every stat row. Today shows Productive · Work · Efficiency · Streak. Day score moved to Review, Week and Month.
- One word per idea: Work, Day score, Not accounted for, Apps & sites. The sidebar group is named "Day".
- Settings is regrouped into Work hours · Blocks & nudges · Goal · Look · Tracking · System. Block length is set only in the sidebar.
- KPIs are set up on Review (add, or Edit to rename or remove). The Rules page has no KPIs tab.
- Productive uses the goal-met green everywhere. Each app keeps one colour across the dashboard, its app-track colour.
- Removed the empty Estimate accuracy table and its planned-session code.

**Why**
Features added one by one had drifted apart in wording, colours and placement.

**If you pull this**
- Settings and KPI controls moved, so update any e2e test or doc that points to the old place.

## 2026-11-24: App track on the timeline, font choice, app colours (P77–P79)

`04fb2ce`

**What**
- P77: a second track under the blocks on the timeline shows which app or site was in front. It replaces the thin category strip.
- P78: **Settings → Font** switches every window between Segoe UI and Atkinson Hyperlegible Next.
- P79: each app gets a fixed automatic colour from its name. Any app's colour can be picked from the timeline legend or **Settings → App colours**.

**Why**
To see which apps a block was spent in, and to make the app more readable.

**If you pull this**
- New settings keys: `font` (`'system' | 'atkinson'`) and `appColors` (an app → `#rrggbb` map).

## 2026-11-24: Track from startup, sleep ends the loop (P76)

`63ae18f`

**What**
- New Settings switch, **Track from startup** (off at the time; P82 turned it on by default). While it's on, the loop starts by itself on launch and on wake and ignores work hours.
- Sleep cuts the block like a shutdown does. So does a minute without a heartbeat.
- The block running at midnight is cut at midnight.

**Why**
For a user who works whenever the computer is on rather than in fixed hours.

**If you pull this**
- New settings key `trackFromStartup`.

## 2026-11-24: Efficiency rating for work blocks (P75)

`7865a92` (PR #4), follow-ups `b9b6aa7`

**What**
- An optional 25/50/75/100% rating in the end-of-block prompt and on Today. Day and range efficiency and effective time show on Today, Review, Week and Month, and are included in exports.
- Unrated blocks count in neither total.
- Tagging a block Break, Gym or Food clears its rating.

**Why**
Time worked doesn't say how well it went. The user wanted a quick self-rating.

**If you pull this**
- **Migration 005** adds `sessions.efficiency`. It runs on first launch.
