# AGENTS.md

Spyder is a personal Windows app (Electron + React + TypeScript) that runs back-to-back blocks (15 min by default) from Start and asks what each one was spent on (ADR-0011). All 8 build phases are done; work since then is tracked as product decisions (P43 onward). P58–P65 replaced sessions with blocks.

## Sources of truth

Each one owns its own subject. Update the owner, and point to it from elsewhere.

- **`CONTEXT.md`**: the glossary. Use its terms exactly in code, UI copy and commits. Read it first.
- **`docs/product-decisions.md`**: every settled behavior decision (P1…), with the reasons. Read it before changing behavior. Ask the user about anything it doesn't cover, then record the answer as the next P number.
- **`docs/adr/`**: architectural decisions. Read the relevant ADR before touching storage, capture, the stack or the engine's shape. Record new hard-to-reverse choices as the next ADR.
- **`SPYDER_PLAN.md`**: the original spec. Use it for nudge (§8), capture (§9), aggregation (§10), IPC (§11) and UI behavior (§12), and its progress log (§14) for what was verified and how. A later P decision overrides the plan. Its session engine (§7, E1–E19) is history: the block engine follows P58–P65 and ADR-0011.
- **`design/DESIGN.md`**: visual spec (tokens, widget anatomy, pages). Follow it for any UI change.

## Code map

- `src/core/`: **pure** logic. The block engine (`blockEngine.ts`) is a reducer `reduce(state, event, ctx) → { state, effects }`. It also holds schedule, nudge, categorize, title patterns, aggregation, streaks, trends, CSV, and the view models (`widgetView`, `promptView`). Unit-tested with Vitest next to each file.
- `src/main/`: the Electron main process. `engineHost.ts` owns engine state, runs the tick and carries out effects. `idle.ts` turns powerMonitor into away events. `capture/` + `tracker.ts` sample the foreground app every 2 s. `db/` is `node:sqlite`, `report.ts` builds the dashboard data, `export.ts` writes xlsx/CSV, and `debug.ts` holds the test hooks.
- `src/preload/`: `window.spyder`, the only bridge from renderer to main (`api.d.ts` is the contract).
- `src/renderer/`: one bundle, routed by URL hash: `#/widget`, `#/prompt`, `#/gadget`, `#/dashboard/<page>/<date?>`.
- `src/native/UrlHelper.cs`: reads Chrome's address bar over UI Automation (ADR-0008), plus one-shot window modes: `focus` (P71), `back` (P83) and `desktop` (P107, ADR-0012).
- `tests/e2e/`: Playwright against the built Electron app. `helpers.ts` `launch()` gives you a fresh data dir, a fake clock and the debug API.

## Invariants

- `src/core/` imports nothing from Electron, `node:fs` or `node:sqlite`, and gets time only from `ctx.now` (ADR-0006, enforced by ESLint).
- Activity rows store raw facts; categories and Firefox sites are computed at read time (ADR-0005, P39).
- A block is a row in `sessions` and its time is the sum of its segments. `kind` holds its tag (`open` = Work, `break` = Break, P66); Gym and Food are breaks named by the `tag` column (`gym` / `food`, NULL otherwise, P74). A work block's `name` NULL = not accounted for yet; a break's `name` is never NULL (`'Break'` = no answer of its own). The tables keep their old names (ADR-0011).
- Prompt wording comes from `src/core/promptView.ts`, which follows P59 and P60 exactly.
- No AI or LLM features of any kind (ADR-0009).
- Windows stay sandboxed with context isolation, and pages can't open pop-ups or navigate away (`main.ts`). Register IPC handlers through `h` in `ipc.ts`, which refuses calls from any page that isn't Spyder's, never with a bare `ipcMain.handle` (`SECURITY.md`, `tests/e2e/security.spec.ts`).
- TypeScript strict. Any `any` carries a `// reason:` comment.

## Verify

Every change ends **green** on:

```
npm run typecheck
npm run lint
npm test            # Vitest, src/core
npm run test:e2e    # builds, then Playwright (~minutes, one worker)
```

For UI changes, open the PNGs the e2e tests save in `tests/e2e/__shots__/` with the Read tool and compare them with `design/DESIGN.md`. Fix what looks wrong before calling it done. Add or extend a test for every behavior change, and keep existing tests as they are. If one seems wrong, ask the user.

