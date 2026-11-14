import { useEffect, useMemo, useRef, useState } from 'react';
import { INTERVALS, fetchCandles, markersFor, priceTicks, rangeOf, type Candle, type CandleSource, type Interval } from '@kumi-avax/sdk';
import { useLive } from '../lib/chain';
import { Notice } from './bits';

type Trade = { price: bigint; size: bigint; takerBuy: boolean; ts: number };
type Slot = Candle & { empty?: boolean };
const IV: Interval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];
const COUNT = 110;
const AXIS = 76, TOP = 10, VOL = 54, TIME = 24, GAP = 2;

const fmt = (v: number, dp: number) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const vol = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(v >= 10 ? 0 : 2));
const clock = (t: number, sec: number) => {
  const d = new Date(t * 1000);
  if (sec >= 86400) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (sec >= 21600) return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * Kumi's price chart on the web, the same data and look as the phone: the coin's public exchange candles (Coinbase,
 * Binance as a fallback, the source linked in the legend), Chainlink's Fuji mark as a dashed plum line where KumiPerps
 * lists the market, and Kumi's own KumiPerps fills as ink triangles. Drawn at the box's real pixel width (no stretched
 * text), full-width glowing bodies, a volume row on the same columns, a crosshair with the price and time on the axes,
 * and a timeframe switch that keeps the old candles (stepped back) until the new ones arrive.
 */
export function Candles({ symbol, dp, trades = [], oracle, height: tall = 380 }: { symbol: string; dp: number; trades?: Trade[]; oracle?: number; height?: number }) {
  const [iv, setIv] = useState<Interval>('5m');
  const [hover, setHover] = useState<{ i: number; y: number } | null>(null);
  const [w, setW] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e?.contentRect.width ?? 0)));
    ro.observe(host.current);
    return () => ro.disconnect();
  }, []);
  const live = useLive(() => fetchCandles(symbol, iv, COUNT).then(r => ({ ...r, key: `${symbol}:${iv}` })), [symbol, iv], 20_000);
  const kept = useRef<{ key: string; candles: Candle[]; source: CandleSource; sec: number } | null>(null);
  if (live.data) kept.current = { ...live.data, sec: INTERVALS[iv] };
  if (kept.current && !kept.current.key.startsWith(`${symbol}:`)) kept.current = null;
  const shown = kept.current;
  const pending = !!shown && shown.key !== `${symbol}:${iv}`;
  const sec = shown?.sec ?? INTERVALS[iv];

  // Fewer, wider candles and a shorter box on a narrow (phone-width) page.
  const count = w && w < 560 ? 48 : COUNT;
  const height = w && w < 560 ? 300 : tall;
  const candles = useMemo(() => {
    const cs: Slot[] = [...(shown?.candles ?? [])];
    const last = cs[cs.length - 1];
    if (!last) return cs;
    const now = Math.floor(Date.now() / 1000 / sec) * sec;
    for (let t = last.t + sec, k = 0; t <= now && k < 3; t += sec, k++) cs.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: 0, empty: true });
    return cs.slice(-count);
  }, [shown, sec, count]);
  const fills = useMemo(() => trades.map(t => ({ ts: t.ts, price: Number(t.price) / 1e8, size: Number(t.size) / 1e18, takerBuy: t.takerBuy })), [trades]);
  const marks = useMemo(() => (pending ? [] : markersFor(candles, fills, sec)), [candles, fills, sec, pending]);

  const axis = w && w < 560 ? 62 : AXIS;
  const plotW = Math.max(0, w - axis);
  const plotH = height - TOP - VOL - TIME - 8;
  const real = candles.filter(c => !c.empty);
  const { min, max } = rangeOf(real, [...marks.map(m => m.price), ...(oracle ? [oracle] : [])], 0.08);
  const y = (p: number) => TOP + (1 - (p - min) / (max - min || 1)) * plotH;
  const pAt = (yy: number) => min + (1 - (yy - TOP) / plotH) * (max - min);
  const pitch = candles.length ? plotW / candles.length : 0;
  const body = Math.max(1.5, pitch - GAP);
  const cx = (i: number) => i * pitch + pitch / 2;
  const volTop = TOP + plotH + 8;
  const vmax = Math.max(1e-12, ...candles.map(c => c.v));
  const ticks = priceTicks(min, max, 5);
  const lastIdx = candles.map(c => !c.empty).lastIndexOf(true);
  const last = lastIdx >= 0 ? candles[lastIdx] : undefined;
  const first = real[0];
  const sel = hover && candles[hover.i] && !candles[hover.i]!.empty ? candles[hover.i]! : undefined;
  const change = last && first ? ((last.c - first.o) / first.o) * 100 : 0;
  const yO = oracle !== undefined && oracle >= min && oracle <= max ? y(oracle) : undefined;
  const yL = last ? y(last.c) : undefined;
  const lastChip = yL !== undefined && (yO === undefined || Math.abs(yL - yO) > 22);
  const nTime = Math.max(2, Math.min(7, Math.floor(plotW / 120)));
  const timeIdx = candles.length ? Array.from({ length: nTime }, (_, k) => Math.round((k * (candles.length - 1)) / (nTime - 1))) : [];
  const chip = (yy: number, text: string, cls: string) => <g className={cls}><rect x={plotW + 4} y={yy - 11} width={axis - 6} height={22} rx={11} /><text x={plotW + 4 + (axis - 6) / 2} y={yy + 4} textAnchor="middle">{text}</text></g>;

  return <div className="cndl">
    <div className="cndl-head">
      <div className="cndl-price">
        {last ? <>
          <b className="mono">${fmt(sel ? sel.c : last.c, dp)}</b>
          {!sel && <span className={`cndl-chg mono ${change >= 0 ? 'up' : 'down'}`}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>}
          <span className="cndl-ohlc mono">{sel
            ? <>{clock(sel.t, sec)} · O {fmt(sel.o, dp)} H {fmt(sel.h, dp)} L {fmt(sel.l, dp)} <b className={sel.c >= sel.o ? 'up' : 'down'}>C {fmt(sel.c, dp)}</b> · vol {vol(sel.v)}</>
            : `${real.length} × ${iv} candles · vol ${vol(real.reduce((a, c) => a + c.v, 0))} ${symbol}`}</span>
        </> : <b className="mono faint">–</b>}
      </div>
      <div className="seg cndl-iv" role="group" aria-label="Candle interval">{IV.map(k => <button key={k} aria-pressed={iv === k} onClick={() => { setIv(k); setHover(null); }}>{k.toUpperCase()}</button>)}</div>
    </div>
    <div ref={host} className="cndl-box" style={{ height }}>
      {live.error && !shown && <Notice error>Candles unavailable: {live.error}.{oracle !== undefined ? ' The book and fills are still live from Fuji.' : ''}</Notice>}
      {!shown && !live.error && <div className="skeleton" style={{ height }} />}
      {w > 0 && candles.length > 0 && <svg className="cndl-svg" width={w} height={height} role="img" aria-label={`${symbol} ${iv} candles from ${shown!.source.name}`}
        onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left, yy = e.clientY - r.top; setHover(x < plotW && pitch ? { i: Math.min(candles.length - 1, Math.max(0, Math.floor(x / pitch))), y: Math.min(TOP + plotH, Math.max(TOP, yy)) } : null); }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <filter id="kg-up" x="-60%" y="-30%" width="220%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor="#3ddc97" floodOpacity=".5" /></filter>
          <filter id="kg-down" x="-60%" y="-30%" width="220%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor="#ff8fc7" floodOpacity=".5" /></filter>
          <linearGradient id="kg-plot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff9f1" stopOpacity="0" /><stop offset="1" stopColor="#fbe9d4" stopOpacity=".55" /></linearGradient>
        </defs>
        <rect x={0} y={TOP} width={plotW} height={plotH} rx={12} fill="url(#kg-plot)" />
        {ticks.map(t => <g key={t}><line x1={0} x2={plotW} y1={y(t)} y2={y(t)} className="c-grid" />
          {[yO, lastChip ? yL : undefined, hover ? hover.y : undefined].every(v => v === undefined || Math.abs(y(t) - v) > 16) && <text x={plotW + 10} y={y(t) + 4} className="d-axis">{fmt(t, dp)}</text>}</g>)}
        {timeIdx.map((i, k) => <line key={k} x1={cx(i)} x2={cx(i)} y1={TOP} y2={TOP + plotH} className="c-grid c-vgrid" />)}
        <line x1={0} x2={plotW} y1={volTop - 4} y2={volTop - 4} className="c-sep" />
        <g key={shown!.key} className={`c-series ${pending ? 'pending' : ''}`}>
          {candles.map((c, i) => {
            if (c.empty) return null;
            const up = c.c >= c.o, x = cx(i), vh = Math.max(1, (c.v / vmax) * (VOL - 6));
            const dim = hover !== null && hover.i !== i;
            const by = Math.min(y(c.o), y(c.c)), bh = Math.max(1.6, Math.abs(y(c.c) - y(c.o)));
            return <g key={c.t} className={up ? 'c-up' : 'c-down'} opacity={dim ? 0.4 : 1}>
              <rect x={x - body / 2} y={volTop + VOL - 6 - vh} width={body} height={vh} rx={Math.min(1.5, body / 3)} className="c-vol" />
              <rect x={x - 0.8} y={y(c.h)} width={1.6} height={Math.max(1, y(c.l) - y(c.h))} rx={0.8} className="c-wick" />
              <rect x={x - body / 2} y={by} width={body} height={bh} rx={Math.min(2.5, body / 2.6)} className="c-body" filter={dim ? undefined : `url(#kg-${up ? 'up' : 'down'})`} />
            </g>;
          })}
          {marks.map((m, i) => { const idx = candles.findIndex(c => c.t === m.t); if (idx < 0) return null; const x = Math.min(plotW - 8, Math.max(8, cx(idx))); const yy = y(m.price);
            return <path key={i} d={m.takerBuy ? `M${x} ${yy + 2} l6.5 10 h-13z` : `M${x} ${yy - 2} l6.5 -10 h-13z`} className="c-mk"><title>{`Kumi fill on KumiPerps: ${m.takerBuy ? 'buy' : 'sell'} ${m.size} ${symbol} at ${m.price}`}</title></path>; })}
        </g>
        {yL !== undefined && !pending && <g className="c-last">
          <line x1={0} x2={plotW} y1={yL} y2={yL} />
          <circle cx={cx(lastIdx)} cy={yL} r={7} className="c-last-halo" /><circle cx={cx(lastIdx)} cy={yL} r={3.5} className="c-last-dot" />
        </g>}
        {yL !== undefined && !pending && lastChip && chip(yL, fmt(last!.c, dp), 'c-chip c-chip-last')}
        {yO !== undefined && <><line x1={0} x2={plotW} y1={yO} y2={yO} className="d-oracle" />{chip(yO, fmt(oracle!, dp), 'c-chip c-chip-cl')}</>}
        {hover && sel && <g className="c-cross">
          <line x1={cx(hover.i)} x2={cx(hover.i)} y1={TOP} y2={volTop + VOL - 6} />
          <line x1={0} x2={plotW} y1={hover.y} y2={hover.y} />
        </g>}
        {hover && sel && chip(hover.y, fmt(pAt(hover.y), dp), 'c-chip c-chip-ink')}
        {hover && sel && <g className="c-chip c-chip-ink"><rect x={Math.min(plotW - 120, Math.max(0, cx(hover.i) - 60))} y={height - TIME + 2} width={120} height={TIME - 4} rx={6} /><text x={Math.min(plotW - 60, Math.max(60, cx(hover.i)))} y={height - 8} textAnchor="middle">{clock(sel.t, sec)}</text></g>}
        <text x={plotW + 10} y={volTop + 14} className="d-axis">{hover && sel ? vol(sel.v) : 'Vol'}</text>
        {!(hover && sel) && timeIdx.map((i, k) => <text key={k} x={k === 0 ? 2 : k === timeIdx.length - 1 ? plotW - 2 : cx(i)} y={height - 8} className="d-axis" textAnchor={k === 0 ? 'start' : k === timeIdx.length - 1 ? 'end' : 'middle'}>{clock(candles[i]!.t, sec)}</text>)}
      </svg>}
    </div>
    <div className="cndl-legend">
      <span><i className="lg-c" />{shown ? <a className="hash" href={shown.source.url} target="_blank" rel="noreferrer">{shown.source.name} {shown.source.pair}</a> : 'Exchange'} candles</span>
      {oracle !== undefined && <span><i className="lg-o" />Chainlink on Fuji</span>}
      {oracle !== undefined && <span><i className="lg-m" />{marks.length} Kumi fill{marks.length === 1 ? '' : 's'} on KumiPerps</span>}
    </div>
  </div>;
}
