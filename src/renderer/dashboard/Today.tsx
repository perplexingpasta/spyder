// Today page (plan §12, P55, P64, P80): stat row → block log → two-track timeline → apps & sites → distractions.
import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { alikeRuns, appSlot, dayLog, neighbours, type AppRow, type LogEntry, type SessionLine } from '../../core/aggregate';
import type { ActivityCategory } from '../../core/categorize';
import { fmtDuration, fmtTime } from '../../core/format';
import type { DayVM } from '../../core/review';
import { EFFICIENCIES, TAG_LABEL, TAGS, type Efficiency, type EngineError, type Tag } from '../../core/types';
import type { EditResult, Ok } from '../../preload/api';
import { AnswerInput, Btn } from '../ui/controls';
import { answerText, AppSwatch, appColor, blockColor, ownAnswer, TAG_COLOR, Timeline, useAppColors } from './Timeline';
import { CAT_COLOR, CAT_LABEL, CategoryChip, Empty, StatCell, statIcon, StatStrip, Toggle, TopBar, useLoader } from './parts';
import { appTexts, dur, statTexts } from './stats';
import { showEditResult } from './toast';

export function Today({ date, onDate }: { date?: string; onDate: (d: string) => void }) {
  const [vm, reload] = useLoader(() => window.spyder.getDay(date), date ?? '', true);
  // Reload as soon as a block starts or ends or an answer lands, not on the next poll.
  useEffect(() => {
    let last = '';
    return window.spyder.onWidget((w) => {
      const k = [w.mode, w.blockId, w.pendingCount].join('|');
      if (k !== last) void reload(); // the first push too: the page may have loaded before it
      last = k;
    });
  }, [reload]);
  if (!vm) return <TopBar title="Today" />;
  return (
    <>
      <TopBar title="Today" date={vm.date} today={vm.today} onDate={onDate} />
      <TodayBody key={vm.date} vm={vm} reload={reload} />
    </>
  );
}

function TodayBody({ vm, reload }: { vm: DayVM; reload: () => Promise<void> }) {
  const s = vm.summary;
  const t = statTexts(s, vm.streak);
  const [picked, setPicked] = useState<string | null>(null);
  const [apps, setApps] = useAppTrack();
  return (
    <div className="flex-1 overflow-x-hidden overflow-y-auto" data-testid="today">
      <div className="mx-auto flex max-w-[960px] flex-col gap-8 px-8 pt-6 pb-16">
        <StatRow vm={vm} t={t} />
        <BlockLog vm={vm} reload={reload} picked={picked} onPick={setPicked} />

        <section data-testid="timeline-card">
          <SectionHead title="Timeline" right={<TimelineLegend s={s} />} />
          <Timeline
            s={s}
            nowMs={vm.date === vm.today ? vm.nowMs : -1}
            apps={apps}
            selected={picked}
            onPick={(id) => setPicked((cur) => (cur === id ? null : id))}
          />
          <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 px-[18px] text-[11px] text-muted">
            <Toggle testId="app-track-toggle" label="App track" on={apps} onChange={setApps} />
            App track
          </label>
        </section>

        <section>
          <SectionHead title="Apps & sites" right={s.scope === 'work_hours' ? 'Work hours' : 'All day'} />
          <CategoryBar totals={s.categoryTotals} />
          <TopApps rows={s.apps} reload={reload} />
        </section>

        {(s.flags.length > 0 || s.distractingSec > 0) && <Distractions vm={vm} t={t} />}

        {s.offHoursActivitySec > 0 && (
          <p data-testid="off-hours-note" className="-mt-4 text-[12px] text-faint">
            {fmtDuration(s.offHoursActivitySec)} of activity outside work hours
            {s.scope === 'work_hours' ? ' (not in the percentages)' : ''}.
          </p>
        )}
      </div>
    </div>
  );
}

function SectionHead({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-7 items-center gap-3">
      <h2 className="section-title">{title}</h2>
      {children}
      {right && <div className="ml-auto text-[12px] text-muted tabular">{right}</div>}
    </div>
  );
}

// ---- stat row --------------------------------------------------------------------------

