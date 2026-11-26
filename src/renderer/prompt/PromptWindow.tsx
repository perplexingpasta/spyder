// Prompt window (#/prompt): accounting for ended blocks (P60, with P70's asks), the midnight card (P98) or the start reminder (P59). DESIGN.md §3.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AccountBlockVM, AccountVM, ImprovesVM, ReflectVM, ReminderVM } from '../../core/promptView';
import type { Efficiency, EngineError, Tag } from '../../core/types';
import type { BlockAnswer, Ok, PromptWindowState } from '../../preload/api';
import { dur } from '../dashboard/stats';
import { applyGlassTint, CategoryButtons, Segmented } from '../dashboard/parts';
import { AnswerInput, Btn, EfficiencyPicker, WrapInput } from '../ui/controls';

export function PromptWindow() {
  const [st, setSt] = useState<PromptWindowState>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The glass frame follows Settings → Glass tint (P92). This window lives on hidden, so re-read it with each prompt and on focus.
    const tint = () => void window.spyder.getSettings().then(applyGlassTint);
    const show = (p: PromptWindowState) => {
      setSt(p);
      tint();
    };
    window.addEventListener('focus', tint);
    void window.spyder.getPrompt().then(show);
    const off = window.spyder.onPrompt(show);
    return () => {
      off();
      window.removeEventListener('focus', tint);
    };
  }, []);
  // The window's height follows the content.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => void window.spyder.resizePrompt(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={root} className="p-2">
      {st?.view === 'account' && <AccountCard key={st.blocks.map((b) => b.id).join()} p={st} />}
      {st?.view === 'reflect' && <ReflectCard key={st.date} p={st} />}
      {st?.view === 'reminder' && <ReminderCard p={st} />}
    </div>
  );
}

function Card({ color, heading, right, testId, children }: { color: string; heading: string; right?: ReactNode; testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 overflow-hidden rounded-[12px] bg-bg/97 px-5 pt-4 pb-5 shadow-[0_8px_30px_rgba(0,0,0,0.3),0_0_0_1px_var(--color-border)]"
      style={{ borderTop: `2px solid ${color}` }}
    >
      <div className="drag flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="caps" style={{ color }}>
          {heading}
        </span>
        <span className="no-drag ml-auto text-[11px] text-muted">{right}</span>
      </div>
      {children}
    </div>
  );
}

const errText = (r: Ok | EngineError) => ('error' in r ? r.message : null);
const NEED = 'Say what you did, or pick Break';

