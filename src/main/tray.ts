import { Menu, Tray, nativeImage, app } from 'electron';
import { join } from 'node:path';
import type { AppCtx } from './context';
import { resourcesDir } from './paths';
import { openDashboard, showGadget, showWidget } from './windows';

export interface TrayHandlers {
  toggleLoop: () => void;
  loopLabel: () => string;
}

let menuLabels: string[] = [];
/** e2e: the current menu's items by label, so a test can click one. */
let menuClicks = new Map<string, () => void>();

export function createTray(ctx: AppCtx, h: TrayHandlers): Tray {
  const img = nativeImage.createFromPath(join(resourcesDir(), 'icon.png')).resize({ width: 16, height: 16 });
  const tray = new Tray(img);
  tray.setToolTip('Spyder');
  const rebuild = () => {
    const template = [
      { label: 'Show widget', click: () => showWidget(ctx) },
      ...(ctx.settings.gadget ? [{ label: "Show How I'll improve", click: () => showGadget(ctx) }] : []), // P107
      { label: 'Open dashboard', click: () => openDashboard(ctx) },
      { type: 'separator' as const },
      { label: h.loopLabel(), click: h.toggleLoop },
      { type: 'separator' as const },
      { label: 'Quit', click: () => app.quit() },
    ];
    menuLabels = template.flatMap((t) => ('label' in t && t.label ? [t.label] : []));
    menuClicks = new Map(template.flatMap((t) => ('click' in t && t.label ? [[t.label, t.click] as const] : [])));
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };
  rebuild();
  tray.on('click', () => showWidget(ctx));
  tray.on('right-click', rebuild);
  return tray;
}

let lastTooltip = 'Spyder';
export function setTrayTooltip(ctx: AppCtx, text: string): void {
  if (text === lastTooltip || !ctx.tray) return;
  lastTooltip = text;
  ctx.tray.setToolTip(text);
}

/** e2e: rebuilds the menu as a right-click does, then clicks the item with this label. */
/** P107: the menu follows the gadget setting at once (a right-click rebuilds it anyway). */
export function refreshTrayMenu(ctx: AppCtx): void {
  ctx.tray?.emit('right-click');
}

export function trayClick(ctx: AppCtx, label: string): boolean {
  ctx.tray?.emit('right-click');
  const fn = menuClicks.get(label);
  fn?.();
  return !!fn;
}

export function trayInfo(ctx: AppCtx): { exists: boolean; tooltip: string; menu: string[] } {
  return { exists: !!ctx.tray && !ctx.tray.isDestroyed(), tooltip: lastTooltip, menu: menuLabels };
}
