import type { BrowserWindow, Tray } from 'electron';
import type { Clock } from '../core/clock';
import type { Settings } from '../core/settings';
import type { Db } from './db/db';

/** Process-wide singletons shared by main-process modules. */
export interface AppCtx {
  dataDir: string;
  db: Db;
  clock: Clock;
  settings: Settings;
  debug: boolean;
  quitting: boolean;
  widget: BrowserWindow | null;
  dashboard: BrowserWindow | null;
  prompt: BrowserWindow | null;
  /** P107: the How I'll improve gadget; created the first time it's shown. */
  gadget: BrowserWindow | null;
  tray: Tray | null;
  hotkeyOk: boolean;
}