function BlockLine({ b, right }: { b: AccountBlockVM; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px]">
      <span className="tnum font-medium text-text">{b.range}</span>
      <span className="tnum text-faint">{b.length}</span>
      {b.hint && <span className="min-w-0 truncate text-muted">{b.hint}</span>}
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

/**
 * A row's answer in "Each separately": text, whether it's a break (P66: a break may have text too) or sleep (P105,
 * only on a Sleep gap block), and its efficiency (P75, work only).
 */
type RowAnswer = { text: string; as: 'work' | 'break' | 'sleep'; efficiency: Efficiency | null };

/** "What did you do?" for every ended, unanswered block of today (P60). */
function AccountCard({ p }: { p: AccountVM }) {
  const many = p.blocks.length > 1;
  // P105: Sleep is offered for Sleep gap blocks only; in one answer for all, only when every block is one.
  const allSleep = p.blocks.every((b) => b.sleep);
  const [mode, setMode] = useState<'all' | 'each'>('all');
  const [text, setText] = useState('');
  const [efficiency, setEfficiency] = useState<Efficiency | null>(null);
  const [rows, setRows] = useState<Record<string, RowAnswer>>({});
  const [error, setError] = useState<string | null>(null);

  const send = async (answers: BlockAnswer[]) => {
    if (!answers.length) return setError(NEED);
    setError(errText(await window.spyder.answerBlocks(answers)));
  };
  // Save makes work blocks, with the efficiency if one is picked (P75); Break makes breaks, keeping any typed text (P66).
  const all = (answer: string, tag: Tag) => {
    if (tag === 'work' && !answer.trim()) return setError(NEED);
    void send(p.blocks.map((b) => ({ id: b.id, answer: answer.trim() || null, tag, ...(tag === 'work' && efficiency !== null && { efficiency }) })));
  };
  const row = (id: string): RowAnswer => rows[id] ?? { text: '', as: 'work', efficiency: null };
  const setRow = (id: string, r: Partial<RowAnswer>) => setRows((all) => ({ ...all, [id]: { ...row(id), ...r } }));
  // Rows left empty stay pending for later.
  const saveEach = () =>
    void send(
      p.blocks.flatMap((b): BlockAnswer[] => {
        const r = row(b.id);
        if (r.as !== 'work') return [{ id: b.id, answer: r.text.trim() || null, tag: r.as }];
        return r.text.trim() ? [{ id: b.id, answer: r.text, tag: 'work', ...(r.efficiency !== null && { efficiency: r.efficiency }) }] : [];
      }),
    );

  const keepWorking = p.canContinue && (
    <button type="button" data-testid="account-keep-working" className="text-accent hover:underline" onClick={() => void window.spyder.keepWorking()}>
      Keep working
    </button>
  );

  return (
    <Card testId="prompt-account" color="var(--color-accent)" heading={p.heading} right={keepWorking}>
      <div className="text-[15px] font-semibold text-text">{p.title}</div>
      {!many && <BlockLine b={p.blocks[0]} />}
      {many && (
        <Segmented
          testId="account-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'One answer for all' },
            { value: 'each', label: 'Each separately' },
          ]}
        />
      )}
      {many && mode === 'all' && (
        <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
          {p.blocks.map((b) => (
            <BlockLine key={b.id} b={b} />
          ))}
        </div>
      )}
      {!many || mode === 'all' ? (
        <>
          <AnswerInput value={text} onChange={setText} onEnter={() => all(text, 'work')} autoFocus />
          <EfficiencyPicker label="Efficiency" value={efficiency} onChange={setEfficiency} testId="account-efficiency" />
          <div className="flex flex-wrap items-center gap-2">
            <Btn pill variant="primary" data-testid="account-save" onClick={() => all(text, 'work')}>
              Save
            </Btn>
            <Btn pill data-testid="account-break" onClick={() => all(text, 'break')}>
              Break
            </Btn>
            {allSleep && (
              <Btn pill data-testid="account-sleep" onClick={() => all(text, 'sleep')}>
                Sleep
              </Btn>
            )}
            {p.lastAnswer && (
              <Btn pill variant="ghost" data-testid="account-same" title="Same as last" onClick={() => all(p.lastAnswer ?? '', 'work')}>
                <span className="max-w-[180px] truncate">Same: {p.lastAnswer}</span>
              </Btn>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex max-h-[260px] flex-col gap-2.5 overflow-y-auto pr-1">
            {p.blocks.map((b, i) => (
              <div key={b.id} data-testid="account-row" className="flex flex-col gap-1">
                <BlockLine
                  b={b}
                  right={
                    row(b.id).as === 'work' && (
                      <EfficiencyPicker value={row(b.id).efficiency} onChange={(e) => setRow(b.id, { efficiency: e })} testId="account-row-efficiency" />
                    )
                  }
                />
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <AnswerInput value={row(b.id).text} onChange={(v) => setRow(b.id, { text: v })} onEnter={saveEach} autoFocus={i === 0} />
                  </div>
                  <Btn
                    size="sm"
                    variant={row(b.id).as === 'break' ? 'outline' : 'secondary'}
                    data-testid="account-row-break"
                    onClick={() => setRow(b.id, { as: row(b.id).as === 'break' ? 'work' : 'break' })}
                  >
                    Break
                  </Btn>
                  {b.sleep && (
                    <Btn
                      size="sm"
                      variant={row(b.id).as === 'sleep' ? 'outline' : 'secondary'}
                      data-testid="account-row-sleep"
                      onClick={() => setRow(b.id, { as: row(b.id).as === 'sleep' ? 'work' : 'sleep' })}
                    >
                      Sleep
                    </Btn>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Btn pill variant="primary" data-testid="account-save" onClick={saveEach}>
              Save
            </Btn>
            <span className="text-[11px] text-muted">Blocks left empty stay for later.</span>
          </div>
        </>
      )}
      {error && <div className="text-[12px] text-red">{error}</div>}
      <Improves v={p.improves} />
      <Asks p={p} />
    </Card>
  );
}

/** P70: apps and sites these blocks used that still want the user's label. Optional: answering the block doesn't wait. */
function Asks({ p }: { p: AccountVM }) {
  const [done, setDone] = useState<string[]>([]);
  const asks = p.asks.filter((a) => !done.includes(a.key));
  if (!asks.length) return null;
  return (
    <div data-testid="prompt-asks" className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="caps text-muted">{p.askTitle}</span>
      {asks.map((a) => (
        <div key={a.key} data-testid="ask-row" className="flex flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
            <span className="truncate text-text">{a.key}</span>
            <span className="tnum shrink-0 text-faint">{dur(a.sec)}</span>
          </div>
          <CategoryButtons
            size="sm"
            current={a.category}
            onPick={(c) => {
              setDone((d) => [...d, a.key]);
              void window.spyder.saveRule({ ...a.ruleTarget, category: c });
            }}
          />
        </div>
      ))}
    </div>
  );
}

const cleanLines = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

/** P98: after a day ends, its wins and how I'll improve. Both optional: until something changes, the button skips. */
function ReflectCard({ p }: { p: ReflectVM }) {
  const [wins, setWins] = useState(p.wins.length ? p.wins : ['']);
  const [improves, setImproves] = useState(p.improves.length ? p.improves : ['']);
  const [error, setError] = useState<string | null>(null);
  const lists = { win: cleanLines(wins), improve: cleanLines(improves) };
  const changed = JSON.stringify(lists) !== JSON.stringify({ win: p.wins, improve: p.improves });
  const done = async () => setError(errText(await window.spyder.saveReflection(p.date, changed ? lists : null)));
  return (
    <Card testId="prompt-reflect" color="var(--color-green)" heading={p.heading}>
      <div className="text-[15px] font-semibold text-text">{p.title}</div>
      {/* P100: the lists scroll once the window reaches its tallest. */}
      <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto">
        <Lines label="Wins" testId="reflect-win" values={wins} onChange={setWins} placeholder="Something that went well" autoFocus />
        <Lines label="How I'll improve" testId="reflect-improve" values={improves} onChange={setImproves} placeholder="One thing to do differently" />
      </div>
      <div className="flex items-center gap-2">
        <Btn pill variant={changed ? 'primary' : 'secondary'} data-testid="reflect-done" onClick={() => void done()}>
          {changed ? 'Save' : 'Skip'}
        </Btn>
      </div>
      {error && <div className="text-[12px] text-red">{error}</div>}
    </Card>
  );
}

/** P100: up to this many lines a section. */
const MAX_LINES = 10;

/** One line per item: Enter or + Add adds a line (up to 10), Backspace on an empty line removes it. */
function Lines(props: { label: string; testId: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; autoFocus?: boolean }) {
  const { values, onChange } = props;
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (focus !== null) refs.current[focus]?.focus();
  }, [focus, values.length]);
  const full = values.length >= MAX_LINES;
  const addAfter = (i: number) => {
    if (full) return;
    onChange([...values.slice(0, i + 1), '', ...values.slice(i + 1)]);
    setFocus(i + 1);
  };
  return (
    <div data-testid={props.testId} className="flex flex-col gap-1">
      <span className="caps text-muted">{props.label}</span>
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="pt-[7px] text-[13px] leading-[18px] text-faint">•</span>
          <WrapInput
            inputRef={(el) => {
              refs.current[i] = el;
            }}
            data-testid="reflect-line"
            value={v}
            placeholder={props.placeholder}
            autoFocus={props.autoFocus && i === 0}
            onChange={(t) => onChange(values.map((x, j) => (j === i ? t : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault(); // never a line break (P101)
              if (e.key === 'Enter' && v.trim()) {
                addAfter(i);
              } else if (e.key === 'Backspace' && !v && values.length > 1) {
                e.preventDefault();
                onChange(values.filter((_, j) => j !== i));
                setFocus(Math.max(0, i - 1));
              }
            }}
            className="min-h-8 min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-2 py-[6px] text-[13px] text-text outline-none placeholder:text-faint hover:border-border focus:border-accent focus:bg-surface-2"
          />
        </div>
      ))}
      {!full && (
        <button type="button" data-testid="reflect-add" onClick={() => addAfter(values.length - 1)} className="h-7 self-start px-2 text-[12px] text-muted hover:text-text">
          + Add
        </button>
      )}
    </div>
  );
}

/** P99: what the user said they'd improve on the last day, until the first block of today is answered. */
function Improves({ v }: { v: ImprovesVM | null }) {
  if (!v) return null;
  return (
    <div data-testid="prompt-improves" className="flex flex-col gap-1 border-t border-border pt-3">
      <span className="caps text-muted">{v.title}</span>
      {v.items.map((t, i) => (
        <div key={i} className="flex gap-2 text-[13px] text-text">
          <span className="text-faint">•</span>
          <span className="min-w-0 break-words">{t}</span>
        </div>
      ))}
    </div>
  );
}

/** Work hours with no loop running (P59). */
function ReminderCard({ p }: { p: ReminderVM }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Card testId="prompt-reminder" color="var(--color-away)" heading={p.heading}>
      <div className="text-[15px] font-semibold text-text">{p.title}</div>
      <div className="text-[13px] text-muted">{p.body}</div>
      <div className="flex items-center gap-2">
        <Btn pill variant="primary" autoFocus data-testid="reminder-start" onClick={() => void window.spyder.start(p.lengthSec).then((r) => setError(errText(r)))}>
          Start
        </Btn>
        <Btn pill data-testid="reminder-later" onClick={() => void window.spyder.dismissReminder()}>
          Not now
        </Btn>
      </div>
      {error && <div className="text-[12px] text-red">{error}</div>}
      <Improves v={p.improves} />
    </Card>
  );
}
