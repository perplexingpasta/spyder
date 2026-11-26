// Visualizer (P88): today as a 24-hour star clock. A spinning ring of stars is the bar: a comet sits at now and the stars light up
// across the work hours passed; the bar's numbers sit in the middle. The block track and the app track radiate outward, the goal
// fills an inner ring. View only: it reads the same data as Today and changes nothing. Always a dark night sky, in both themes.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { appRuns, type DaySummary } from '../../core/aggregate';
import { fmtClock, fmtDuration, fmtTime } from '../../core/format';
import type { WidgetPayload } from '../../preload/api';
import { answerText, appColor, blockColor, useAppColors } from './Timeline';
import { CAT_LABEL, TopBar, useLoader } from './parts';
import { dur } from './stats';

const TAU = Math.PI * 2;
const C = 400; // the dial is drawn in a 800 × 800 box
const DAY = 86_400_000;
const R = { goal: 164, star: 194, flag: 216, blkIn: 224, blkOut: 254, appIn: 260, appOut: 284, tick: 292, label: 318 };
const SKY = '#0C0B14';
const LEGEND_MAX = 10;

const pt = (r: number, a: number): [number, number] => [C + r * Math.sin(a), C - r * Math.cos(a)];
const f = (n: number) => n.toFixed(2);
/** A ring segment from angle a0 to a1 (clockwise from the top). */
function arc(r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 >= TAU - 1e-4) a1 = a0 + TAU - 1e-4;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${big} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${big} 0 ${f(x3)} ${f(y3)}Z`;
}

// The stars: fixed, so the ring looks the same every time.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SR = rng(42);
const gauss = () => (SR() + SR() + SR() - 1.5) / 1.5;
const STARS = Array.from({ length: 520 }, () => ({ t: SR() * TAU, r: R.star + gauss() * 11, s: 0.35 + SR() ** 3 * 1.6, ph: SR() * TAU, tw: 0.6 + SR() * 2.2 }));
const SPARKS = Array.from({ length: 14 }, () => ({ t: SR() * TAU, r: R.star + gauss() * 6, s: 2.2 + SR() * 2.4, ph: SR() * TAU }));
const DUST = Array.from({ length: 260 }, () => {
  const a = SR() * TAU;
  const r = Math.sqrt(SR()) * 400;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a), s: 0.2 + SR() * 0.7, ph: SR() * TAU };
});

export function Visualizer() {
  // The day, and when it arrived, so now can move on between loads.
  const [day, reload] = useLoader(async () => ({ vm: await window.spyder.getDay(), at: Date.now() }), 'visualizer', true);
  const [w, setW] = useState<WidgetPayload | null>(null);
  useEffect(() => {
    void window.spyder.getWidget().then(setW);
    let last = '';
    return window.spyder.onWidget((p) => {
      setW(p);
      // Reload as soon as a block starts or ends or an answer lands, like Today.
      const k = [p.mode, p.blockId, p.pendingCount].join('|');
      if (k !== last) void reload();
      last = k;
    });
  }, [reload]);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!day) return <TopBar title="Visualizer" />;
  const vm = day.vm;
  // Now: the engine's clock while a block runs, else the day's load time moved on by the seconds since.
  const nowMs = w?.running && w.blockStartedMs !== null ? w.blockStartedMs + w.timerSec * 1000 : vm.nowMs + Math.max(0, clock - day.at);
  return (
    <>
      <TopBar title="Visualizer" />
      <StarClock s={vm.summary} w={w} nowMs={nowMs} />
    </>
  );
}

function StarClock({ s, w, nowMs }: { s: DaySummary; w: WidgetPayload | null; nowMs: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(600);
  const [tip, setTip] = useState<{ x: number; y: number; a: string; b: string } | null>(null);
  const [picked] = useAppColors();
  const uid = useId().replace(/:/g, '');

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setSize(Math.max(280, Math.min(el.clientWidth, el.clientHeight, 760)));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  const ang = (ms: number) => ((ms - s.dayStartMs) / DAY) * TAU;
  const win = s.window;
  const head = ang(nowMs);
  const lit = useRef({ from: 0, to: 0, head: 0 });
  const from = win ? ang(win.startMs) : 0;
  const to = win ? ang(Math.max(win.startMs, Math.min(nowMs, win.endMs))) : 0;
  useEffect(() => {
    lit.current = { from, to, head };
  });

  // The star ring, drawn every frame on the canvas under the dial.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    let rot = 0;
    let last = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const dt = Math.min(t - last, 100) / 1000;
      last = t;
      if (!still) rot += (dt * TAU) / 120;
      const { from, to, head: hd } = lit.current;
      const on = (a: number) => {
        const n = ((a % TAU) + TAU) % TAU;
        return n >= from && n <= to;
      };
      const time = t / 1000;
      ctx.setTransform((dpr * size) / 800, 0, 0, (dpr * size) / 800, 0, 0);
      ctx.clearRect(0, 0, 800, 800);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#C8C8E0';
      for (const d of DUST) {
        ctx.globalAlpha = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(time * 0.7 + d.ph));
        ctx.fillRect(d.x, d.y, d.s, d.s);
      }
      const halo = ctx.createRadialGradient(C, C, R.star - 30, C, C, R.star + 30);
      halo.addColorStop(0, 'rgba(123,97,255,0)');
      halo.addColorStop(0.5, 'rgba(123,97,255,.10)');
      halo.addColorStop(1, 'rgba(123,97,255,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(C, C, R.star + 30, 0, TAU);
      ctx.arc(C, C, R.star - 30, 0, TAU, true);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      if (to > from) {
        ctx.strokeStyle = 'rgba(123,97,255,.22)';
        ctx.lineWidth = 26;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(C, C, R.star, -Math.PI / 2 + from, -Math.PI / 2 + to);
        ctx.stroke();
      }
      for (const st of STARS) {
        const a = st.t + rot;
        const l = on(a);
        const tw = 0.55 + 0.45 * Math.sin(time * st.tw + st.ph);
        ctx.globalAlpha = (l ? 0.55 + 0.45 * tw : 0.18 + 0.45 * tw) * Math.min(1, st.s + 0.4);
        ctx.fillStyle = l ? '#CFC4FF' : '#DCE3FF';
        ctx.beginPath();
        ctx.arc(C + st.r * Math.sin(a), C - st.r * Math.cos(a), st.s * (l ? 1.25 : 1), 0, TAU);
        ctx.fill();
      }
      for (const sp of SPARKS) {
        const a = sp.t + rot;
        const l = on(a);
        const tw = 0.5 + 0.5 * Math.sin(time * 1.3 + sp.ph);
        const x = C + sp.r * Math.sin(a);
        const y = C - sp.r * Math.cos(a);
        const len = sp.s * (2.5 + 2 * tw) * (l ? 1.3 : 1);
        ctx.globalAlpha = l ? 0.95 : 0.55;
        ctx.strokeStyle = l ? '#D9D0FF' : '#E6EBFF';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x - len, y);
        ctx.lineTo(x + len, y);
        ctx.moveTo(x, y - len);
        ctx.lineTo(x, y + len);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x, y, sp.s * 0.55, 0, TAU);
        ctx.fill();
      }
      // The comet at now, its tail behind it.
      for (let k = 0; k < 40; k++) {
        const a = hd - k * 0.009;
        ctx.globalAlpha = (1 - k / 40) ** 2 * 0.7;
        ctx.fillStyle = '#B7A8FF';
        ctx.beginPath();
        ctx.arc(C + R.star * Math.sin(a), C - R.star * Math.cos(a), 3.2 * (1 - k / 40) + 0.4, 0, TAU);
        ctx.fill();
      }
      const hx = C + R.star * Math.sin(hd);
      const hy = C - R.star * Math.cos(hd);
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 22);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.18, 'rgba(201,189,255,.9)');
      g.addColorStop(1, 'rgba(123,97,255,0)');
      ctx.globalAlpha = still ? 1 : 0.85 + 0.15 * Math.sin(time * 4);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hx, hy, 22, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const tl = s.timeline;
  const running = w?.running ? w.blockId : null;
  const span = (a: number, b: number) => `${fmtTime(a)}–${fmtTime(b)} · ${fmtDuration((b - a) / 1000)}`;
  const runs = appRuns(tl.activity);
  const byApp = new Map<string, number>();
  for (const r of runs) byApp.set(r.key, (byApp.get(r.key) ?? 0) + r.endMs - r.startMs);
  const legend = [...byApp].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const tags = new Set(tl.segments.map((b) => b.tag));
  const curH = Math.floor(((nowMs - s.dayStartMs) / 3_600_000) % 24);
  const goalFrac = s.goalSec > 0 ? Math.min(1, (w?.productiveTodaySec ?? s.productiveSec) / s.goalSec) : 0;

  const onMove = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest<SVGElement>('[data-tip]');
    const box = stage.current?.getBoundingClientRect();
    if (!el || !box) return setTip(null);
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, a: el.dataset.tip ?? '', b: el.dataset.sub ?? '' });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ background: `radial-gradient(900px 600px at 50% 45%, #15112a 0%, ${SKY} 55%, #07070A 100%)` }} data-testid="visualizer">
      <div ref={wrap} className="flex min-h-0 flex-1 items-center justify-center px-6 pt-2">
        <div ref={stage} className="relative" style={{ width: size, height: size }} onMouseLeave={() => setTip(null)}>
          <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
          <svg viewBox="0 0 800 800" className="absolute inset-0 h-full w-full" onMouseMove={onMove} aria-label="Today as a 24-hour clock">
            <defs>
              <pattern id={`vh${uid}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={5} height={5} fill="rgba(94,94,104,.12)" />
                <rect width={1.6} height={5} fill="#5E5E68" />
              </pattern>
              <filter id={`vg${uid}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation={3.5} result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id={`vs${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation={6} />
              </filter>
            </defs>

            {/* Lanes: the whole day dim, work hours lit. */}
            {[
              [R.blkIn, R.blkOut],
              [R.appIn, R.appOut],
            ].map(([a, b]) => (
              <g key={a}>
                <circle cx={C} cy={C} r={(a + b) / 2} fill="none" stroke="rgba(236,236,239,.018)" strokeWidth={b - a} />
                {win && <path d={arc(a, b, ang(win.startMs), ang(win.endMs))} fill="rgba(236,236,239,.045)" />}
              </g>
            ))}

            {/* A tick every 15 min, longer each hour and at 00, 06, 12, 18; the hour labels. */}
            {Array.from({ length: 96 }, (_, q) => {
              const a = (q / 96) * TAU;
              const six = q % 24 === 0;
              const hour = q % 4 === 0;
              const [x0, y0] = pt(R.tick, a);
              const [x1, y1] = pt(R.tick + (six ? 12 : hour ? 8 : 3), a);
              return (
                <line key={q} x1={x0} y1={y0} x2={x1} y2={y1} stroke={six ? '#ECECEF' : hour ? '#8F8F99' : '#3a3a44'} strokeWidth={six ? 2 : hour ? 1.4 : 1} strokeLinecap="round" />
              );
            })}
            {Array.from({ length: 24 }, (_, h) => {
              const [x, y] = pt(R.label, (h / 24) * TAU);
              const cur = h === curH;
              const six = h % 6 === 0;
              return (
                <text
                  key={h}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={cur ? 18 : six ? 16 : 12}
                  fontWeight={cur || six ? 700 : 500}
                  fill={cur ? '#ECECEF' : six ? '#8F8F99' : '#5E5E68'}
                  className="tabular"
                >
                  {String(h).padStart(2, '0')}
                </text>
              );
            })}

            {/* Block track. */}
            {s.untracked.map((b, i) => (
              <path key={`u${i}`} d={arc(R.blkIn, R.blkOut, ang(b.startMs), ang(b.endMs))} fill={`url(#vh${uid})`} data-tip="Untracked" data-sub={span(b.startMs, b.endMs)} />
            ))}
            {tl.away.map((b, i) => (
              <path
                key={`w${i}`}
                d={arc(R.blkIn, R.blkOut, ang(b.startMs), ang(b.endMs))}
                fill="var(--color-away)"
                opacity={0.35}
                data-tip={b.classification ? `Away · ${b.label ?? b.classification}` : 'Away (not classified)'}
                data-sub={span(b.startMs, b.endMs)}
              />
            ))}
            {tl.segments.map((b, i) => {
              const isRun = b.sessionId === running;
              const end = isRun ? Math.max(b.endMs, nowMs) : b.endMs;
              const d = arc(R.blkIn, R.blkOut, ang(b.startMs), ang(end));
              return (
                <g key={`s${i}`}>
                  {isRun && <path d={d} fill="var(--color-accent)" opacity={0.5} filter={`url(#vs${uid})`} />}
                  <path
                    d={d}
                    data-block="viz-session"
                    fill={isRun ? 'var(--color-accent)' : blockColor(b)}
                    opacity={b.kind === 'break' ? 0.5 : 1}
                    stroke={SKY}
                    strokeWidth={0.8}
                    data-tip={isRun ? '● Running' : answerText(b)}
                    data-sub={isRun ? `${fmtTime(b.startMs)}–now · ${fmtDuration((end - b.startMs) / 1000)}` : span(b.startMs, b.endMs)}
                  />
                </g>
              );
            })}

            {/* App track. */}
            {runs.map((r, i) => (
              <path
                key={`a${i}`}
                d={arc(R.appIn, R.appOut, ang(r.startMs), ang(r.endMs))}
                data-block="viz-app"
                fill={appColor(picked, r.key, r.slot)}
                stroke={SKY}
                strokeWidth={0.6}
                data-tip={r.key}
                data-sub={`${CAT_LABEL[r.category]} · ${span(r.startMs, r.endMs)}`}
              />
            ))}

            {/* Distraction flags, pointing out at the block track. */}
            {s.flags.map((fl, i) => {
              const a = ang(fl.tsMs);
              const [tx, ty] = pt(R.flag + 4, a);
              const [lx, ly] = pt(R.flag - 4, a - 0.018);
              const [rx, ry] = pt(R.flag - 4, a + 0.018);
              return (
                <path
                  key={`f${i}`}
                  d={`M${f(tx)} ${f(ty)}L${f(lx)} ${f(ly)}L${f(rx)} ${f(ry)}Z`}
                  fill="var(--color-red)"
                  data-tip={`Distracted: ${fl.target}`}
                  data-sub={`${fmtTime(fl.tsMs)} · ${fmtDuration(fl.continuousSec)} straight`}
                />
              );
            })}

            {/* Goal ring: productive time ÷ the daily goal. */}
            <circle cx={C} cy={C} r={R.goal} fill="none" stroke="rgba(236,236,239,.06)" strokeWidth={2} />
            {goalFrac > 0 && (
              <circle
                cx={C}
                cy={C}
                r={R.goal}
                fill="none"
                stroke={goalFrac >= 1 ? 'var(--color-green)' : '#B7A8FF'}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeDasharray={`${f(goalFrac * TAU * R.goal)} 9999`}
                transform={`rotate(-90 ${C} ${C})`}
                opacity={0.85}
                data-tip={`Goal ${Math.round(goalFrac * 100)}%`}
                data-sub={`${dur(w?.productiveTodaySec ?? s.productiveSec)} of ${dur(s.goalSec)}`}
              />
            )}

            {/* Now hand. */}
            {nowMs >= s.dayStartMs && nowMs < s.dayEndMs && (
              <g filter={`url(#vg${uid})`} data-testid="viz-now">
                <line x1={pt(R.blkIn - 12, head)[0]} y1={pt(R.blkIn - 12, head)[1]} x2={pt(R.tick + 14, head)[0]} y2={pt(R.tick + 14, head)[1]} stroke="#C9BDFF" strokeWidth={2} strokeLinecap="round" />
                <circle cx={pt(R.tick + 14, head)[0]} cy={pt(R.tick + 14, head)[1]} r={4.5} fill="#ECECEF" />
              </g>
            )}
          </svg>
          <Readout w={w} size={size} nowMs={nowMs} />
          {tip && (
            <div
              className="pointer-events-none absolute z-10 rounded-control border px-2.5 py-1.5 text-[12px] whitespace-nowrap tabular"
              style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, calc(-100% - 12px))', background: 'rgba(20,20,23,.94)', borderColor: '#313138', color: '#ECECEF', boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}
            >
              <div className="font-medium">{tip.a}</div>
              <div style={{ color: '#8F8F99' }}>{tip.b}</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1.5 px-6 pt-2 pb-5 text-[11px]" style={{ color: '#8F8F99' }}>
        <div className="flex flex-wrap justify-center gap-x-3.5 gap-y-1">
          <span className="font-semibold" style={{ color: '#5E5E68' }}>
            Block track
          </span>
          <Key color="var(--color-work)" label="Work" />
          <Key color="var(--color-open)" label="Not accounted for" />
          <Key color="var(--color-break)" label="Break" />
          {tags.has('gym') && <Key color="var(--color-gym)" label="Gym" />}
          {tags.has('food') && <Key color="var(--color-food)" label="Food" />}
          {tags.has('sleep') && <Key color="var(--color-sleep)" label="Sleep" />}
          <Key color="repeating-linear-gradient(45deg,#5E5E68 0 2px,transparent 2px 4px)" label="Untracked" />
        </div>
        {legend.length > 0 && (
          <div className="flex max-w-[760px] flex-wrap justify-center gap-x-3.5 gap-y-1" data-testid="viz-app-legend">
            <span className="font-semibold" style={{ color: '#5E5E68' }}>
              App track
            </span>
            {legend.slice(0, LEGEND_MAX).map(([key]) => (
              <Key key={key} color={appColor(picked, key, runs.find((r) => r.key === key)!.slot)} label={key} />
            ))}
            {legend.length > LEGEND_MAX && <span style={{ color: '#5E5E68' }}>+{legend.length - LEGEND_MAX} more</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex max-w-[180px] items-center gap-1.5">
      <i className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The bar's numbers in the middle of the dial (P43, P63, P82): block timer, productive today, percent of goal or day. */
function Readout({ w, size, nowMs }: { w: WidgetPayload | null; size: number; nowMs: number }) {
  if (!w) return null;
  const u = size / 100; // 1 % of the dial
  const [cap, timer, tone] = w.running
    ? w.isDistracted
      ? [`Distracted · ${w.distractTarget ?? ''}`, fmtClock(w.timerSec), '#EF5157']
      : [`Block · of ${fmtDuration(w.blockLengthSec)}`, fmtClock(w.timerSec), '#ECECEF']
    : w.notStarted
      ? ['Press Start in Spyder', 'Not started', '#F2A33A']
      : [w.isDayOff ? 'Day off' : w.workdayPct >= 100 ? 'Workday done' : 'Before work hours', 'Off hours', '#8F8F99'];
  const pctText = w.goalPct ? `${Math.round((w.productiveTodaySec / w.goalSec) * 100)}%` : w.isDayOff ? '–' : `${Math.round(w.workdayPct)}%`;
  const met = w.productiveTodaySec >= w.goalSec;
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 text-center" style={{ gap: 1.2 * u }} data-testid="viz-readout">
      <div className="truncate font-bold uppercase" style={{ fontSize: Math.max(9, 1.45 * u), letterSpacing: '.14em', color: tone === '#ECECEF' ? '#8F8F99' : tone, maxWidth: 34 * u }}>
        {cap}
      </div>
      <div
        data-testid="viz-timer"
        className="font-semibold tabular"
        style={{ fontSize: (w.running ? 10.5 : 6) * u, lineHeight: 0.95, letterSpacing: '-0.02em', color: tone, textShadow: w.running ? `0 0 ${3 * u}px rgba(123,97,255,.45)` : 'none' }}
      >
        {timer}
      </div>
      <div className="flex justify-center tabular" style={{ gap: 2.6 * u }}>
        <div className="grid" style={{ gap: 0.3 * u }}>
          <b style={{ fontSize: Math.max(12, 2.6 * u), color: met ? 'var(--color-green)' : '#B7A8FF' }}>{dur(w.productiveTodaySec)}</b>
          <span className="font-bold uppercase" style={{ fontSize: Math.max(8, 1.2 * u), letterSpacing: '.1em', color: '#5E5E68' }}>
            Productive
          </span>
        </div>
        <div className="grid" style={{ gap: 0.3 * u }}>
          <b style={{ fontSize: Math.max(12, 2.6 * u), color: '#ECECEF' }}>{pctText}</b>
          <span className="font-bold uppercase" style={{ fontSize: Math.max(8, 1.2 * u), letterSpacing: '.1em', color: '#5E5E68' }}>
            {w.goalPct ? 'Of goal' : 'Of day'}
          </span>
        </div>
      </div>
      <div className="tabular" style={{ fontSize: Math.max(10, 1.6 * u), letterSpacing: '.06em', color: '#5E5E68' }}>
        {fmtTime(nowMs)}
      </div>
    </div>
  );
}
