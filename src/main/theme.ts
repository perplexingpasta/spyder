// Light / Dark / System (P57). nativeTheme.themeSource drives `prefers-color-scheme` in every window,
// so the renderer's CSS tokens follow it live; only native window backgrounds need setting here.
import { nativeTheme, type BrowserWindow, type WebContents } from 'electron';
import type { AppCtx } from './context';

/** Matches --color-bg in src/renderer/styles.css, so a window never flashes the other theme while loading. */
export const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#0E0E10' : '#FFFFFF');

export function applyTheme(ctx: AppCtx): void {
  nativeTheme.themeSource = ctx.settings.theme;
  const d = ctx.dashboard;
  if (d && !d.isDestroyed()) d.setBackgroundColor(windowBackground());
}

/** P78: the font stack per setting; Segoe UI stays the fallback if the chosen font isn't installed. */
const FONT: Record<AppCtx['settings']['font'], string | null> = {
  system: null,
  atkinson: "'Atkinson Hyperlegible Next VF', 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
};
const fontCss = new WeakMap<WebContents, string>();

/** Puts the chosen font on one window (P78); runs again after every load, since a load drops inserted CSS. */
export async function applyFontTo(ctx: AppCtx, win: BrowserWindow | null): Promise<void> {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  const old = fontCss.get(wc);
  if (old) {
    fontCss.delete(wc);
    await wc.removeInsertedCSS(old).catch(() => undefined);
  }
  const stack = FONT[ctx.settings.font];
  if (stack) fontCss.set(wc, await wc.insertCSS(`:root { --font-sans: ${stack}; }`));
}

export function applyFont(ctx: AppCtx): void {
  for (const w of [ctx.widget, ctx.prompt, ctx.dashboard]) void applyFontTo(ctx, w);
}
