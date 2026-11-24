// Settings page (plan §5, §12; design/DESIGN.md §4 Settings). Every change applies live.
import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { appSlot } from '../../core/aggregate';
import { DEFAULT_SETTINGS, type Settings as S } from '../../core/settings';
import type { ScheduleRow, SettingsVM } from '../../preload/api';
import { Btn, inputCls } from '../ui/controls';
import { ExportButton } from './Export';
import { applyTagColors, Card, Segmented, Toggle, TopBar, useLoader } from './parts';

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export function Settings() {
  const [s, setS] = useState<SettingsVM | null>(null);
  useEffect(() => {
    void window.spyder.getSettings().then(setS);
  }, []);
  const set = async (p: Partial<S>) => {
    const next = await window.spyder.setSettings(p);
    applyTagColors(next);
    setS(next);
  };
  if (!s) return <TopBar title="Settings" />;
  return (
    <>
      <TopBar title="Settings" />
      <div className="flex-1 overflow-x-hidden overflow-y-auto p-6" data-testid="settings">
        {!s.hotkeyOk && (
          <div
            data-testid="hotkey-warning"
            className="mb-4 rounded-card border border-orange/40 bg-orange/10 px-4 py-3 text-[13px] text-orange"
          >
            The hotkey {s.hotkey} couldn’t be registered (another app is probably using it). Pick a different
            one below.
          </div>
        )}
        <div className="grid grid-cols-12 gap-4">
          <WorkHours className="col-span-7" />
          <div className="col-span-5 flex min-w-0 flex-col gap-4">
            <Card title="Goal">
              <Field label="Daily productive goal" hint="streaks count days that reach it">
                <NumberInput
                  testId="set-goalSec"
                  value={s.goalSec / 3600}
                  step={0.25}
                  min={0.25}
                  unit="h"
                  onCommit={(v) => void set({ goalSec: Math.round(v * 3600) })}
                />
              </Field>
            </Card>
            <Card title="Widget & hotkey">
              <Field label="Theme">
                <Segmented
                  testId="set-theme"
                  value={s.theme}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                  onChange={(v) => void set({ theme: v })}
                />
              </Field>
              <Field label="Font" hint="for the whole app (P78)">
                <Segmented
                  testId="set-font"
                  value={s.font}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'atkinson', label: 'Atkinson Hyperlegible' },
                  ]}
                  onChange={(v) => void set({ font: v })}
                />
              </Field>
              {(
                [
                  ['workColor', 'Work colour', 'for work blocks'],
                  ['gymColor', 'Gym colour', 'for gym blocks'],
                  ['foodColor', 'Food colour', 'for food blocks'],
                ] as const
              ).map(([key, label, hint]) => (
                <Field key={key} label={label} hint={hint}>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      data-testid={`set-${key}`}
                      aria-label={label}
                      value={s[key]}
                      onChange={(e) => void set({ [key]: e.target.value })}
                      className="h-8 w-10 cursor-pointer rounded-control border border-border bg-surface p-0.5"
                    />
                    {s[key] !== DEFAULT_SETTINGS[key] && (
                      <Btn size="sm" variant="ghost" data-testid={`reset-${key}`} onClick={() => void set({ [key]: DEFAULT_SETTINGS[key] })}>
                        Reset to default
                      </Btn>
                    )}
                  </div>
                </Field>
              ))}
              <Field label="Widget hotkey" hint="shows / hides the widget">
                <TextInput testId="set-hotkey" value={s.hotkey} onCommit={(v) => void set({ hotkey: v })} />
              </Field>
            </Card>
          </div>

          <Card title="Timers" className="col-span-7">
            <div className="grid grid-cols-2 gap-x-6">
              <Field label="Block length" hint="5–180 min, from the next block">
                <NumberInput
                  testId="set-blockLengthSec"
                  value={s.blockLengthSec / 60}
                  min={5}
                  unit="min"
                  onCommit={(v) => void set({ blockLengthSec: v * 60 })}
                />
              </Field>
              <Field label="Away after idle" hint="shown as a hint">
                <NumberInput
                  testId="set-idleThresholdSec"
                  value={s.idleThresholdSec / 60}
                  min={1}
                  unit="min"
                  onCommit={(v) => void set({ idleThresholdSec: v * 60 })}
                />
              </Field>
              <Field label="Nudge after">
                <NumberInput
                  testId="set-nudgeAfterSec"
                  value={s.nudgeAfterSec / 60}
                  min={0.5}
                  step={0.5}
                  unit="min"
                  onCommit={(v) => void set({ nudgeAfterSec: v * 60 })}
                />
              </Field>
              <Field label="Repeat nudge">
                <NumberInput
                  testId="set-nudgeRepeatSec"
                  value={s.nudgeRepeatSec / 60}
                  min={0.5}
                  step={0.5}
                  unit="min"
                  onCommit={(v) => void set({ nudgeRepeatSec: v * 60 })}
                />
              </Field>
              <Field label="Distraction reset">
                <NumberInput
                  testId="set-nudgeResetSec"
                  value={s.nudgeResetSec}
                  min={5}
                  unit="sec"
                  onCommit={(v) => void set({ nudgeResetSec: v })}
                />
              </Field>
              <Field label="Keep-working step">
                <NumberInput
                  testId="set-keepWorkingStepMin"
                  value={s.keepWorkingStepMin}
                  min={5}
                  unit="min"
                  onCommit={(v) => void set({ keepWorkingStepMin: v })}
                />
              </Field>
            </div>
          </Card>
          <div className="col-span-5 flex min-w-0 flex-col gap-4">
            <Card title="Tracking">
              <Field label="Sample the active window every">
                <NumberInput
                  testId="set-sampleIntervalSec"
                  value={s.sampleIntervalSec}
                  min={1}
                  unit="sec"
                  onCommit={(v) => void set({ sampleIntervalSec: v })}
                />
              </Field>
              <Field label="App & site percentages over">
                <Segmented
                  testId="set-appPercentScope"
                  value={s.appPercentScope}
                  options={[
                    { value: 'work_hours', label: 'Work hours' },
                    { value: 'all_day', label: 'All day' },
                  ]}
                  onChange={(v) => void set({ appPercentScope: v })}
                />
              </Field>
            </Card>
            <Card title="System">
              <Field label="Start Spyder when Windows starts" hint="takes effect in the installed app">
                <Toggle
                  testId="set-autostart"
                  label="Start with Windows"
                  on={s.autostart}
                  onChange={(v) => void set({ autostart: v })}
                />
              </Field>
              <Field label="Data folder" hint={s.dataDir}>
                <Btn onClick={() => void window.spyder.openDataFolder()}>Open folder</Btn>
              </Field>
              <Field label="Export to Excel / CSV">
                <ExportButton />
              </Field>
            </Card>
            <AppColors picked={s.appColors} onChange={(appColors) => void set({ appColors })} />
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border py-1.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {hint && (
          <div className="truncate text-[11px] text-faint" title={hint}>
            {hint}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** Commits on Enter or blur; shows the saved value again if the input is invalid. */
function NumberInput({
  value,
  onCommit,
  unit,
  min,
  step = 1,
  testId,
}: {
  value: number;
  onCommit: (v: number) => void;
  unit: string;
  min: number;
  step?: number;
  testId: string;
}) {
  const shown = String(Math.round(value * 100) / 100);
  const [text, setText] = useState(shown);
  const [prev, setPrev] = useState(shown);
  if (prev !== shown) {
    setPrev(shown);
    setText(shown);
  }
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v) || v < min) return setText(shown);
    if (v !== value) onCommit(v);
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        data-testid={testId}
        type="number"
        min={min}
        step={step}
        className={clsx(inputCls, 'h-8 w-[76px] text-right tabular')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="w-7 text-[12px] text-muted">{unit}</span>
    </div>
  );
}