/** P80: productive vs goal (with a thin bar) is the headline; then work, efficiency (P75), streak. Day score is on Review, Week and Month. */
function StatRow({ vm, t }: { vm: DayVM; t: ReturnType<typeof statTexts> }) {
  const s = vm.summary;
  const frac = s.goalSec > 0 ? Math.min(1, s.productiveSec / s.goalSec) : 0;
  return (
    <StatStrip cols={4}>
      <StatCell label="Productive" id="stat-productive" icon={statIcon('target', 'icon-productive')} value={t.productive} sub={t.productiveSub} tone={s.goalMet ? 'green' : undefined}>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-pill bg-text/10">
          <div className={clsx('h-full rounded-pill', s.goalMet ? 'bg-green' : 'bg-productive')} style={{ width: `${frac * 100}%` }} />
        </div>
      </StatCell>
      <StatCell label="Work" id="stat-work" icon={statIcon('briefcase', 'icon-work')} value={t.work} sub={t.workSub} />
      <StatCell label="Efficiency" id="stat-efficiency" icon={statIcon('gauge', 'icon-efficiency')} value={t.efficiency} sub={t.efficiencySub} />
      {/* The flame is lit (orange) while the streak is alive. */}
      <StatCell label="Streak" id="stat-streak" icon={statIcon('flame', 'icon-streak', vm.streak > 0 ? 'text-orange' : undefined)} value={t.streak} sub="goal met in a row" />
    </StatStrip>
  );
}

// ---- block log (P64) ------------------------------------------------------------------------

const span = (a: number, b: number | null, running = false) => `${fmtTime(a)}–${running ? 'now' : b !== null ? fmtTime(b) : ''}`;

/** Why the chosen blocks can't be merged, or null when they can. */
function mergeProblem(chosen: SessionLine[], log: LogEntry[]): string | null {
  if (chosen.length < 2) return 'Pick at least two blocks';
  if (chosen.some((x) => x.running)) return 'The running block can’t be edited until it ends';
  if (!neighbours(log, chosen.map((x) => x.id))) return 'Only blocks next to each other can be merged';
  const tags = new Set(chosen.map((x) => x.tag));
  if (tags.has('work') && tags.size > 1) return 'A break can’t be merged with work blocks. Change their tags first.';
  if (tags.size > 1) return 'Blocks with different tags can’t be merged. Change their tags first.';
  return null;
}

type Panel = { type: 'answer' } | { type: 'merge' } | null;

