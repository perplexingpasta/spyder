# The gadget stays on the desktop by being owned by it, not by living inside it

**Status:** proposed (2026-11-28). It becomes accepted once phase 1 of `docs/plans/p107-gadget.md` shows the gadget surviving Win+D and dropping below apps on the real desktop. If it fails, the fallback and the open question are in that phase.

P107's gadget must never cover an app and must stay visible on Show desktop (Win+D). Windows has no supported "desktop gadget" layer, so Spyder makes the gadget an **owned window of the desktop**. `UrlHelper.exe desktop <hwnd>` sets its owner to `Progman` (the desktop window, `GWLP_HWNDPARENT`) and puts it at the bottom of the z-order. Show desktop leaves windows the desktop owns alone, and Windows always keeps an owned window above its owner, so the gadget sits just above the wallpaper and its icons. When the user clicks it, Windows raises it. On `focus` and `blur` Spyder sends it back to the bottom with `UrlHelper.exe back`, so it never stays over an app.

Every 30 s while it's shown, Spyder runs `desktop` again, which is cheap and does nothing if the owner is still right. If Explorer restarts, the gadget therefore goes back to the new desktop. If Windows destroys the window with its old owner, Spyder recreates it. If there's no `Progman` to own it, the gadget only goes to the bottom of the z-order, which is never on top either.

## Considered options
- **Parent the window into the wallpaper layer** (`SetParent` to the `WorkerW` behind the icons, as wallpaper engines do). This is what the user first chose, and it was rejected on technical grounds. The icon list covers that layer, so clicks never reach the gadget. A child window in Explorer's tree shares Explorer's input queue, so a stalled Spyder can freeze the desktop. Chromium's transparent, layered windows don't draw reliably as cross-process children. The layer's layout also changed in Windows 11 24H2, and undocumented layouts can change again. Owning the window gives the same behaviour the user asked for (never over apps, survives Win+D) while it stays a normal top-level window: it can be typed into, it keeps the acrylic glass, and it can be resized.
- **Only the bottom of the z-order** (like the bar's minimize, P83). Rejected: Win+D hides it with everything else.

## Consequences
- The ownership is set from outside Electron, so Electron doesn't know about it. Nothing in Spyder may reparent or re-own the gadget window.
- "Lift while typing" (the grilling's fallback for an embedded window that can't take keys) isn't needed, and the glass isn't replaced by an opaque card.
- Without `resources/UrlHelper.exe` (`npm run build:helper`), the gadget is an ordinary window that's not on top.
