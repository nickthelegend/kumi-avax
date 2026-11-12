import { useMemo, useState } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { INTERVALS, fetchCandles, markersFor, priceTicks, rangeOf, type Candle, type Interval } from '@kumi-avax/sdk';
import { Text } from './T';
import { C, F } from '../lib/theme';
import { useLive } from '../lib/chain';
import { Notice, Skeleton, tap } from './ui';

type Trade = { price: bigint; size: bigint; takerBuy: boolean; ts: number };
const IV: Interval[] = ['1m', '5m', '15m', '1h'];
const fmt = (v: number, dp: number) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Real candles only: the underlying's exchange candles (source named on the chart), Chainlink's current mark as a
 * dashed line, and Kumi's own fills on KumiPerps as markers on the candle they landed in.
 */
export function Candles({ symbol, priceDp, trades, oracle, height = 230 }: { symbol: string; priceDp: number; trades: Trade[]; oracle?: number; height?: number }) {
  const [iv, setIv] = useState<Interval>('5m');
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const live = useLive(() => fetchCandles(symbol, iv, 72), [symbol, iv], 20_000);
  const sec = INTERVALS[iv];
  const candles = live.data?.candles ?? [];
  const fills = useMemo(() => trades.map(t => ({ ts: t.ts, price: Number(t.price) / 1e8, size: Number(t.size) / 1e18, takerBuy: t.takerBuy })), [trades]);
  const marks = useMemo(() => markersFor(candles, fills, sec), [candles, fills, sec]);
  const axisW = 54, volH = 30, top = 10, bottom = 20;
  const plotW = Math.max(0, w - axisW);
  const plotH = height - top - bottom - volH;
  const { min, max } = rangeOf(candles, [...marks.map(m => m.price), ...(oracle ? [oracle] : [])]);
  const y = (p: number) => top + (1 - (p - min) / (max - min || 1)) * plotH;
  const step = candles.length ? plotW / candles.length : 0;
  const body = Math.max(2, step * 0.62);
  const vmax = Math.max(1, ...candles.map(c => c.v));
  const ticks = priceTicks(min, max, 4);
  const last = candles[candles.length - 1];
  const sel: Candle | undefined = hover !== null ? candles[hover] : last;
  const xOf = (t: number) => { const i = candles.findIndex(c => c.t === t); return i < 0 ? -1 : i * step + step / 2; };
  const onTouch = (e: GestureResponderEvent) => { if (!step) return; const i = Math.min(candles.length - 1, Math.max(0, Math.floor(e.nativeEvent.locationX / step))); setHover(i); };

  return (
    <View>
      <View style={{ gap: 8, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 999, backgroundColor: C.panel3, alignSelf: 'flex-start' }}>
          {IV.map(k => (
            <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: iv === k }} accessibilityLabel={`${k} candles`} onPress={() => { tap(); setIv(k); setHover(null); }}
              style={{ paddingHorizontal: 11, height: 28, borderRadius: 999, justifyContent: 'center', backgroundColor: iv === k ? C.plum : 'transparent' }}>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: iv === k ? '#fff' : C.ink2 }}>{k}</Text>
            </Pressable>
          ))}
        </View>
        {sel && (
          <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: C.ink2 }}>
            O {fmt(sel.o, priceDp)} H {fmt(sel.h, priceDp)} L {fmt(sel.l, priceDp)} <Text style={{ fontFamily: F.monoBold, color: sel.c >= sel.o ? C.mintInk : C.pinkInk }}>C {fmt(sel.c, priceDp)}</Text>
          </Text>
        )}
      </View>
      <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height }} onStartShouldSetResponder={() => true} onResponderGrant={onTouch} onResponderMove={onTouch} onResponderRelease={() => setHover(null)}>
        {!live.data && !live.error && <Skeleton rows={1} height={height} />}
        {live.error && !live.data && <Notice error>Candles unavailable: {live.error}. The order book and fills below are still live from Fuji.</Notice>}
        {w > 0 && candles.length > 0 && (
          <Svg width={w} height={height}>
            {ticks.map(t => (
              <G key={t}>
                <Line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={C.line} strokeWidth={1} />
                {/* the Chainlink tag sits on the same axis: hide a grid label it would cover */}
                {(oracle === undefined || Math.abs(y(t) - y(oracle)) > 16) && <SvgText x={plotW + 6} y={y(t) + 4} fontSize={10} fill={C.ink3} fontFamily={F.mono}>{fmt(t, priceDp)}</SvgText>}
              </G>
            ))}
            {candles.map((c, i) => {
              const x = i * step + step / 2;
              const up = c.c >= c.o;
              const col = up ? C.mintInk : C.pinkInk;
              const fill = up ? C.mint : C.pink;
              const yo = y(c.o), yc = y(c.c);
              const vh = (c.v / vmax) * (volH - 4);
              return (
                <G key={c.t} opacity={hover !== null && hover !== i ? 0.55 : 1}>
                  <Rect x={x - body / 2} y={height - bottom - vh} width={body} height={vh} fill={up ? C.mintSoft : C.pinkSoft} />
                  <Line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1.2} />
                  <Rect x={x - body / 2} y={Math.min(yo, yc)} width={body} height={Math.max(1.5, Math.abs(yc - yo))} rx={Math.min(2, body / 3)} fill={fill} stroke={col} strokeWidth={1} />
                </G>
              );
            })}
            {oracle !== undefined && oracle >= min && oracle <= max && (
              <G>
                <Line x1={0} x2={plotW} y1={y(oracle)} y2={y(oracle)} stroke={C.plum} strokeWidth={1.2} strokeDasharray="4 4" />
                <Rect x={plotW + 2} y={y(oracle) - 9} width={axisW - 2} height={18} rx={6} fill={C.plum} />
                <SvgText x={plotW + 6} y={y(oracle) + 4} fontSize={10} fill="#fff" fontFamily={F.monoBold}>{fmt(oracle, priceDp)}</SvgText>
              </G>
            )}
            {marks.map((m, i) => {
              const x0 = xOf(m.t);
              if (x0 < 0) return null;
              const x = Math.min(plotW - 7, Math.max(7, x0));
              const yy = y(m.price);
              const d = m.takerBuy ? `M${x} ${yy - 7} l6 10 h-12z` : `M${x} ${yy + 7} l6 -10 h-12z`;
              return <Path key={i} d={d} fill={m.takerBuy ? C.mint : C.pink} stroke={C.plum} strokeWidth={1.4} />;
            })}
            {hover !== null && <Line x1={hover * step + step / 2} x2={hover * step + step / 2} y1={top} y2={height - bottom} stroke={C.ink3} strokeDasharray="2 3" />}
            {last && <Circle cx={(candles.length - 1) * step + step / 2} cy={y(last.c)} r={3} fill={C.coral} />}
            <SvgText x={2} y={height - 4} fontSize={9.5} fill={C.ink3} fontFamily={F.mono}>{new Date(candles[0]!.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</SvgText>
            <SvgText x={plotW - 2} y={height - 4} fontSize={9.5} fill={C.ink3} textAnchor="end" fontFamily={F.mono}>{new Date(last!.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</SvgText>
          </Svg>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        <Legend swatch={<View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: C.mint, borderWidth: 1, borderColor: C.mintInk }} />} text={live.data ? `${live.data.source.name} ${live.data.source.pair} candles` : 'Exchange candles'} />
        <Legend swatch={<Svg width={16} height={4}><Line x1={0} x2={16} y1={2} y2={2} stroke={C.plum} strokeWidth={1.6} strokeDasharray="3 3" /></Svg>} text="Chainlink on Fuji" />
        <Legend swatch={<View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C.mint }} />} text={`${live.data ? `${marks.length} ` : ''}Kumi fills on KumiPerps`} />
      </View>
    </View>
  );
}

function Legend({ swatch, text }: { swatch: React.ReactNode; text: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{swatch}<Text style={{ fontSize: 11.5, color: C.ink3, fontWeight: '600' }}>{text}</Text></View>;
}
