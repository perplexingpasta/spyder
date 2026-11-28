// The "How I'll improve" gadget (P107, design/DESIGN.md §2b): gadget rows on the desktop, never above an app.
import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  gadgetDate,
  LABEL_COLORS,
  orderRows,
  type GadgetRow,
  type ImportDay,
  type LabelColor,
} from '../../core/gadget';
import type { GadgetPayload, GadgetRowPatch } from '../../preload/api';
import { applyGlassTint } from '../dashboard/parts';
import { Btn, WrapInput } from '../ui/controls';

const UNDO_MS = 5000;

export function Gadget() {
  const [g, setG] = useState<GadgetPayload | null>(null);
  const [view, setView] = useState<'list' | 'import'>('list');
  useEffect(() => {
    // The glass frame follows Settings → Glass tint (P90), re-read with each push and on focus.
    const tint = () => void window.spyder.getSettings().then(applyGlassTint);
    const show = (p: GadgetPayload) => {
      setG(p);
      tint();
    };
    window.addEventListener('focus', tint);
    void window.spyder.getGadget().then(show);
    const off = window.spyder.onGadget(show);
    return () => {
      off();
      window.removeEventListener('focus', tint);
    };
  }, []);
  if (!g) return null;
  return view === 'import' ? (
    <ImportView today={g.today} onDone={() => setView('list')} />
  ) : (
    <RowsView g={g} setG={setG} onImport={() => setView('import')} />
  );
}

// ---- The rows -----------------------------------------------------------------------------------