/**
 * P79: colours picked for apps and sites (also picked from the timeline legend). A name must match the app or site as
 * the timeline shows it; colours may repeat.
 */
function AppColors({ picked, onChange, className }: { picked: Record<string, string>; onChange: (m: Record<string, string>) => void; className?: string }) {
  const [name, setName] = useState('');
  const auto = (key: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(`--color-app-${appSlot(key) + 1}`).trim() || '#808080';
  const add = () => {
    const key = name.trim();
    if (!key) return;
    onChange({ ...picked, [key]: picked[key] ?? auto(key) });
    setName('');
  };
  const rows = Object.keys(picked).sort((a, b) => a.localeCompare(b));
  return (
    <Card title="App colours" className={className}>
      <div className="mb-2 text-[11px] text-faint">Apps and sites you don’t colour keep an automatic colour. Click a swatch in the timeline legend to pick one there.</div>
      <div data-testid="app-colors">
        {rows.map((key) => (
          <div key={key} data-testid="app-color-row" className="flex min-h-10 items-center gap-2 border-b border-border py-1">
            <input
              type="color"
              aria-label={`Colour for ${key}`}
              value={picked[key]}
              onChange={(e) => onChange({ ...picked, [key]: e.target.value })}
              className="h-7 w-9 shrink-0 cursor-pointer rounded-control border border-border bg-surface p-0.5"
            />
            <span className="min-w-0 flex-1 truncate text-[13px]" title={key}>
              {key}
            </span>
            <Btn size="sm" variant="ghost" aria-label={`Reset ${key}`} onClick={() => onChange(Object.fromEntries(Object.entries(picked).filter(([k]) => k !== key)))}>
              Reset
            </Btn>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          data-testid="app-color-name"
          className={clsx(inputCls, 'h-8 min-w-0 flex-1')}
          placeholder="App or site, e.g. youtube.com"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Btn size="sm" data-testid="app-color-add" disabled={!name.trim()} onClick={add}>
          Add
        </Btn>
      </div>
    </Card>
  );
}

function TextInput({
  value,
  onCommit,
  testId,
}: {
  value: string;
  onCommit: (v: string) => void;
  testId: string;
}) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value);
  }
  return (
    <input
      data-testid={testId}
      className={clsx(inputCls, 'h-8 w-[170px]')}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text.trim() && text !== value ? onCommit(text) : setText(value))}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

// ---- work hours ---------------------------------------------------------------------------
function WorkHours({ className }: { className?: string }) {
  const [sch, reload] = useLoader(
    () => Promise.all([window.spyder.getSchedule(), window.spyder.getDay()]),
    'schedule',
  );
  if (!sch)
    return (
      <Card title="Work hours" className={className}>
        {null}
      </Card>
    );
  const [{ rows, overrides }, day] = sch;
  const today = day.today;
  const ov = overrides[today] ?? null;
  const todayRow = rows.find((r) => r.weekday === new Date(day.nowMs).getDay());
  const saveRow = async (r: ScheduleRow) => {
    await window.spyder.setSchedule([r]);
    await reload();
  };
  const saveOv = async (o: { enabled: boolean; startMin: number; endMin: number } | null) => {
    await window.spyder.setDayOverride(today, o);
    await reload();
  };
  return (
    <Card title="Work hours" className={className} right="the review opens when the day ends">
      {DAYS.map((wd) => {
        const r = rows.find((x) => x.weekday === wd);
        if (!r) return null;
        return (
          <div
            key={wd}
            data-testid={`sched-${wd}`}
            className="flex h-11 items-center gap-3 border-b border-border text-[13px]"
          >
            <Toggle
              testId={`sched-${wd}-enabled`}
              label={`${DAY_NAME[wd]} enabled`}
              on={r.enabled}
              onChange={(v) => void saveRow({ ...r, enabled: v })}
            />
            <span className={clsx('w-[100px]', !r.enabled && 'text-muted')}>{DAY_NAME[wd]}</span>
            <TimeRange
              r={r}
              disabled={!r.enabled}
              onSave={(startMin, endMin) => void saveRow({ ...r, startMin, endMin })}
              testId={`sched-${wd}`}
            />
          </div>
        );
      })}
      <div data-testid="override" className="flex h-12 items-center gap-3 pt-1 text-[13px]">
        <Toggle
          testId="override-enabled"
          label="Override today"
          on={ov !== null}
          onChange={(v) =>
            void saveOv(
              v
                ? { enabled: true, startMin: todayRow?.startMin ?? 600, endMin: todayRow?.endMin ?? 1020 }
                : null,
            )
          }
        />
        <span className="w-[100px]">Today only</span>
        {ov ? (
          <>
            <Segmented
              testId="override-mode"
              value={ov.enabled ? 'on' : 'off'}
              options={[
                { value: 'on', label: 'Working' },
                { value: 'off', label: 'Day off' },
              ]}
              onChange={(v) => void saveOv({ ...ov, enabled: v === 'on' })}
            />
            {ov.enabled && (
              <TimeRange
                r={ov}
                onSave={(startMin, endMin) => void saveOv({ ...ov, startMin, endMin })}
                testId="override"
              />
            )}
          </>
        ) : (
          <span className="text-muted">uses the weekly hours</span>
        )}
      </div>
    </Card>
  );
}

function TimeRange({
  r,
  disabled,
  onSave,
  testId,
}: {
  r: { startMin: number; endMin: number };
  disabled?: boolean;
  onSave: (s: number, e: number) => void;
  testId: string;
}) {
  const commit = (which: 'start' | 'end', v: string) => {
    const m = toMin(v);
    if (m === null) return;
    const s = which === 'start' ? m : r.startMin;
    const e = which === 'end' ? (m === 0 ? 1440 : m) : r.endMin;
    if (s < e && (s !== r.startMin || e !== r.endMin)) onSave(s, e);
  };
  const cls = clsx(inputCls, 'h-8 w-[132px] tabular disabled:text-faint');
  return (
    <span className="flex items-center gap-2">
      <input
        data-testid={`${testId}-start`}
        type="time"
        disabled={disabled}
        className={cls}
        defaultValue={hhmm(r.startMin)}
        key={`s${r.startMin}`}
        onBlur={(e) => commit('start', e.target.value)}
      />
      <span className="text-muted">–</span>
      <input
        data-testid={`${testId}-end`}
        type="time"
        disabled={disabled}
        className={cls}
        defaultValue={hhmm(r.endMin % 1440)}
        key={`e${r.endMin}`}
        onBlur={(e) => commit('end', e.target.value)}
      />
    </span>
  );
}
