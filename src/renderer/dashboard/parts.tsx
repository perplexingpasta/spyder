// Dashboard building blocks (design/DESIGN.md §4).
import clsx from 'clsx';
import { format } from 'date-fns';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActivityCategory } from '../../core/categorize';
import type { Category } from '../../core/defaults';
import { Btn } from '../ui/controls';
import { addDays, dateKey, dayStartFromKey } from '../../core/schedule';
import { addMonths, weekDates } from '../../core/trends';

export type Period = 'day' | 'week' | 'month';

const stepDate = (date: string, unit: Period, n: number) =>
  unit === 'month' ? addMonths(date, n) : dateKey(addDays(dayStartFromKey(date), unit === 'week' ? 7 * n : n));

function periodLabel(date: string, unit: Period): string {
  const d = dayStartFromKey(date);
  if (unit === 'month') return format(d, 'MMMM yyyy');
  if (unit === 'week') {
    const w = weekDates(date);
    return `${format(dayStartFromKey(w[0]), 'MMM d')} – ${format(dayStartFromKey(w[6]), 'MMM d yyyy')}`;
  }
  return format(d, 'EEE, MMM d yyyy');
}

/** First day of the period containing `date` (for "is the next period in the future?"). */
const periodStart = (date: string, unit: Period) =>
  unit === 'month' ? `${date.slice(0, 7)}-01` : unit === 'week' ? weekDates(date)[0] : date;

export const CAT_COLOR: Record<ActivityCategory, string> = {
  productive: 'var(--color-productive)',
  neutral: 'var(--color-neutral)',
  distracting: 'var(--color-distracting)',
  uncategorized: 'var(--color-uncategorized)',
};
export const CAT_LABEL: Record<ActivityCategory, string> = {
  productive: 'Productive',
  neutral: 'Neutral',
  distracting: 'Distracting',
  uncategorized: 'Uncategorized',
};

/**
 * P70: one click gives an app or site the user's own label. The label it has now (a default's)
 * is outlined, so confirming it is the same click.
 */
export function CategoryButtons({ current, onPick, size }: { current: ActivityCategory; onPick: (c: Category) => void; size?: 'sm' }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      {(['productive', 'neutral', 'distracting'] as const).map((c) => (
        <Btn key={c} size={size} data-category={c} aria-pressed={c === current} variant={c === current ? 'outline' : 'secondary'} onClick={() => onPick(c)}>
          <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[c] }} />
          {CAT_LABEL[c]}
        </Btn>
      ))}
    </div>
  );
}

/**
 * Loads data, reloads when `key` changes, every 15 s while `live`, and when the window regains
 * focus. Returns the latest value and a manual reload.
 */
/** P67: the user's work colour, used by every work block in the dashboard. */
/** P67, P74, P105: the user's tag colours from Settings. */
export function applyTagColors(s: { workColor: string; gymColor: string; foodColor: string; sleepColor: string }): void {
  const root = document.documentElement.style;
  root.setProperty('--color-work', s.workColor);
  root.setProperty('--color-gym', s.gymColor);
  root.setProperty('--color-food', s.foodColor);
  root.setProperty('--color-sleep', s.sleepColor);
}

/** P90: how strongly the dashboard's glass is tinted, from Settings. */
export function applyGlassTint(s: { glassTint: number }): void {
  document.documentElement.style.setProperty('--glass-tint', `${s.glassTint}%`);
}

export function useLoader<T>(
  fn: () => Promise<T>,
  key: string,
  live = false,
): [T | null, () => Promise<void>] {
  const [data, setData] = useState<T | null>(null);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const reload = useCallback(async () => {
    const n = ++seq.current;
    const v = await fnRef.current();
    if (n === seq.current) setData(v);
  }, []);
  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    const t = live ? setInterval(() => void reload(), 15_000) : undefined;
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(t);
    };
  }, [reload, key, live]);
  return [data, reload];
}

export function TopBar({
  title,
  date,
  today,
  onDate,
  actions,
  unit = 'day',
}: {
  title: string;
  date?: string;
  today?: string;
  onDate?: (d: string) => void;
  actions?: ReactNode;
  unit?: Period;
}) {
  const step = (n: number) => date && onDate?.(stepDate(date, unit, n));
  const nextStart = date ? periodStart(stepDate(date, unit, 1), unit) : '';
  const isCurrent = !!today && !!date && periodStart(date, unit) === periodStart(today, unit);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-8 pt-2">
      <h1 className="text-[20px] font-bold tracking-[-0.02em]">{title}</h1>
      {date && (
        <div className="flex items-center gap-1">
          <NavBtn label={`Previous ${unit}`} onClick={() => step(-1)}>
            ‹
          </NavBtn>
          <NavBtn label={`Next ${unit}`} onClick={() => step(1)} disabled={!!today && nextStart > today}>
            ›
          </NavBtn>
          <span data-testid="date-label" className="ml-1 text-[13px] text-muted tabular">
            {periodLabel(date, unit)}
          </span>
          {today && !isCurrent && (
            <button className="ml-2 rounded-control px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/10" onClick={() => onDate?.(today)}>
              {unit === 'day' ? 'Back to today' : `This ${unit}`}
            </button>
          )}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
  );
}

function NavBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-text disabled:text-faint disabled:hover:bg-transparent"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={children === '‹' ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} />
      </svg>
    </button>
  );
}