function RowsView({
  g,
  setG,
  onImport,
}: {
  g: GadgetPayload;
  setG: (g: GadgetPayload) => void;
  onImport: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Esc ends the draft before any blur that follows, so that blur mustn't save it. */
  const draftEnded = useRef(false);
  const ticked = g.rows.filter((r) => r.tickedMs !== null).length;

  /** Optimistic: the push from main settles it. */
  const patch = (id: string, p: GadgetRowPatch) => {
    const rows = g.rows
      .map((r) =>
        r.id !== id
          ? r
          : {
              ...r,
              ...(p.text !== undefined && { text: p.text }),
              ...(p.color !== undefined && { color: p.color }),
              ...(p.ticked !== undefined && { tickedMs: p.ticked ? Date.now() : null }),
            },
      )
      .filter((r) => !(r.id === id && (p.removed || p.text?.trim() === '')));
    setG({ ...g, rows: orderRows(rows) });
    void window.spyder.editGadgetRow(id, p);
  };
  const remove = (id: string) => {
    patch(id, { removed: true });
    setConfirm(false);
    setUndo(id);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };
  const saveDraft = (text: string, again: boolean) => {
    if (text.trim()) void window.spyder.addGadgetRow(text);
    setDraft(again && text.trim() ? '' : null);
  };
  const saveEdit = (id: string, text: string) => {
    setEditing(null);
    const row = g.rows.find((r) => r.id === id);
    if (!row || text === row.text) return;
    if (text.trim()) patch(id, { text });
    else remove(id);
  };

  return (
    <div className="flex h-screen flex-col text-text">
      <Header title="How I'll improve">
        <IconBtn testId="gadget-add" title="Add" onClick={() => setDraft((d) => d ?? '')}>
          <path d="M8 3v10M3 8h10" />
        </IconBtn>
        <IconBtn testId="gadget-import" title="Import from a past review" onClick={onImport}>
          <path d="M8 2.5v7M5 6.5l3 3 3-3M2.5 10.5v2.5h11v-2.5" />
        </IconBtn>
        {ticked > 0 && (
          <IconBtn testId="gadget-clear" title="Clear ticked" onClick={() => setConfirm(true)}>
            <path d="M3 8.5l3 3 7-7M2 13.5h12" />
          </IconBtn>
        )}
        <IconBtn
          testId="gadget-minimize"
          title="Minimize to the tray"
          onClick={() => void window.spyder.minimizeGadget()}
        >
          <path d="M3.5 8h9" />
        </IconBtn>
      </Header>
      <div data-testid="gadget-list" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {draft !== null && (
          <div
            data-testid="gadget-draft"
            className="gadget-row flex items-start gap-2.5 rounded-control px-3 py-1.5"
            data-color=""
          >
            <Box checked={false} disabled />
            <WrapInput
              autoFocus
              data-testid="gadget-draft-input"
              value={draft}
              placeholder="How will you improve?"
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveDraft(draft, true);
                } else if (e.key === 'Escape') {
                  draftEnded.current = true;
                  setDraft(null);
                }
              }}
              onFocus={() => (draftEnded.current = false)}
              onBlur={() => !draftEnded.current && saveDraft(draft, false)}
              className={EDIT_CLASS}
            />
            <span className="shrink-0 pt-px text-[12px] text-faint tabular">
              {gadgetDate(g.today, g.today)}
            </span>
          </div>
        )}
        {g.rows.map((r) => (
          <Row
            key={r.id}
            r={r}
            today={g.today}
            editing={editing?.id === r.id ? editing.text : null}
            onEdit={(text) => setEditing({ id: r.id, text })}
            onSave={(text) => saveEdit(r.id, text)}
            onCancel={() => setEditing(null)}
            onTick={() => patch(r.id, { ticked: r.tickedMs === null })}
            onMenu={(x, y) => setMenu({ id: r.id, x, y })}
            onRemove={() => remove(r.id)}
          />
        ))}
        {!g.rows.length && draft === null && (
          <div
            data-testid="gadget-empty"
            className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
          >
            <span className="text-[13px] text-muted">Nothing to improve yet</span>
            <span className="text-[12px] text-faint">+ to write one, or Import from a past review</span>
          </div>
        )}
      </div>
      {menu && (
        <ColorMenu
          at={menu}
          current={g.rows.find((r) => r.id === menu.id)?.color ?? null}
          onPick={(c) => {
            patch(menu.id, { color: c });
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {confirm ? (
        <Bar testId="gadget-clear-confirm">
          <span className="flex-1">
            Remove {ticked} ticked {ticked === 1 ? 'row' : 'rows'}?
          </span>
          <Btn
            size="sm"
            variant="danger"
            data-testid="gadget-clear-go"
            onClick={() => {
              setConfirm(false);
              setG({ ...g, rows: g.rows.filter((r) => r.tickedMs === null) });
              void window.spyder.clearTicked();
            }}
          >
            Remove
          </Btn>
          <Btn size="sm" variant="ghost" data-testid="gadget-clear-cancel" onClick={() => setConfirm(false)}>
            Cancel
          </Btn>
        </Bar>
      ) : (
        undo && (
          <Bar testId="gadget-undo">
            <span className="flex-1">Removed</span>
            <button
              type="button"
              data-testid="gadget-undo-btn"
              className="cursor-pointer font-medium text-accent hover:underline"
              onClick={() => {
                void window.spyder.editGadgetRow(undo, { removed: false });
                setUndo(null);
              }}
            >
              Undo
            </button>
          </Bar>
        )
      )}
    </div>
  );
}

const EDIT_CLASS =
  'no-drag min-w-0 flex-1 rounded-chip bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] px-1 -mx-1 text-[13px] text-text outline outline-1 outline-accent/40 placeholder:text-faint focus:outline-accent/40';

function Row(p: {
  r: GadgetRow;
  today: string;
  editing: string | null;
  onEdit: (text: string) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  onTick: () => void;
  onMenu: (x: number, y: number) => void;
  onRemove: () => void;
}) {
  const { r } = p;
  const done = r.tickedMs !== null;
  /** Enter and Esc end the edit before the blur that follows, so the blur mustn't save again. */
  const ended = useRef(false);
  return (
    <div
      data-testid="gadget-row"
      data-ticked={done}
      data-color={r.color ?? ''}
      className="gadget-row group mb-0.5 flex items-start gap-2.5 rounded-control px-3 py-1.5"
      onContextMenu={(e) => {
        e.preventDefault();
        p.onMenu(e.clientX, e.clientY);
      }}
    >
      <Box checked={done} onClick={p.onTick} />
      {p.editing !== null ? (
        <WrapInput
          autoFocus
          data-testid="gadget-edit"
          value={p.editing}
          onChange={p.onEdit}
          onFocus={(e) => {
            ended.current = false;
            const t = e.currentTarget;
            t.setSelectionRange(t.value.length, t.value.length);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              ended.current = true;
              p.onSave(p.editing!);
            } else if (e.key === 'Escape') {
              ended.current = true;
              p.onCancel();
            }
          }}
          onBlur={() => !ended.current && p.onSave(p.editing!)}
          className={EDIT_CLASS}
        />
      ) : (
        <span
          data-testid="gadget-text"
          className={clsx(
            'min-w-0 flex-1 cursor-text leading-[18px] [overflow-wrap:anywhere]',
            done && 'text-muted line-through',
          )}
          onClick={() => p.onEdit(r.text)}
        >
          {r.text}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          data-testid="gadget-color"
          aria-label="Colour label"
          title="Colour label"
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-chip opacity-0 group-hover:opacity-100 hover:bg-surface-2 focus-visible:opacity-100"
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            p.onMenu(b.left, b.bottom + 4);
          }}
        >
          <span
            className="h-2.5 w-2.5 rounded-full border border-border-strong"
            style={
              r.color
                ? { background: `var(--color-label-${r.color})`, borderColor: 'transparent' }
                : undefined
            }
          />
        </button>
        <button
          type="button"
          data-testid="gadget-remove"
          aria-label="Remove"
          title="Remove"
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-chip text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-text focus-visible:opacity-100"
          onClick={p.onRemove}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <span data-testid="gadget-date" className="ml-1 pt-px text-[12px] leading-[18px] text-faint tabular">
          {gadgetDate(r.date, p.today)}
        </span>
      </span>
    </div>
  );
}

function ColorMenu({
  at,
  current,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  current: LabelColor | null;
  onPick: (c: LabelColor | null) => void;
  onClose: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  // Kept inside the window.
  useLayoutEffect(() => {
    const m = el.current;
    if (!m) return;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    setPos({
      left: Math.max(4, Math.min(at.x, window.innerWidth - w - 4)),
      top: Math.max(4, Math.min(at.y, window.innerHeight - h - 4)),
    });
  }, [at.x, at.y]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const down = (e: MouseEvent) => !el.current?.contains(e.target as Node) && onClose();
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', down);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('mousedown', down);
    };
  }, [onClose]);
  const swatch = (c: LabelColor | null) => (
    <button
      key={c ?? 'none'}
      type="button"
      data-testid={`gadget-swatch-${c ?? 'none'}`}
      aria-label={c ?? 'None'}
      title={c ? c[0].toUpperCase() + c.slice(1) : 'None'}
      onClick={() => onPick(c)}
      className={clsx(
        'flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full',
        current === c && 'ring-2 ring-text ring-offset-1 ring-offset-surface',
      )}
      style={c ? { background: `var(--color-label-${c})` } : undefined}
    >
      {!c && (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="text-muted">
          <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4 14L14 4" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
    </button>
  );
  return (
    <div
      ref={el}
      data-testid="gadget-color-menu"
      className="fixed z-20 flex gap-2 rounded-control bg-surface p-1.5 shadow-pop"
      style={pos}
    >
      {LABEL_COLORS.map(swatch)}
      {swatch(null)}
    </div>
  );
}

// ---- Import ---------------------------------------------------------------------------------------

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** `THU, NOV 27`. */
function dayLine(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${DAYS[new Date(y, m - 1, d).getDay()]}, ${gadgetDate(date, today).toUpperCase()}`;
}

function ImportView({ today, onDone }: { today: string; onDone: () => void }) {
  const [days, setDays] = useState<ImportDay[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    void window.spyder.gadgetImportList().then(setDays);
  }, []);
  const key = (date: string, sort: number) => `${date}|${sort}`;
  const toggle = (keys: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      for (const k of keys) {
        if (on) n.add(k);
        else n.delete(k);
      }
      return n;
    });
  const go = async () => {
    const items = (days ?? []).flatMap((d) =>
      d.items
        .filter((it) => picked.has(key(d.date, it.sort)))
        .map((it) => ({ date: d.date, text: it.text, sort: it.sort })),
    );
    await window.spyder.importGadgetRows(items);
    onDone();
  };
  return (
    <div data-testid="gadget-import-view" className="flex h-screen flex-col text-text">
      <Header
        title="Import"
        back={
          <IconBtn testId="gadget-import-back" title="Back" onClick={onDone}>
            <path d="M10 3.5L5.5 8l4.5 4.5" />
          </IconBtn>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {days && !days.length && (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">
            No past improvements yet
          </div>
        )}
        {days?.map((d) => {
          const open = d.items.filter((it) => !it.added).map((it) => key(d.date, it.sort));
          const all = open.length > 0 && open.every((k) => picked.has(k));
          return (
            <div key={d.date} data-testid="gadget-import-day" data-date={d.date} className="mb-2">
              <div className="flex items-center px-3 pt-2 pb-1">
                <span className="caps flex-1 text-muted">{dayLine(d.date, today)}</span>
                {open.length > 0 && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
                    All
                    <Box testId="gadget-import-all" checked={all} onClick={() => toggle(open, !all)} />
                  </label>
                )}
              </div>
              {d.items.map((it) => {
                const k = key(d.date, it.sort);
                return (
                  <div
                    key={k}
                    data-testid="gadget-import-item"
                    data-added={it.added}
                    className="flex items-start gap-2.5 rounded-control px-3 py-1.5"
                  >
                    {it.added ? (
                      <span className="shrink-0 pt-px text-[11px] leading-[18px] text-faint">added</span>
                    ) : (
                      <Box checked={picked.has(k)} onClick={() => toggle([k], !picked.has(k))} />
                    )}
                    <span
                      className={clsx(
                        'min-w-0 flex-1 leading-[18px] [overflow-wrap:anywhere]',
                        it.added && 'text-faint',
                      )}
                    >
                      {it.text}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 pt-1 pb-3">
        <Btn
          pill
          variant="primary"
          data-testid="gadget-import-go"
          disabled={!picked.size}
          onClick={() => void go()}
        >
          Import {picked.size}
        </Btn>
        <Btn pill variant="ghost" onClick={onDone}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}

// ---- Parts ----------------------------------------------------------------------------------------

function Header({ title, back, children }: { title: string; back?: ReactNode; children?: ReactNode }) {
  return (
    <div data-testid="gadget-header" className="drag flex h-9 shrink-0 items-center gap-0.5 px-3">
      {back}
      <span className="caps flex-1 truncate text-muted">{title}</span>
      {children}
    </div>
  );
}

function IconBtn({
  testId,
  title,
  onClick,
  children,
}: {
  testId: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={title}
      title={title}
      onClick={onClick}
      className="no-drag flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted outline-none hover:bg-surface-2 hover:text-text focus-visible:bg-surface-2"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

function Box({
  checked,
  onClick,
  disabled,
  testId = 'gadget-check',
}: {
  checked: boolean;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'no-drag mt-px flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-chip border-[1.5px] disabled:cursor-default disabled:opacity-50',
        // Text at 35 % rather than border-strong, so the box still shows on a tinted row in light.
        checked
          ? 'border-accent bg-accent text-on-accent'
          : 'border-[color-mix(in_srgb,var(--color-text)_35%,transparent)]',
      )}
    >
      {checked && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2 5.2l2 2 4-4.4" />
        </svg>
      )}
    </button>
  );
}

function Bar({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="mx-2 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-control bg-surface px-3 text-[12px] shadow-pop"
    >
      {children}
    </div>
  );
}
