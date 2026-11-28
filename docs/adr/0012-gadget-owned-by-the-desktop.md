# The gadget stays on the desktop by being owned by it, not by living inside it

**Status:** accepted (2026-11-28), after phase 1 of `docs/plans/p107-gadget.md` passed on the real desktop (see "What phase 1 showed").

P107's gadget must never cover an app and must stay visible on Show desktop (Win+D). Windows has no supported "desktop gadget" layer, so Spyder makes the gadget an **owned window of the desktop**. `UrlHelper.exe desktop <hwnd>` sets its owner to `Progman` (the desktop window, `GWLP_HWNDPARENT`) and puts it at the bottom of the z-order. Show desktop leaves windows the desktop owns alone, and Windows always keeps an owned window above its owner, so the gadget sits just above the wallpaper and its icons. Clicking it gives it focus but doesn't raise it above apps, because an owned window moves with its owner's place in the z-order. On `focus` and `blur` Spyder still sends it to the bottom with `UrlHelper.exe back`, in case Windows ever raises it anyway.

Every 30 s while it's shown, Spyder runs `desktop` again, which is cheap and does nothing if the owner is still right. If Explorer restarts, the gadget therefore goes back to the new desktop. Windows didn't destroy the window with its old owner in phase 1, but if it ever does, Spyder recreates it. If there's no `Progman` to own it, the gadget only goes to the bottom of the z-order, which is never on top either.

## What phase 1 showed (2026-11-28, Windows 11 build 26300, one display)
A throwaway frameless acrylic Electron window, 340 × 420 at the top right, owned with `UrlHelper.exe desktop`. "On top at a point" was checked with `WindowFromPoint` at that point, plus screen captures.
- `desktop` exited 0, and `GetWindow(GW_OWNER)` returned Progman.
- A maximised Notepad covered it.
- **Win+D:** the gadget stayed visible over the wallpaper. A second Win+D brought the apps back over it.
- Clicking it, then typing, delivered every key.
- Five times: Notepad partly overlapping it, click the gadget, then Notepad. Clicking the gadget focused it without raising it over Notepad, so it was over the app for 0 ms each time.
- The acrylic glass still draws while owned.
- **Explorer restart** (`taskkill /f /im explorer.exe`, then `explorer.exe`): the window survived and stayed visible, and its owner became none. The next `desktop` exited 2 while there was no Progman, then 0 once it re-owned the gadget to the new Progman. Win+D kept it showing afterwards.
- Two displays weren't available, so that case is unchecked.

## Considered options
- **Parent the window into the wallpaper layer** (`SetParent` to the `WorkerW` behind the icons, as wallpaper engines do). This is what the user first chose, and it was rejected on technical grounds. The icon list covers that layer, so clicks never reach the gadget. A child window in Explorer's tree shares Explorer's input queue, so a stalled Spyder can freeze the desktop. Chromium's transparent, layered windows don't draw reliably as cross-process children. The layer's layout also changed in Windows 11 24H2, and undocumented layouts can change again. Owning the window gives the same behaviour the user asked for (never over apps, survives Win+D) while it stays a normal top-level window: it can be typed into, it keeps the acrylic glass, and it can be resized.
- **Only the bottom of the z-order** (like the bar's minimize, P83). Rejected: Win+D hides it with everything else.

## Consequences
- The ownership is set from outside Electron, so Electron doesn't know about it. Nothing in Spyder may reparent or re-own the gadget window.
- The bar (always on top, P49) still shows over the gadget where they overlap, and takes the clicks there.
- Until the 30 s re-own runs after an Explorer restart, the gadget has no owner, and Win+D would hide it.
- "Lift while typing" (the grilling's fallback for an embedded window that can't take keys) isn't needed, and the glass isn't replaced by an opaque card.
- Without `resources/UrlHelper.exe` (`npm run build:helper`), the gadget is an ordinary window that's not on top.