export function Card({
  title,
  right,
  className,
  children,
  testId,
}: {
  title?: string;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={clsx('min-w-0 rounded-card border border-border bg-surface p-4', className)}
    >
      {title && (
        <div className="mb-3 flex items-center">
          <span className="section-title">{title}</span>
          {right && <span className="ml-auto text-[12px] text-muted tabular">{right}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** One bordered strip of stat cells divided by hairlines (Today, Week, Month). */
export function StatStrip({ cols, children }: { cols: 4 | 5; children: ReactNode }) {
  return (
    <section className={clsx('grid gap-3', cols === 4 ? 'grid-cols-4' : 'grid-cols-5')}>
      {children}
    </section>
  );
}

/** P102: 14 px line icons for the stat tiles, drawn like the sidebar's. */
const STAT_ICONS = {
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z',
  briefcase: 'M3.5 8a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1zM8.5 7V5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2M3.5 13h17',
  gauge: 'M4.6 18.5a9 9 0 1 1 14.8 0M12 14l3.5-4.5',
  flame: 'M12 21c3.9 0 7-2.8 7-6.6 0-3.8-2.8-6.2-4.2-9.4-.5 2.3-1.8 3.7-3 4.5-.5-2.6-1.9-4.9-4.2-6.5.4 3.3-2.6 6-2.6 10.4 0 4.8 3.1 7.6 7 7.6z',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  check: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.2l2.7 2.7L16 9.5',
} as const;

export const statIcon = (name: keyof typeof STAT_ICONS, testId: string, className?: string) => (
  <svg data-testid={testId} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={clsx('shrink-0', className)} aria-hidden>
    <path d={STAT_ICONS[name]} />
  </svg>
);

export function StatCell({
  label,
  id,
  value,
  sub,
  tone,
  icon,
  children,
}: {
  label: string;
  id: string;
  value: string;
  sub: string;
  tone?: 'green';
  /** P102: a small icon before the label, so a tile is found without reading it. */
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="tile-lift min-w-0 rounded-[14px] bg-surface-2/50 px-5 py-4">
      <div className="section-label mb-1.5 flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div data-testid={id} className={clsx('text-[26px] leading-tight font-bold tracking-[-0.02em] tabular', tone === 'green' && 'text-green')}>
        {value}
      </div>
      {children}
      <div data-testid={id === 'stat-streak' ? undefined : `${id}-sub`} className="mt-1 truncate text-[12px] text-muted tabular">
        {sub}
      </div>
    </div>
  );
}

/** Category pill; click opens a menu that creates a user rule (P12). */
export function CategoryChip({
  category,
  onPick,
  quiet,
}: {
  category: ActivityCategory;
  onPick?: (c: Category) => void;
  /** No pill outline; muted label, ▾ only on hover (Today page). */
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        data-testid="category-chip"
        disabled={!onPick}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'group/chip flex h-[22px] items-center gap-1.5 rounded-control pr-1.5 pl-2 text-[12px]',
          quiet
            ? 'text-muted hover:bg-surface-2 hover:text-text'
            : 'border border-border text-text hover:bg-surface-2 disabled:hover:bg-transparent',
        )}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[category] }} />
        {CAT_LABEL[category]}
        {onPick && <span className={clsx('text-muted', quiet && 'invisible group-hover/chip:visible')}>▾</span>}
      </button>
      {open && onPick && (
        <div className="absolute top-[26px] right-0 z-20 w-[150px] rounded-card border border-border bg-surface p-1 shadow-pop">
          {(['productive', 'neutral', 'distracting'] as const).map((c) => (
            <button
              key={c}
              data-category={c}
              onClick={() => {
                setOpen(false);
                if (c !== category) onPick(c);
              }}
              className={clsx(
                'flex h-7 w-full items-center gap-2 rounded-chip px-2 text-left text-[12px] hover:bg-surface-2',
                c === category && 'text-muted',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[c] }} />
              {CAT_LABEL[c]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="py-6 text-center text-[12px] text-faint">{children}</div>
);

/** 32 × 18 switch (design/DESIGN.md §4 Settings). */
export function Toggle({
  on,
  onChange,
  label,
  testId,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={clsx(
        'relative h-[18px] w-8 shrink-0 rounded-pill transition-colors',
        on ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={clsx(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all',
          on ? 'left-[16px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="inline-flex rounded-control bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-value={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'h-6 rounded-chip px-2.5 text-[12px] font-medium',
            o.value === value ? 'bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,0.12)] ring-1 ring-border' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const DefaultChip = () => (
  <span className="rounded-chip bg-surface-2 px-1.5 text-[11px] leading-[18px] text-muted">
    default
  </span>
);