function BlockLog({ vm, reload, picked, onPick }: { vm: DayVM; reload: () => Promise<void>; picked: string | null; onPick: (id: string | null) => void }) {
  const s = vm.summary;
  const log = dayLog(s);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const blocks = s.sessions;
  // `chosen` ignores ticks of blocks that are gone (deleted, merged); it's in time order.
  const chosen = blocks.filter((x) => checked.has(x.id));

  const toggle = (id: string) => {
    setPanel(null);
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const after = async (r: EditResult | Ok | EngineError) => {
    if ('undoId' in r || 'error' in r) showEditResult(r, () => void reload());
    if (!('error' in r)) {
      setChecked(new Set());
      setPanel(null);
    }
    await reload();
  };
  const del = async (ids: string[]) => {
    if (picked && ids.includes(picked)) onPick(null);
    await after(await window.spyder.deleteBlocks(ids));
  };

  // Neighbouring blocks with the same tag and answer are shown joined (P64), and Merge repeats merges them (P73).
  // P102: a run starts collapsed into one row; its "N blocks" caption opens it. Open runs are known by their first block.
  const runs = alikeRuns(log);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const joinedWithPrev = new Set(runs.flatMap((r) => r.slice(1)));
  const runOf = new Map(runs.flatMap((r) => r.map((id) => [id, r] as const)));
  const lines = (ids: string[]) => ids.map((id) => blocks.find((x) => x.id === id)!);
  const groupOf = new Map(
    runs.map((r) => [
      r[0],
      {
        count: r.length,
        sec: lines(r).reduce((t, x) => t + x.daySec, 0),
        open: open.has(r[0]),
        onToggle: () =>
          setOpen((o) => {
            const n = new Set(o);
            if (n.has(r[0])) n.delete(r[0]);
            else n.add(r[0]);
            return n;
          }),
      },
    ]),
  );
  /** The blocks a row stands for: the whole run while it's collapsed. */
  const idsOf = (id: string) => {
    const r = runOf.get(id);
    return r && !open.has(r[0]) ? r : [id];
  };
  const toggleAll = (ids: string[]) => {
    setPanel(null);
    setChecked((c) => {
      const n = new Set(c);
      const all = ids.every((id) => n.has(id));
      for (const id of ids) {
        if (all) n.delete(id);
        else n.add(id);
      }
      return n;
    });
  };

  const workCount = blocks.filter((x) => x.kind !== 'break').length;
  const pending = blocks.filter((x) => x.kind !== 'break' && x.name === null && !x.running).length;
  const problem = mergeProblem(chosen, log);
  return (
    <section data-testid="block-log">
      <SectionHead
        title="Blocks"
        right={
          chosen.length === 0 ? (
            <>
              {workCount} {workCount === 1 ? 'block' : 'blocks'}
              {pending > 0 && <span className="text-orange"> · {pending} not accounted for</span>}
              {s.untrackedSec >= 60 && <span className="text-faint"> · {dur(s.untrackedSec)} untracked</span>}
            </>
          ) : undefined
        }
      >
        {chosen.length === 0 && runs.length > 0 && (
          <Btn
            size="sm"
            data-testid="merge-repeats"
            className="order-last"
            title="Merge neighbouring blocks with the same tag and answer"
            onClick={() => void window.spyder.mergeRepeats(vm.date).then(after)}
          >
            Merge repeats
          </Btn>
        )}
        {chosen.length > 0 && (
          <div data-testid="selection-bar" className="ml-auto flex items-center gap-1.5">
            <span className="mr-1 text-[12px] text-muted tabular">{chosen.length} selected</span>
            <TagSelect
              testId="tag-selected"
              label="Tag the selected blocks"
              value={null}
              onChange={(t) => void window.spyder.tagBlocks(chosen.map((x) => x.id), t).then(after)}
            />
            {chosen.every((x) => x.tag === 'work') && (
              <EfficiencySelect
                testId="rate-selected"
                label="Rate the selected blocks"
                onChange={(e) => void window.spyder.rateBlocks(chosen.map((x) => x.id), e).then(after)}
              />
            )}
            <Btn size="sm" data-testid="answer-open" onClick={() => setPanel({ type: 'answer' })}>
              Answer…
            </Btn>
            <Btn size="sm" data-testid="merge-open" disabled={chosen.length < 2} title={problem ?? undefined} onClick={() => setPanel({ type: 'merge' })}>
              Merge…
            </Btn>
            <Btn size="sm" variant="danger" data-testid="delete-selected" onClick={() => void del(chosen.map((x) => x.id))}>
              Delete
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
              Clear
            </Btn>
          </div>
        )}
      </SectionHead>
      {panel && chosen.length > 0 && (
        <AnswerPanel
          key={panel.type}
          chosen={chosen}
          merge={panel.type === 'merge'}
          problem={panel.type === 'merge' ? problem : null}
          onCancel={() => setPanel(null)}
          onSave={async (answer, tag) =>
            after(
              panel.type === 'merge'
                ? await window.spyder.mergeBlocks(chosen.map((x) => x.id), answer)
                : await window.spyder.answerBlocks(chosen.map((x) => ({ id: x.id, answer, tag }))),
            )
          }
        />
      )}
      {log.length === 0 ? (
        <div className="rounded-card border border-border">
          <Empty>No blocks yet. Press Start in the sidebar.</Empty>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {log.map((e, i) => {
            if (e.type === 'untracked' && editing === `untracked:${e.startMs}`) {
              // P95: untracked time becomes a block with this answer (Save = work, Break = break), with Undo.
              return (
                <EditRow
                  key={`fill${e.startMs}`}
                  startMs={e.startMs}
                  endMs={e.endMs}
                  initial=""
                  tag="work"
                  testId="untracked-edit-row"
                  submit={async (answer, tag) => {
                    const r = await window.spyder.fillUntracked(e.startMs, e.endMs, answer, tag ?? 'work');
                    if ('error' in r) return r.message;
                    setEditing(null);
                    await after(r);
                    return null;
                  }}
                  onCancel={() => setEditing(null)}
                />
              );
            }
            if (e.type !== 'session') return <QuietRow key={`${e.type}${e.startMs}`} e={e} onFill={() => setEditing(`untracked:${e.startMs}`)} />;
            const ids = idsOf(e.id);
            if (ids[0] !== e.id) return null; // inside a collapsed run: its first row stands for it
            const collapsed = ids.length > 1;
            const run = lines(ids);
            const last = run[run.length - 1];
            // A collapsed run reads as one block over its whole span, rated as a merge would keep it (P104).
            const x: SessionLine = collapsed
              ? { ...e, endMs: last.endMs, daySec: run.reduce((t, y) => t + y.daySec, 0), efficiency: runEfficiency(run), merged: false }
              : e;
            const next = log[i + 1];
            const joinedNext = !collapsed && next?.type === 'session' && joinedWithPrev.has(next.id);
            return editing === e.id ? (
              <EditRow
                key={e.id}
                startMs={x.startMs}
                endMs={x.endMs}
                initial={ownAnswer(e) ?? ''}
                tag={e.tag}
                submit={async (answer, tag) => {
                  const r = await window.spyder.answerBlocks(ids.map((id) => ({ id, answer, tag })));
                  if ('error' in r) return r.message;
                  setEditing(null);
                  await reload();
                  return null;
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <BlockRow
                key={e.id}
                x={x}
                joinedPrev={!collapsed && joinedWithPrev.has(e.id)}
                joinedNext={joinedNext}
                group={groupOf.get(e.id) ?? null}
                checked={ids.every((id) => checked.has(id))}
                picked={picked !== null && ids.includes(picked)}
                onCheck={() => (collapsed ? toggleAll(ids) : toggle(e.id))}
                onPick={() => onPick(picked !== null && ids.includes(picked) ? null : e.id)}
                onEdit={() => setEditing(e.id)}
                onDelete={() => void del(ids)}
                onUnmerge={() => void window.spyder.unmergeBlock(e.id).then(after)}
                onTag={(t) => void window.spyder.tagBlocks(ids, t).then(after)}
                onRate={(r) => void window.spyder.rateBlocks(ids, r).then(after)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

const rowCls = 'group flex h-11 items-center gap-3 rounded-[10px] pr-2 pl-3 text-[13px] transition-colors duration-150';

function Check({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      data-testid="block-check"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={clsx(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:invisible',
        on ? 'border-accent bg-accent text-on-accent' : 'border-border-strong bg-surface opacity-0 group-hover:border-muted group-hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      {on && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 5.2 4.1 7.3 8 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function IconBtn({ label, testId, onClick, children, danger }: { label: string; testId: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx('flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-surface-2', danger ? 'hover:text-red' : 'hover:text-text')}
    >
      {children}
    </button>
  );
}

/** P104: a collapsed run's efficiency, as a merge would keep it: the time-weighted mean of its rated blocks (P75). */
function runEfficiency(run: SessionLine[]): number | null {
  const rated = run.filter((y) => y.efficiency !== null);
  if (!rated.length) return null;
  const sec = rated.reduce((t, y) => t + y.daySec, 0);
  return Math.round(
    sec > 0 ? rated.reduce((t, y) => t + y.daySec * y.efficiency!, 0) / sec : rated.reduce((t, y) => t + y.efficiency!, 0) / rated.length,
  );
}

function BlockRow({
  x,
  joinedPrev,
  joinedNext,
  group,
  checked,
  picked,
  onCheck,
  onPick,
  onEdit,
  onDelete,
  onUnmerge,
  onTag,
  onRate,
}: {
  x: SessionLine;
  joinedPrev: boolean;
  joinedNext: boolean;
  group: { count: number; sec: number; open: boolean; onToggle: () => void } | null;
  checked: boolean;
  picked: boolean;
  onCheck: () => void;
  onPick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUnmerge: () => void;
  onTag: (tag: Tag) => void;
  onRate: (e: Efficiency | null) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (picked) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [picked]);
  const text = answerText(x);
  const unanswered = x.kind !== 'break' && x.name === null;
  return (
    <li
      ref={ref}
      data-testid="block-row"
      data-session={x.id}
      data-picked={picked || undefined}
      data-joined={joinedPrev || undefined}
      data-collapsed={(group && !group.open) || undefined}
      onClick={onPick}
      className={clsx(
        rowCls,
        'cursor-default',
        // Joined blocks read as one soft tile: no gap and no rounding between them.
        joinedPrev && '-mt-1 rounded-t-none',
        joinedNext && 'rounded-b-none',
        picked ? 'bg-accent/12' : checked ? 'bg-surface-2' : 'bg-surface-2/45 hover:bg-surface-2',
      )}
    >
      <Check on={checked} onChange={onCheck} label={`Select ${text}`} disabled={x.running} />
      <span className="w-[92px] shrink-0 text-muted tabular">{span(x.startMs, x.endMs, x.running)}</span>
      <span
        className={clsx('w-[3px] shrink-0', joinedPrev || joinedNext ? 'self-stretch' : 'h-4 rounded-pill', joinedPrev && !joinedNext && 'mb-2', joinedNext && !joinedPrev && 'mt-2')}
        style={{ background: blockColor(x), opacity: x.kind === 'break' ? 0.5 : 1 }}
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {x.running ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent">
            {/* P102: a ring pings out of the dot, so the running block reads as live. */}
            <span data-testid="running-dot" className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75 motion-reduce:hidden" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            Running
          </span>
        ) : (
          <button
            data-testid="block-answer"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            title="Change the answer"
            className={clsx(
              'min-w-0 truncate text-left hover:underline hover:decoration-border-strong hover:underline-offset-4',
              unanswered ? 'text-orange' : joinedPrev ? 'text-faint' : undefined,
            )}
          >
            {text}
          </button>
        )}
        {group && (
          <button
            type="button"
            data-testid="block-group"
            aria-expanded={group.open}
            title={group.open ? 'Show as one row' : `Show the ${group.count} blocks`}
            onClick={(e) => {
              e.stopPropagation();
              group.onToggle();
            }}
            className="flex shrink-0 items-center gap-1 rounded-control px-1 text-[11px] text-faint tabular hover:bg-surface-2 hover:text-muted"
          >
            {group.count} blocks · {dur(group.sec)}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={clsx('transition-transform', group.open && 'rotate-90')}>
              <path d="M4 2.5 6.5 5 4 7.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </span>
      <TagSelect testId="block-tag" label={`Tag of ${text}`} value={x.tag} disabled={x.running} onChange={onTag} />
      <span data-testid="block-dur" className="w-[64px] shrink-0 text-right tabular">
        {dur(x.daySec)}
      </span>
      {x.tag === 'work' ? (
        <EfficiencySelect testId="block-efficiency" label={`Efficiency of ${text}`} value={x.efficiency} disabled={x.running} onChange={onRate} />
      ) : (
        <span className="w-[64px] shrink-0" />
      )}
      <span className="flex w-[88px] shrink-0 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {!x.running && (
          <>
            {x.merged && (
              <IconBtn label="Unmerge" testId="block-unmerge" onClick={onUnmerge}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 6.5h6.5a3.5 3.5 0 010 7H7M5.5 4L3 6.5 5.5 9" />
                </svg>
              </IconBtn>
            )}
            <IconBtn label="Change the answer" testId="block-edit" onClick={onEdit}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10.5 2.5l3 3L6 13H3v-3z" />
              </svg>
            </IconBtn>
            <IconBtn label="Delete" testId="block-delete" onClick={onDelete} danger>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
              </svg>
            </IconBtn>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * Answer one stretch inline: re-answer a block (P64, P66; Save keeps its tag) or account for untracked time (P95; Save
 * makes work). Break makes a break. Enter saves, Escape cancels. `submit` returns an error to show, or null when done.
 */
function EditRow({
  startMs,
  endMs,
  initial,
  tag: current,
  testId = 'block-edit-row',
  submit,
  onCancel,
}: {
  startMs: number;
  endMs: number | null;
  initial: string;
  tag: Tag;
  testId?: string;
  submit: (answer: string | null, tag?: Tag) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = async (tag?: Tag) => {
    if ((tag ?? current) === 'work' && !text.trim()) return setError('Say what you did, or pick Break');
    setError(await submit(text.trim() || null, tag));
  };
  return (
    <li
      data-testid={testId}
      className="flex flex-col gap-1 rounded-[10px] bg-surface-2 py-2 pr-2 pl-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="flex items-center gap-2">
        <span className="w-[92px] shrink-0 pl-7 text-[13px] text-muted tabular">{span(startMs, endMs)}</span>
        <div className="min-w-0 flex-1">
          <AnswerInput value={text} onChange={setText} onEnter={() => void save()} autoFocus />
        </div>
        <Btn variant="primary" data-testid="edit-save" onClick={() => void save()}>
          Save
        </Btn>
        <Btn data-testid="edit-break" onClick={() => void save('break')}>
          Break
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
      {error && <div className="pl-[124px] text-[12px] text-red">{error}</div>}
    </li>
  );
}

/** Away and untracked spans: quiet lines in the log. An untracked one can be accounted for (P95). */
function QuietRow({ e, onFill }: { e: Exclude<LogEntry, { type: 'session' }>; onFill: () => void }) {
  return (
    <li data-testid={e.type === 'away' ? 'log-away' : 'log-untracked'} className={clsx(rowCls, 'bg-surface-2/20 text-muted')}>
      <span className="w-4 shrink-0" />
      <span className="w-[92px] shrink-0 tabular">{span(e.startMs, e.endMs)}</span>
      <span className="h-4 w-[3px] shrink-0 rounded-pill bg-faint/60" />
      <span className="min-w-0 flex-1 truncate text-faint">{e.type === 'away' ? 'Away' : 'Untracked'}</span>
      <span className="w-[64px] shrink-0 text-right tabular">{dur(e.sec)}</span>
      <span className="w-[64px] shrink-0" />
      <span className="flex w-[88px] shrink-0 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {e.type === 'untracked' && (
          <IconBtn label="Account for this time" testId="untracked-fill" onClick={onFill}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10.5 2.5l3 3L6 13H3v-3z" />
            </svg>
          </IconBtn>
        )}
      </span>
    </li>
  );
}

/**
 * One answer for the selected blocks (Save keeps each block's tag, Break makes them breaks), or merging adjacent
 * blocks of one tag into one longer block (P64, P66). Only breaks may be left without an answer.
 */
function AnswerPanel({
  chosen,
  merge,
  problem,
  onSave,
  onCancel,
}: {
  chosen: SessionLine[];
  merge: boolean;
  problem: string | null;
  onSave: (answer: string | null, tag?: Tag) => Promise<void>;
  onCancel: () => void;
}) {
  const allBreaks = chosen.every((x) => x.kind === 'break');
  const names = new Set(chosen.map(ownAnswer));
  const common = names.size === 1 ? [...names][0] : null;
  const [text, setText] = useState(common ?? '');
  const [error, setError] = useState<string | null>(null);
  const total = chosen.reduce((t, x) => t + x.daySec, 0);
  const save = async (tag?: Tag) => {
    if (!text.trim() && !(tag === 'break' || allBreaks)) return setError('Say what you did, or pick Break');
    setError(null);
    await onSave(text.trim() || null, tag);
  };
  return (
    <div data-testid={merge ? 'merge-panel' : 'answer-panel'} className="mb-3 rounded-card border border-border-strong bg-surface p-4 shadow-pop">
      <div className="mb-1 section-title">{merge ? `Merge ${chosen.length} blocks` : `Answer ${chosen.length} ${chosen.length === 1 ? 'block' : 'blocks'}`}</div>
      <p className="mb-3 text-[12px] text-muted">
        {merge
          ? `They become one ${dur(total)} ${allBreaks ? 'break' : 'block'}, ${span(chosen[0].startMs, chosen[chosen.length - 1].endMs)}, with one answer.`
          : 'Every selected block gets this answer.'}
      </p>
      {problem ? (
        <p className="mb-3 text-[12px] text-red">{problem}</p>
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <AnswerInput value={text} onChange={setText} onEnter={() => void save()} autoFocus />
          </div>
          <Btn variant="primary" data-testid="panel-save" onClick={() => void save()}>
            {merge ? 'Merge' : 'Save'}
          </Btn>
          {!merge && (
            <Btn data-testid="panel-break" onClick={() => void save('break')}>
              Break
            </Btn>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Btn variant="ghost" onClick={onCancel}>
          Cancel
        </Btn>
        {error && <span className="text-[12px] text-red">{error}</span>}
      </div>
    </div>
  );
}

/** P66, P74, P105: a block's tag, Work, Break, Gym, Food or Sleep. With `value` null it's a "Tag…" picker for the selected blocks. */
function TagSelect({
  testId,
  label,
  value,
  disabled,
  onChange,
}: {
  testId: string;
  label: string;
  value: Tag | null;
  disabled?: boolean;
  onChange: (t: Tag) => void;
}) {
  return (
    <span className="relative flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
      {value && (
        <span
          className="pointer-events-none absolute left-2 h-2 w-2 rounded-[2px]"
          style={{ background: TAG_COLOR[value] }}
        />
      )}
      <select
        data-testid={testId}
        aria-label={label}
        title={label}
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value as Tag)}
        className={clsx(
          'h-7 cursor-pointer appearance-none rounded-control border bg-transparent pr-6 text-[12px] outline-none focus-visible:border-accent',
          'disabled:cursor-default disabled:opacity-50',
          value ? 'w-[80px] border-transparent pl-6 text-muted enabled:hover:border-border enabled:hover:bg-surface-2 enabled:hover:text-text' : 'border-border pl-2.5 text-text hover:bg-surface-2',
        )}
      >
        {value === null && (
          <option value="" disabled>
            Tag…
          </option>
        )}
        {TAGS.map((t) => (
          <option key={t} value={t}>
            {TAG_LABEL[t]}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2 text-faint opacity-0 transition-opacity group-hover:opacity-100" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * P75: a work block's efficiency, `—` (not rated) or 25–100%. A merge can leave another value, shown as it is.
 * Without `value` it's a "Rate…" picker for the selected blocks.
 */
function EfficiencySelect({
  testId,
  label,
  value,
  disabled,
  onChange,
}: {
  testId: string;
  label: string;
  value?: number | null;
  disabled?: boolean;
  onChange: (e: Efficiency | null) => void;
}) {
  const picker = value === undefined;
  const odd = typeof value === 'number' && !EFFICIENCIES.includes(value as Efficiency);
  return (
    <span className="relative flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
      <select
        data-testid={testId}
        aria-label={label}
        title={label}
        disabled={disabled}
        value={picker ? '' : (value ?? 'none')}
        onChange={(e) => onChange(e.target.value === 'none' ? null : (Number(e.target.value) as Efficiency))}
        className={clsx(
          'h-7 cursor-pointer appearance-none rounded-control border bg-transparent pr-6 text-[12px] outline-none tabular focus-visible:border-accent',
          'disabled:cursor-default disabled:opacity-50',
          picker
            ? 'border-border pl-2.5 text-text hover:bg-surface-2'
            : clsx(
                'w-[64px] border-transparent pl-2 enabled:hover:border-border enabled:hover:bg-surface-2 enabled:hover:text-text',
                // P102: not rated shows nothing until the row is hovered (or the picker is open).
                value === null ? 'text-transparent group-hover:text-faint focus:text-faint' : 'text-muted',
              ),
        )}
      >
        {picker && (
          <option value="" disabled>
            Rate…
          </option>
        )}
        <option value="none">{picker ? 'Not rated' : '—'}</option>
        {odd && <option value={value!}>{value}%</option>}
        {EFFICIENCIES.map((e) => (
          <option key={e} value={e}>
            {e}%
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2 text-faint opacity-0 transition-opacity group-hover:opacity-100" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// ---- timeline legend, apps, distractions ---------------------------------------------------

/** P85: the app track's switch, kept in settings. Off until settings load, so a hidden track never flashes. */
function useAppTrack() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => void window.spyder.getSettings().then((x) => setOn(x.showAppTrack)), []);
  const set = (v: boolean) => {
    setOn(v);
    void window.spyder.setSettings({ showAppTrack: v });
  };
  return [on ?? false, set] as const;
}

/** P80: names match the block log; Gym, Food and Sleep only on days that have them. */
function TimelineLegend({ s }: { s: DayVM['summary'] }) {
  const has = (t: Tag) => s.sessions.some((x) => x.tag === t);
  const item = (swatch: ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  return (
    <span className="flex items-center gap-4 text-faint">
      {item(<span className="h-2 w-2 rounded-[2px] bg-work" />, 'Work')}
      {item(<span className="h-2 w-2 rounded-[2px] bg-open" />, 'Not accounted for')}
      {item(<span className="h-2 w-2 rounded-[2px] bg-break/50" />, 'Break')}
      {has('gym') && item(<span className="h-2 w-2 rounded-[2px] bg-gym/50" />, 'Gym')}
      {has('food') && item(<span className="h-2 w-2 rounded-[2px] bg-food/50" />, 'Food')}
      {has('sleep') && item(<span className="h-2 w-2 rounded-[2px] bg-sleep/50" />, 'Sleep')}
      {item(<span className="hatch h-2 w-2 rounded-[2px]" />, 'Untracked')}
    </span>
  );
}

/** One thin stacked bar with an inline legend. */
function CategoryBar({ totals }: { totals: Record<ActivityCategory, number> }) {
  const data = (Object.keys(totals) as ActivityCategory[]).map((k) => ({ k, v: totals[k] })).filter((d) => d.v > 0);
  const total = data.reduce((n, d) => n + d.v, 0);
  if (!total) return <Empty>No activity recorded</Empty>;
  return (
    <div className="mb-3">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-pill">
        {data.map((d) => (
          <div key={d.k} style={{ width: `${(d.v / total) * 100}%`, background: CAT_COLOR[d.k] }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        {data.map((d) => (
          <li key={d.k} data-testid={`cat-${d.k}`} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: CAT_COLOR[d.k] }} />
            {CAT_LABEL[d.k]}
            <span className="text-text tabular">{dur(d.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TOP_N = 5;

/** P102: each app's own icon by exe (a site shows its browser's); apps whose program file isn't known yet have none. */
function useAppIcons(rows: AppRow[]): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const exes = [...new Set(rows.map((a) => a.exe))].sort().join('|');
  useEffect(() => {
    let live = true;
    void window.spyder.appIcons(exes ? exes.split('|') : []).then((r) => live && setIcons(r));
    return () => {
      live = false;
    };
  }, [exes]);
  return icons;
}

/** Top apps & sites, the rest behind "Show all". Category is a quiet, clickable label (P12). */
/** P81: each row's square is the app's colour on the app track, and picks it like the legend. */
function TopApps({ rows, reload }: { rows: AppRow[]; reload: () => Promise<void> }) {
  const [all, setAll] = useState(false);
  const [picked, pick] = useAppColors();
  const shown = all ? rows : rows.slice(0, TOP_N);
  const icons = useAppIcons(shown);
  if (!rows.length) return null;
  return (
    <>
      <ol className="rounded-card border border-border bg-surface">
        {shown.map((a) => {
          const t = appTexts(a);
          const target = a.ruleTarget;
          return (
            <li key={a.key} data-testid="app-row" className="flex h-10 items-center gap-3 border-b border-border px-3 text-[13px] last:border-0">
              <AppSwatch appKey={a.key} picked={picked} pick={pick} />
              {icons[a.exe] ? (
                <img data-testid="app-icon" src={icons[a.exe]} alt="" width={16} height={16} className="h-4 w-4 shrink-0" draggable={false} />
              ) : (
                <span className="h-4 w-4 shrink-0" />
              )}
              <span data-k="key" className="min-w-0 flex-1 truncate">
                {t.key}
              </span>
              <span data-k="time" className="w-16 text-right tabular">
                {t.time}
              </span>
              <span data-k="pct" className="w-12 text-right text-[12px] text-faint tabular">
                {t.pct}
              </span>
              <div className="flex w-[120px] justify-end">
                <CategoryChip
                  quiet
                  category={a.category}
                  onPick={
                    target
                      ? async (c) => {
                          await window.spyder.saveRule({ ...target, category: c });
                          await reload();
                        }
                      : undefined
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length > TOP_N && (
        <button data-testid="apps-show-all" onClick={() => setAll((v) => !v)} className="mt-2 text-[12px] text-muted hover:text-text">
          {all ? 'Show less' : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

function Distractions({ vm, t }: { vm: DayVM; t: ReturnType<typeof statTexts> }) {
  const s = vm.summary;
  return (
    <section>
      <SectionHead
        title="Distractions"
        right={
          <>
            <span data-testid="stat-distractions" className="text-red">
              {t.distractions}
            </span>{' '}
            {s.flags.length === 1 ? 'flag' : 'flags'} · <span data-testid="stat-distractions-sub">{t.distractionsSub}</span>
          </>
        }
      />
      {s.flags.length > 0 ? (
        <ul className="rounded-card border border-border bg-surface">
          {s.flags.map((f, i) => (
            <li key={i} data-testid="flag-row" className="flex h-10 items-center gap-3 border-b border-border px-3 text-[13px] last:border-0">
              <span className="h-2 w-2 shrink-0 rounded-full bg-red" />
              <span className="w-12 text-muted tabular">{fmtTime(f.tsMs)}</span>
              <span className="min-w-0 flex-1 truncate">{f.target}</span>
              <span className="text-muted tabular">{fmtDuration(f.continuousSec)} straight</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted">No single distraction lasted long enough to flag.</p>
      )}
    </section>
  );
}

/** Ranked apps & sites with a category chip per row (Week's top 10). */
export function AppsList({ rows, reload, compact }: { rows: AppRow[]; reload: () => Promise<void>; compact?: boolean }) {
  const [picked] = useAppColors();
  if (!rows.length) return <Empty>No activity recorded</Empty>;
  return (
    <ol>
      {rows.map((a, i) => {
        const t = appTexts(a);
        const target = a.ruleTarget;
        return (
          <li key={a.key} data-testid="app-row" className="relative flex h-9 items-center gap-3 border-b border-border px-2 text-[13px] last:border-0">
            <div className="absolute inset-y-1.5 left-0 rounded-bar" style={{ width: `${a.pct}%`, background: appColor(picked, a.key, appSlot(a.key)), opacity: 0.18 }} />
            <span className="relative w-5 text-faint tabular">{i + 1}</span>
            <span data-k="key" className="relative min-w-0 flex-1 truncate">
              {t.key}
            </span>
            <span data-k="time" className={clsx('relative text-right tabular', compact ? 'w-14' : 'w-16')}>
              {t.time}
            </span>
            <span data-k="pct" className={clsx('relative text-right text-muted tabular', compact ? 'w-12' : 'w-14')}>
              {t.pct}
            </span>
            {!compact && (
              <div className="relative flex w-[124px] justify-end">
                <CategoryChip
                  category={a.category}
                  onPick={
                    target
                      ? async (c) => {
                          await window.spyder.saveRule({ ...target, category: c });
                          await reload();
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
