// Settings keys and defaults (plan §5, P57, P59).
export interface Settings {
  goalSec: number;
  idleThresholdSec: number;
  /** P59: the block length the loop uses, 5 min to 3 h. */
  blockLengthSec: number;
  nudgeAfterSec: number;
  nudgeRepeatSec: number;
  nudgeResetSec: number;
  hotkey: string;
  autostart: boolean;
  sampleIntervalSec: number;
  appPercentScope: 'work_hours' | 'all_day';
  keepWorkingStepMin: number;
  widgetPos: { x: number; y: number } | null;
  theme: 'system' | 'light' | 'dark';
  /** P67: the colour of work blocks, #rrggbb. */
  workColor: string;
  /** P74: the colours of gym and food blocks, #rrggbb. */
  gymColor: string;
  foodColor: string;
  /** P105: the colour of sleep blocks, #rrggbb. */
  sleepColor: string;
  /** P76: the loop runs from launch or wake until shutdown or sleep, whatever the work hours (on by default, P82). */
  trackFromStartup: boolean;
  /** P82: the bar's percent cell shows the workday % or the goal %. */
  barPercent: 'day' | 'goal';
  /** P78: the font of every window. */
  font: 'system' | 'atkinson';
  /** P79: colours the user picked for apps and sites (app key → #rrggbb); the rest keep their automatic colour. */
  appColors: Record<string, string>;
  /** P85: Today's timeline shows the app track (P77) and its legend. */
  showAppTrack: boolean;
  /** P90: how strongly the dashboard's glass is tinted, 0 (clear glass) to 100 (solid) percent. */
  glassTint: number;
  /** P93: the accent colour of every window, #rrggbb; null = Spyder purple (per theme). */
  accentColor: string | null;
  /** P98: after a day ends, the prompt asks for its wins and how I'll improve. */
  askReflection: boolean;
  /** P105: which part of a stretch asleep or off becomes blocks: work hours only (P95) or the whole day. */
  asleepScope: 'work_hours' | 'all_day';
}

export const DEFAULT_SETTINGS: Settings = {
  goalSec: 18000,
  idleThresholdSec: 300,
  blockLengthSec: 900,
  nudgeAfterSec: 300,
  nudgeRepeatSec: 300,
  nudgeResetSec: 60,
  hotkey: 'Control+Alt+S',
  autostart: true,
  sampleIntervalSec: 2,
  appPercentScope: 'work_hours',
  keepWorkingStepMin: 30,
  widgetPos: null,
  theme: 'system',
  workColor: '#3fb27f',
  gymColor: '#e8853d',
  foodColor: '#d9669b',
  sleepColor: '#6c71c4',
  trackFromStartup: true,
  barPercent: 'goal',
  font: 'system',
  appColors: {},
  showAppTrack: true,
  glassTint: 55,
  accentColor: null,
  askReflection: true,
  asleepScope: 'work_hours',
};

export interface ScheduleRow {
  weekday: number; // 0 = Sunday (JS getDay)
  enabled: boolean;
  startMin: number;
  endMin: number;
}

export const DEFAULT_SCHEDULE: ScheduleRow[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  enabled: weekday >= 1 && weekday <= 5,
  startMin: 600,
  endMin: 1020,
}));

/** Lower bounds for the numeric settings (seconds unless named otherwise). */
const MIN: Partial<Record<keyof Settings, number>> = {
  goalSec: 60,
  idleThresholdSec: 60,
  blockLengthSec: 300,
  nudgeAfterSec: 30,
  nudgeRepeatSec: 30,
  nudgeResetSec: 5,
  sampleIntervalSec: 1,
  keepWorkingStepMin: 5,
  glassTint: 0,
};

/** Upper bounds (P59: blocks from 5 min to 3 h; P90: the glass tint is a percent). */
const MAX: Partial<Record<keyof Settings, number>> = {
  blockLengthSec: 10_800,
  glassTint: 100,
};

const ENUMS: Partial<Record<keyof Settings, readonly unknown[]>> = {
  appPercentScope: ['work_hours', 'all_day'],
  theme: ['system', 'light', 'dark'],
  font: ['system', 'atkinson'],
  barPercent: ['day', 'goal'],
  asleepScope: ['work_hours', 'all_day'],
};

/** Drops unknown keys and invalid values from a settings change; numbers are clamped to their range. */
export function cleanSettings(partial: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const key = k as keyof Settings;
    const def = DEFAULT_SETTINGS[key];
    if (key in MIN) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(MAX[key] ?? Infinity, Math.max(MIN[key]!, Math.round(v)));
    } else if (key in ENUMS) {
      if (ENUMS[key]!.includes(v)) out[k] = v;
    } else if (key === 'widgetPos') {
      if (v === null || (typeof v === 'object' && typeof (v as { x: unknown }).x === 'number' && typeof (v as { y: unknown }).y === 'number')) out[k] = v;
    } else if (key === 'workColor' || key === 'gymColor' || key === 'foodColor' || key === 'sleepColor') {
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v.toLowerCase();
    } else if (key === 'accentColor') {
      if (v === null) out[k] = null;
      else if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v.toLowerCase();
    } else if (key === 'appColors') {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        out[k] = Object.fromEntries(
          Object.entries(v).filter(([app, c]) => app.trim() && typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).map(([app, c]) => [app, (c as string).toLowerCase()]),
        );
      }
    } else if (key === 'hotkey') {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    } else if (typeof v === typeof def) out[k] = v;
  }
  return out as Partial<Settings>;
}

/**
 * P93: the CSS that puts a picked accent colour on a window, or null to keep Spyder purple. Hover is a step lighter
 * in dark and darker in light; text on the accent is dark or white by the colour's lightness.
 */
export function accentCss(color: string | null): string | null {
  const m = color ? /^#(..)(..)(..)$/.exec(color) : null;
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111114' : '#ffffff';
  return (
    `:root:root { --color-accent: ${color}; --color-accent-hover: color-mix(in srgb, ${color} 88%, white); --color-on-accent: ${ink}; }\n` +
    `@media (prefers-color-scheme: light) { :root:root { --color-accent-hover: color-mix(in srgb, ${color} 88%, black); } }`
  );
}
