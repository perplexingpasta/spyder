// Where the day's time went (P68, P74, P105): a donut of work, break, gym, food, sleep, not accounted for and untracked, with a legend.
import { useId, useState } from 'react';
import { timeSplit, type DaySummary, type TimeSplitKey } from '../../core/aggregate';
import { Empty } from './parts';
import { TAG_COLOR } from './Timeline';
import { dur } from './stats';

const LABEL: Record<TimeSplitKey, string> = { work: 'Work', break: 'Break', gym: 'Gym', food: 'Food', sleep: 'Sleep', unanswered: 'Not accounted for', untracked: 'Untracked' };
const SIZE = 132;
const R = 62;
const INNER = 42;

/** An annulus slice from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). */
function arc(a0: number, a1: number): string {
  const c = SIZE / 2;
  const pt = (r: number, a: number) => `${c + r * Math.sin(a)} ${c - r * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(R, a0)} A${R} ${R} 0 ${large} 1 ${pt(R, a1)} L${pt(INNER, a1)} A${INNER} ${INNER} 0 ${large} 0 ${pt(INNER, a0)} Z`;
}

export function TimeSplit({ s }: { s: DaySummary }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<TimeSplitKey | null>(null);
  const parts = timeSplit(s);
  const total = parts.reduce((t, p) => t + p.sec, 0);
  if (!total) return <Empty>No blocks this day</Empty>;
  const fill = (k: TimeSplitKey) =>
    k === 'unanswered' ? 'var(--color-open)' : k === 'untracked' ? `url(#un${uid})` : TAG_COLOR[k];
  const share = (sec: number) => `${Math.round((sec / total) * 100)}%`;
  const shown = parts.find((p) => p.key === hover);
  // Each slice's start and end angle, clockwise from 12 o'clock.
  const ends = parts.map((_, i) => (parts.slice(0, i + 1).reduce((t, p) => t + p.sec, 0) / total) * 2 * Math.PI);
  return (
    <div data-testid="time-split" className="flex items-center gap-6" onMouseLeave={() => setHover(null)}>
      <svg width={SIZE} height={SIZE} className="shrink-0" role="img" aria-label={parts.map((p) => `${LABEL[p.key]} ${dur(p.sec)}`).join(', ')}>
        <defs>
          <pattern id={`un${uid}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={5} stroke="var(--color-faint)" strokeWidth={1.5} opacity={0.6} />
          </pattern>
        </defs>
        {parts.map((p, i) => {
          const dim = hover !== null && hover !== p.key;
          const common = {
            fill: fill(p.key),
            stroke: 'var(--color-surface)',
            strokeWidth: 2,
            opacity: dim ? 0.35 : 1,
            onMouseEnter: () => setHover(p.key),
          };
          // A single part is a full ring (an arc can't close on itself).
          return parts.length === 1 ? (
            <path
              key={p.key}
              data-slice={p.key}
              fillRule="evenodd"
              d={`M${SIZE / 2} ${SIZE / 2 - R}a${R} ${R} 0 1 1 0 ${2 * R}a${R} ${R} 0 1 1 0 ${-2 * R}ZM${SIZE / 2} ${SIZE / 2 - INNER}a${INNER} ${INNER} 0 1 0 0 ${2 * INNER}a${INNER} ${INNER} 0 1 0 0 ${-2 * INNER}Z`}
              {...common}
            />
          ) : (
            <path key={p.key} data-slice={p.key} d={arc(i ? ends[i - 1] : 0, ends[i])} {...common} />
          );
        })}
        <text x={SIZE / 2} y={SIZE / 2 - 2} textAnchor="middle" className="fill-text text-[15px] font-semibold tabular">
          {shown ? share(shown.sec) : dur(total)}
        </text>
        <text x={SIZE / 2} y={SIZE / 2 + 14} textAnchor="middle" className="fill-muted text-[11px]">
          {shown ? LABEL[shown.key] : 'in total'}
        </text>
      </svg>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
        {parts.map((p) => (
          <li
            key={p.key}
            data-testid={`split-${p.key}`}
            onMouseEnter={() => setHover(p.key)}
            className="flex items-center gap-2 rounded-control px-1.5 py-0.5 hover:bg-surface-2"
          >
            {p.key === 'untracked' ? (
              <span className="hatch h-2.5 w-2.5 shrink-0 rounded-[2px]" />
            ) : (
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: fill(p.key) }} />
            )}
            <span className="min-w-0 flex-1 truncate text-muted">{LABEL[p.key]}</span>
            <span className="tabular">{dur(p.sec)}</span>
            <span className="w-10 text-right text-muted tabular">{share(p.sec)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
