import { useMemo, useState } from 'react';
import { INTERVALS, fetchCandles, markersFor, priceTicks, rangeOf, type Interval } from '@kumi-avax/sdk';
import { useLive } from '../lib/chain';
import { Notice } from './bits';

type Trade = { price: bigint; size: bigint; takerBuy: boolean; ts: number };
const IV: Interval[] = ['1m', '5m', '15m', '1h'];
const fmt = (v: number, dp: number) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Real candles: the underlying's public exchange candles (source named in the legend), Chainlink's Fuji mark as a
 * dashed line, and Kumi's own KumiPerps fills as markers on the candle they landed in. Same data as the phone app.
 */
export function Candles({ symbol, dp, trades, oracle }: { symbol: string; dp: number; trades: Trade[]; oracle?: number }) {
  const [iv, setIv] = useState<Interval>('5m');
  const [hover, setHover] = useState<number | null>(null);
  const live = useLive(() => fetchCandles(symbol, iv, 96), [symbol, iv], 20_000);
  const sec = INTERVALS[iv];
  const candles = live.data?.candles ?? [];
  const fills = useMemo(() => trades.map(t => ({ ts: t.ts, price: Number(t.price) / 1e8, size: Number(t.size) / 1e18, takerBuy: t.takerBuy })), [trades]);
  const marks = useMemo(() => markersFor(candles, fills, sec), [candles, fills, sec]);
  const W = 760, H = 300, axis = 64, top = 12, bottom = 22, volH = 40;
  const plotW = W - axis, plotH = H - top - bottom - volH;
  const { min, max } = rangeOf(candles, [...marks.map(m => m.price), ...(oracle ? [oracle] : [])]);
  const y = (p: number) => top + (1 - (p - min) / (max - min || 1)) * plotH;
  const step = candles.length ? plotW / candles.length : 0;
  const body = Math.max(2, step * 0.62);
  const vmax = Math.max(1e-9, ...candles.map(c => c.v));
  const sel = hover !== null ? candles[hover] : candles[candles.length - 1];
  const xOf = (t: number) => { const i = candles.findIndex(c => c.t === t); return i < 0 ? -1 : i * step + step / 2; };

  return <div className="cndl">
    <div className="cndl-head">
      <div className="seg cndl-iv" role="group" aria-label="Candle interval">{IV.map(k => <button key={k} aria-pressed={iv === k} onClick={() => { setIv(k); setHover(null); }}>{k}</button>)}</div>
      {sel && <span className="cndl-ohlc mono">O {fmt(sel.o, dp)} H {fmt(sel.h, dp)} L {fmt(sel.l, dp)} <b className={sel.c >= sel.o ? 'up' : 'down'}>C {fmt(sel.c, dp)}</b></span>}
    </div>
    {live.error && !live.data && <Notice error>Candles unavailable: {live.error}. The book and fills are still live from Fuji.</Notice>}
    {!live.data && !live.error && <div className="skeleton" style={{ height: 300 }} />}
    {candles.length > 0 && <svg className="cndl-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${symbol} ${iv} candles from ${live.data!.source.name}`}
      onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W; setHover(x < plotW ? Math.min(candles.length - 1, Math.max(0, Math.floor(x / step))) : null); }} onMouseLeave={() => setHover(null)}>
      {priceTicks(min, max, 5).map(t => <g key={t}><line x1={0} x2={plotW} y1={y(t)} y2={y(t)} className="c-grid" />{(oracle === undefined || Math.abs(y(t) - y(oracle)) > 18) && <text x={plotW + 8} y={y(t) + 4} className="d-axis">{fmt(t, dp)}</text>}</g>)}
      {candles.map((c, i) => {
        const x = i * step + step / 2, up = c.c >= c.o, vh = (c.v / vmax) * (volH - 6);
        return <g key={c.t} className={up ? 'c-up' : 'c-down'} opacity={hover !== null && hover !== i ? 0.55 : 1}>
          <rect x={x - body / 2} y={H - bottom - vh} width={body} height={vh} className="c-vol" />
          <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} className="c-wick" />
          <rect x={x - body / 2} y={Math.min(y(c.o), y(c.c))} width={body} height={Math.max(1.5, Math.abs(y(c.c) - y(c.o)))} rx={Math.min(2, body / 3)} className="c-body" />
        </g>;
      })}
      {oracle !== undefined && oracle >= min && oracle <= max && <g><line x1={0} x2={plotW} y1={y(oracle)} y2={y(oracle)} className="d-oracle" /><rect x={plotW + 2} y={y(oracle) - 10} width={axis - 4} height={20} rx={7} className="c-tag" /><text x={plotW + 8} y={y(oracle) + 4} className="c-tag-t">{fmt(oracle, dp)}</text></g>}
      {marks.map((m, i) => { const x0 = xOf(m.t); if (x0 < 0) return null; const x = Math.min(plotW - 8, Math.max(8, x0)); const yy = y(m.price); return <path key={i} d={m.takerBuy ? `M${x} ${yy - 8} l7 11 h-14z` : `M${x} ${yy + 8} l7 -11 h-14z`} className={m.takerBuy ? 'c-mk-buy' : 'c-mk-sell'}><title>{`Kumi fill: ${m.takerBuy ? 'buy' : 'sell'} ${m.size} ${symbol} at ${m.price}`}</title></path>; })}
      {hover !== null && <line x1={hover * step + step / 2} x2={hover * step + step / 2} y1={top} y2={H - bottom} className="c-cross" />}
      <text x={2} y={H - 5} className="d-axis">{new Date(candles[0]!.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>
      <text x={plotW - 2} y={H - 5} className="d-axis" textAnchor="end">{new Date(candles[candles.length - 1]!.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>
    </svg>}
    <div className="cndl-legend">
      <span><i className="lg-c" />{live.data ? <a className="hash" href={live.data.source.url} target="_blank" rel="noreferrer">{live.data.source.name} {live.data.source.pair}</a> : 'Exchange'} candles</span>
      <span><i className="lg-o" />Chainlink on Fuji</span>
      <span><i className="lg-m" />{live.data ? `${marks.length} ` : ''}Kumi fills on KumiPerps</span>
    </div>
  </div>;
}
