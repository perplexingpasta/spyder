// The renderer-facing API exposed on window.spyder (plan §11). Grows phase by phase.
import type { WidgetVM } from '../core/blockEngine';
import type { PromptVM } from '../core/promptView';
import type { Settings } from '../core/settings';
import type { Category, MatchType } from '../core/defaults';
import type { Efficiency, EngineError, Tag } from '../core/types';
import type { DayVM, Kpi, ReviewItem, ReviewVM } from '../core/review';
import type { AppRow } from '../core/aggregate';
import type { AskRow } from '../core/asks';
import type { ScheduleRow } from '../core/settings';
import type { PatternMatch } from '../core/defaults';
import type { RangeVM } from '../core/trends';
import type { GadgetRow, ImportDay, LabelColor } from '../core/gadget';

export type { AppRow, AskRow, DayVM, GadgetRow, ImportDay, Kpi, LabelColor, RangeVM, ReviewItem, ReviewVM, ScheduleRow };

/** P107: the gadget's rows in the order it shows them, and today (its date labels show the year only when it isn't today's). */
export interface GadgetPayload {
  rows: GadgetRow[];
  today: string;
}

/** P107: a change to one gadget row; an empty text removes it, `removed: false` is the Undo. */
export interface GadgetRowPatch {
  text?: string;
  ticked?: boolean;
  color?: LabelColor | null;
  removed?: boolean;
}

export interface RuleVM {
  id: string;
  matchType: MatchType;
  pattern: string;
  category: Category;
  isDefault: boolean;
}

export interface TitlePatternVM {
  id: string;
  match: PatternMatch;
  pattern: string;
  domain: string;
  isDefault: boolean;
}

export interface OverrideVM {
  date: string;
  enabled: boolean;
  startMin: number;
  endMin: number;
}

export type SettingsVM = Settings & { hotkeyOk: boolean; dataDir: string; today: string };

export type ExportResult = { ok: true; xlsxPath: string; csvDir: string } | { canceled: true } | { error: 'range' };

export interface WidgetPayload extends WidgetVM {
  distractTarget: string | null;
  distractSec: number;
}

export type PromptWindowState = PromptVM | null;

/**
 * One block's answer (P60, P66, P75): free text, or null for none (breaks only); `tag` and `efficiency` left out keep
 * the block's own. Only a work block can be rated.
 */
export interface BlockAnswer {
  id: string;
  answer: string | null;
  tag?: Tag;
  efficiency?: Efficiency | null;
}

export type Ok = { ok: true };
/** A delete, merge or tag change (P64, P66): `undoId` undoes it while it's the latest edit. */
export type EditResult = { ok: true; undoId: string; message: string } | EngineError;

export interface DebugApi {
  state(): Promise<Record<string, unknown>>;
  setNow(ms: number): Promise<void>;
  advance(sec: number): Promise<void>;
  setScale(scale: number): Promise<void>;
  tick(): Promise<void>;
  simulateIdle(lastInputMs: number | null): Promise<void>;
  simulateSuspend(): Promise<void>;
  simulateResume(): Promise<void>;
  simulateLock(): Promise<void>;
  simulateUnlock(): Promise<void>;
  injectActivity(sample: {
    exe: string;
    appName?: string;
    domain: string | null;
    title: string | null;
    browser: 'chrome' | 'firefox' | 'edge' | null;
  }): Promise<string>;
  trayInfo(): Promise<{ exists: boolean; tooltip: string; menu: string[] }>;
  /** Clicks the tray menu item with this label; false when there's none. */
  trayClick(label: string): Promise<boolean>;
  flush(): Promise<void>;
  killProbe(): Promise<void>;
  triggerHotkey(): Promise<void>;
  /** P102: as if capture had seen `exe` running from `path`. */
  rememberAppPath(exe: string, path: string): Promise<void>;
}

export interface SpyderApi {
  getSettings(): Promise<SettingsVM>;
  setSettings(partial: Partial<Settings>): Promise<SettingsVM>;

