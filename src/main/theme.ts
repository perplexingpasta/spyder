// Light / Dark / System (P57). nativeTheme.themeSource drives `prefers-color-scheme` in every window,
// so the renderer's CSS tokens follow it live; only native window backgrounds need setting here.
import { nativeTheme, type BrowserWindow, type WebContents } from 'electron';
import { accentCss } from '../core/settings';
import type { AppCtx } from './context';

/** The dashboard's window buttons sit on the glass, so their symbols follow the theme. */
export const titleBarOverlay = () => ({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ECECEF' : '#18181B', height: 36 });

export function applyTheme(ctx: AppCtx): void {
  nativeTheme.themeSource = ctx.settings.theme;
  const d = ctx.dashboard;
  if (d && !d.isDestroyed()) d.setTitleBarOverlay(titleBarOverlay());
}

/** P78: the font stack per setting; Segoe UI stays the fallback if the chosen font isn't installed. */
const FONT: Record<AppCtx['settings']['font'], string | null> = {
  system: null,
  atkinson: "'Atkinson Hyperlegible Next VF', 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
};
const styleCss = new WeakMap<WebContents, string>();

/**
 * Puts the chosen font (P78) and accent colour (P93) on one window; runs again after every load, since a load drops
 * inserted CSS.
 */
export async function applyStyleTo(ctx: AppCtx, win: BrowserWindow | null): Promise<void> {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  const old = styleCss.get(wc);
  if (old) {
    styleCss.delete(wc);
    await wc.removeInsertedCSS(old).catch(() => undefined);
  }
  const stack = FONT[ctx.settings.font];
  const css = [stack && `:root { --font-sans: ${stack}; }`, accentCss(ctx.settings.accentColor)].filter(Boolean).join('\n');
  if (css) styleCss.set(wc, await wc.insertCSS(css));
}

export function applyStyle(ctx: AppCtx): void {
  for (const w of [ctx.widget, ctx.prompt, ctx.dashboard, ctx.gadget]) void applyStyleTo(ctx, w);
}