Time-dependent behavior is tested by controlling the clock, not by waiting:
- `SPYDER_NOW` (fixed start, ISO local time)
- `SPYDER_CLOCK_SCALE` (e.g. `600`)
- `SPYDER_DATA_DIR` (throwaway DB)
- `SPYDER_DEBUG=1` (exposes `window.spyder.debug`: `advance`, `setNow`, `simulateIdle`, `simulateSuspend`, `injectActivity`, …)

The e2e helper also sets `SPYDER_CAPTURE=0` and `SPYDER_FAKE_IDLE=1`, so the real desktop can't disturb tests. It sets `SPYDER_QUIET=1` too, so tests can't disturb the desktop: windows are invisible and click-through, never take focus, and system toasts are skipped (still counted). Focus handover (P71) therefore goes untested; set `SPYDER_E2E_SHOW=1` to watch a run with real windows. It also sets `SPYDER_DEFAULTS` (JSON first-run settings, debug only) to Track from startup off, the bar on the workday % and the midnight card (P98) off, so specs start from the work-hours loop; pass `env: { SPYDER_DEFAULTS: '{}' }` to get the real defaults (P82).

## Gotchas

- `npm run dev` with no `SPYDER_DATA_DIR` uses the **real** database in `%APPDATA%\Spyder`. So do `npm run seed` and `npm run db:dump`, which means seeding without it writes fake days into the user's real data. Set `SPYDER_DATA_DIR` to a temp dir before experimenting or seeding.
- Every successful push of `main` rebuilds and reinstalls the local app in the background (`.githooks/pre-push` → `scripts/install-local.ps1`, about 3 min; log in `release/install-local.log`). Commits alone don't. Git has no post-push hook, so the hook waits for the remote-tracking `main` to reach the pushed commit, and a refused or up-to-date push installs nothing. It only runs when the checkout is the commit being pushed. It stops the running Spyder, installs silently and restarts it. A fresh clone needs `git config core.hooksPath .githooks` to turn this on.
- One instance per data dir. A second launch against the same dir exits silently.
- `resources/UrlHelper.exe` is gitignored. Run `npm run build:helper` before testing Chrome site capture or `npm run dist`.
- Run `scripts/capture-check.ts` from PowerShell. The Store version of Notepad won't launch from Git Bash.
- The gadget (P107, `#/gadget`) is not a widget. It's a desktop window that `UrlHelper.exe desktop` hands to Progman, so it's never above an app and survives Win+D (ADR-0012). e2e (QUIET) skips that step, so check window behaviour on the real desktop.
- The bar is the only widget (P50). Start, Stop and the block length are in the dashboard sidebar; e2e tests start the loop from there (`startFromSidebar` in `widget.spec.ts`) or from the start reminder.
- The e2e clock can't be frozen: at scale 1 it runs in real time, so a block started "at 11:00" starts a few hundred ms later. Assert block times relative to `loop.block.startedMs`, not exact clock times.
- Playwright's Electron launcher forces a light `prefers-color-scheme` unless `colorScheme: null` is passed (`exeLaunch` in `tests/e2e/helpers.ts` does). Without it the app's theme (P57) can't be tested and every screenshot renders light.
- After 3 failed attempts at the same problem, stop and ask the user, with the exact error and what you tried.

## Commits

Commit only when the user asks. Other people and their agents pull `main`, so they need to understand each commit without opening its diff.

- **Subject:** conventional style, citing the decision it implements, e.g. `feat: bar label wraps to two lines (P47)`.
- **Body (always):** three short sections:
  - `What:` the change as the user sees it. One bullet per change, using `CONTEXT.md` terms.
  - `Why:` the reason, in a sentence or two. The P decision has the full reasoning.
  - `If you pull this:` anything that behaves differently for someone who pulls: changed defaults, migrations, new or renamed settings keys, changed test helpers or env vars, new setup steps. Write `nothing special` if there's none.
- **`CHANGELOG.md`:** add an entry with the same three sections at the top, in the same commit. Fill in the commit hash in the next commit, or leave it out.
- Before pulling or starting work, read the `CHANGELOG.md` entries newer than your last pull.