  getWidget(): Promise<WidgetPayload>;
  onWidget(cb: (w: WidgetPayload) => void): () => void;
  /** P59: starts the loop with this block length (seconds). */
  start(lengthSec: number): Promise<Ok | EngineError>;
  stop(): Promise<Ok | EngineError>;
  /** P59: remembered, and used from the next block. */
  setBlockLength(lengthSec: number): Promise<Ok | EngineError>;
  dismissReminder(): Promise<Ok | EngineError>;
  keepWorking(): Promise<Ok | EngineError>;
  /** P60, P64: answer ended blocks (also re-answer). */
  answerBlocks(answers: BlockAnswer[]): Promise<Ok | EngineError>;
  deleteBlocks(ids: string[]): Promise<EditResult>;
  /** P64, P73: neighbouring blocks of one tag become one block with `answer` (null = none, breaks only). */
  mergeBlocks(ids: string[], answer: string | null): Promise<EditResult>;
  /** P73: every run of neighbouring blocks with the same tag and answer on `date` becomes one block (one Undo). */
  mergeRepeats(date: string): Promise<EditResult>;
  /** P86: splits a merged block back into the blocks its latest merge combined, as they were before it. */
  unmergeBlock(id: string): Promise<EditResult>;
  /** P95: untracked time in [startMs, endMs) becomes one ended block with this answer and tag. */
  fillUntracked(startMs: number, endMs: number, answer: string | null, tag: Tag): Promise<EditResult>;
  /** P66, P74: set the blocks' tag (Work, Break, Gym or Food); answers stay. */
  tagBlocks(ids: string[], tag: Tag): Promise<EditResult>;
  /** P75: rate work blocks 25, 50, 75 or 100% efficient, or clear the rating (null). */
  rateBlocks(ids: string[], efficiency: Efficiency | null): Promise<EditResult>;
  undoEdit(undoId: string): Promise<Ok | EngineError>;

  answerSuggestions(prefix: string): Promise<string[]>;
  getPrompt(): Promise<PromptWindowState>;
  /** P98: the midnight card: the lists replace the day's wins and improvements; null = Skip. */
  saveReflection(date: string, lists: { win: string[]; improve: string[] } | null): Promise<Ok | EngineError>;
  onPrompt(cb: (p: PromptWindowState) => void): () => void;

  getDay(date?: string): Promise<DayVM>;
  getRange(from: string, to: string): Promise<RangeVM>;
  /** P70: every app and site still waiting for the user's own label, all time. */
  listToAsk(): Promise<AskRow[]>;
  /** P102: each app's own icon (PNG data URL) by exe; exes whose program file isn't known are left out. */
  appIcons(exes: string[]): Promise<Record<string, string>>;
  listRules(): Promise<RuleVM[]>;
  saveRule(r: { id?: string; matchType: MatchType; pattern: string; category: Category }): Promise<void>;
  deleteRule(id: string): Promise<void>;
  listTitlePatterns(): Promise<TitlePatternVM[]>;
  saveTitlePattern(p: { id?: string; match: PatternMatch; pattern: string; domain: string }): Promise<void>;
  deleteTitlePattern(id: string): Promise<void>;

  getSchedule(): Promise<{ rows: ScheduleRow[]; overrides: Record<string, OverrideVM> }>;
  setSchedule(rows: ScheduleRow[]): Promise<void>;
  setDayOverride(date: string, o: Omit<OverrideVM, 'date'> | null): Promise<void>;
  openDataFolder(): Promise<string>;
  /** Opens a save dialog; `xlsxPath` / `csvDir` are honoured only in debug builds (e2e). */
  exportData(o: { from: string; to: string; xlsxPath?: string; csvDir?: string }): Promise<ExportResult>;
  showInFolder(path: string): Promise<void>;

  getReview(date?: string): Promise<ReviewVM>;
  saveReviewItem(it: Omit<ReviewItem, 'id'> & { id?: string }): Promise<ReviewItem>;
  deleteReviewItem(id: string): Promise<void>;
  completeReview(date: string): Promise<Ok | { error: 'leftovers'; count: number }>;
  listKpis(): Promise<Kpi[]>;
  saveKpi(k: { id?: string; name: string; unit?: string | null; archived?: boolean }): Promise<Kpi>;
  setKpiValue(date: string, kpiId: string, value: number | null): Promise<void>;

  /** P107: the How I'll improve gadget. */
  getGadget(): Promise<GadgetPayload>;
  onGadget(cb: (g: GadgetPayload) => void): () => void;
  /** A row written on the gadget, dated today; null when the text is empty. */
  addGadgetRow(text: string): Promise<GadgetRow | null>;
  editGadgetRow(id: string, patch: GadgetRowPatch): Promise<void>;
  /** Removes every ticked row; returns their ids. */
  clearTicked(): Promise<string[]>;
  gadgetImportList(): Promise<ImportDay[]>;
  /** Adds the picked improvements not on the gadget now; returns how many. */
  importGadgetRows(items: { date: string; text: string; sort: number }[]): Promise<number>;
  minimizeGadget(): Promise<void>;

  hideWidget(): Promise<void>;
  minimizeWidget(): Promise<void>;
  showWidget(): Promise<void>;
  openDashboard(route?: string): Promise<void>;
  resizePrompt(height: number): Promise<void>;
  debug?: DebugApi;
}

declare global {
  interface Window {
    spyder: SpyderApi;
  }
}
