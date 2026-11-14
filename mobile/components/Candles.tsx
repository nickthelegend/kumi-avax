import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { INTERVALS, fetchCandles, markersFor, priceTicks, rangeOf, type Candle, type CandleSource, type Interval } from '@kumi-avax/sdk';
import { Text } from './T';
import { C, F } from '../lib/theme';
import { useLive } from '../lib/chain';
import { Notice, Skeleton, tap } from './ui';
import { useScrollLock } from './Screen';

type Trade = { price: bigint; size: bigint; takerBuy: boolean; ts: number };
type Slot = Candle & { empty?: boolean };
const IV: Interval[] = ['1m', '5m', '15m', '1h', '1d'];
/** How many candles the phone draws: wide enough bodies to read, enough of them to show a trend. */
const COUNT = 44;
const AXIS_W = 58;
const VOL_H = 36;
const TIME_H = 18;
const GAP = 1.6;

const fmt = (v: number, dp: number) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const vol = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(v >= 10 ? 0 : 2));
const clock = (t: number, sec: number) => {
  const d = new Date(t * 1000);
  return sec >= 86400 ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * Kumi's price chart. Real candles only: the coin's public exchange candles (Coinbase, Binance as a fallback; the source
 * is named under the chart), Chainlink's Fuji mark as a dashed plum line where KumiPerps lists the market, and Kumi's own
 * KumiPerps fills as ink triangles on the candle they landed in.
 * Full-width bodies with a soft mint/pink glow, a right price axis, a volume row on the same columns, a timeframe switch
 * that keeps the old candles (stepped back) until the new ones arrive, a left-to-right reveal, and a crosshair: touch
 * and drag to read any candle's open, high, low, close and volume, with its price and time on the axes.
 */
export function Candles({ symbol, priceDp, trades = [], oracle, height = 268 }: { symbol: string; priceDp: number; trades?: Trade[]; oracle?: number; height?: number }) {
  const [iv, setIv] = useState<Interval>('5m');
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const live = useLive(() => fetchCandles(symbol, iv, COUNT).then(r => ({ ...r, key: `${symbol}:${iv}` })), [symbol, iv], 20_000);
  // The last answer stays on screen, stepped back, while another timeframe loads: the box never collapses to a skeleton.
  const kept = useRef<{ key: string; candles: Candle[]; source: CandleSource; sec: number } | null>(null);
  if (live.data) kept.current = { ...live.data, sec: INTERVALS[iv] };
  if (kept.current && !kept.current.key.startsWith(`${symbol}:`)) kept.current = null; // another coin: never its candles
  const shown = kept.current;
  const pending = !!shown && shown.key !== `${symbol}:${iv}`;
  const sec = shown?.sec ?? INTERVALS[iv];

  // The exchange's newest candle can trail the chain by a minute or two. Empty slots up to now keep the right edge at the
  // present, so a fill that just landed on KumiPerps still gets its marker (in an empty slot, never on a made-up candle).
  const candles = useMemo(() => {
    const cs: Slot[] = [...(shown?.candles ?? [])];
    const last = cs[cs.length - 1];
    if (!last) return cs;
    const now = Math.floor(Date.now() / 1000 / sec) * sec;
    for (let t = last.t + sec, k = 0; t <= now && k < 3; t += sec, k++) cs.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: 0, empty: true });
    return cs.slice(-COUNT);
  }, [shown, sec]);
  const fills = useMemo(() => trades.map(t => ({ ts: t.ts, price: Number(t.price) / 1e8, size: Number(t.size) / 1e18, takerBuy: t.takerBuy })), [trades]);
  const marks = useMemo(() => (pending ? [] : markersFor(candles, fills, sec)), [candles, fills, sec, pending]);

  const plotW = Math.max(0, w - AXIS_W);
  const top = 8;
  const plotH = height - top - VOL_H - TIME_H - 6;
  const { min, max } = rangeOf(candles.filter(c => !c.empty), [...marks.map(m => m.price), ...(oracle ? [oracle] : [])], 0.08);
  const y = (p: number) => top + (1 - (p - min) / (max - min || 1)) * plotH;
  const pitch = candles.length ? plotW / candles.length : 0;
  const body = Math.max(1.5, pitch - GAP);
  const cx = (i: number) => i * pitch + pitch / 2;
  const volTop = top + plotH + 6;
  const vmax = Math.max(1e-12, ...candles.map(c => c.v));
  const ticks = priceTicks(min, max, 4);
  const lastIdx = candles.map(c => !c.empty).lastIndexOf(true);
  const last = lastIdx >= 0 ? candles[lastIdx] : undefined;
  const first = candles.find(c => !c.empty);
  const sel = hover !== null && candles[hover] && !candles[hover]!.empty ? candles[hover]! : undefined;
  const change = last && first ? ((last.c - first.o) / first.o) * 100 : 0;
  const yOracle = oracle !== undefined && oracle >= min && oracle <= max ? y(oracle) : undefined;
  const yLast = last ? y(last.c) : undefined;
  // One chip per price on the axis: the Coinbase last price hides its chip when Chainlink's would cover it.
  const lastChip = yLast !== undefined && (yOracle === undefined || Math.abs(yLast - yOracle) > 19);
  const timeIdx = candles.length ? [0, 1, 2, 3].map(k => Math.round((k * (candles.length - 1)) / 3)) : [];

  // Left-to-right reveal when a chart first has candles, again for another coin or timeframe: a card-coloured cover
  // slides off the plot on the native driver. (An animated SVG clip re-rasterised every candle on every frame on iOS and
  // starved the UI thread: the reveal crawled and taps were dropped.)
  const cover = useRef(new Animated.Value(0)).current;
  const revealKey = shown?.key ?? '';
  useEffect(() => {
    if (!revealKey || !plotW) return;
    cover.setValue(0);
    Animated.timing(cover, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [revealKey, plotW > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hold, then drag (like XORR's pro chart): a plain swipe over the chart scrolls the page; a finger that rests 220 ms
  // pauses the page scroll and reads candle after candle under it, with a tick on each new one. A quick tap reads one.
  const lockScroll = useScrollLock();
  const lastHover = useRef<number | null>(null);
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; x0: number; y0: number; on: boolean }>({ x0: 0, y0: 0, on: false });
  const readAt = (x: number) => {
    if (!pitch || pending) return;
    const i = Math.min(candles.length - 1, Math.max(0, Math.floor(x / pitch)));
    if (i !== lastHover.current) { lastHover.current = i; tap(); }
    setHover(i);
  };
  const touchStart = (e: GestureResponderEvent) => {
    const { locationX: x, pageX, pageY } = e.nativeEvent;
    clearTimeout(hold.current.timer);
    hold.current = { x0: pageX, y0: pageY, on: false, timer: setTimeout(() => { hold.current.on = true; lockScroll(true); readAt(x); }, 220) };
  };
  const touchMove = (e: GestureResponderEvent) => {
    const h = hold.current;
    if (h.on) { readAt(e.nativeEvent.locationX); return; }
    if (Math.abs(e.nativeEvent.pageX - h.x0) > 8 || Math.abs(e.nativeEvent.pageY - h.y0) > 8) clearTimeout(h.timer); // a swipe: let the page scroll
  };
  const touchEnd = (e: GestureResponderEvent, tapped: boolean) => {
    const h = hold.current; clearTimeout(h.timer);
    if (h.on) { lockScroll(false); h.on = false; lastHover.current = null; setHover(null); return; }
    if (tapped && Math.abs(e.nativeEvent.pageX - h.x0) < 8 && Math.abs(e.nativeEvent.pageY - h.y0) < 8) {
      const i = pitch ? Math.min(candles.length - 1, Math.max(0, Math.floor(e.nativeEvent.locationX / pitch))) : null;
      setHover(cur => (cur === i ? null : i)); if (i !== null) tap();
    }
  };
  useEffect(() => () => { clearTimeout(hold.current.timer); lockScroll(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          {last ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text testID="chart-price" style={{ fontFamily: F.monoBold, fontSize: 22, color: C.ink, letterSpacing: -0.5 }}>${fmt(sel ? sel.c : last.c, priceDp)}</Text>
                {!sel && (
                  <View style={{ paddingHorizontal: 7, height: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: change >= 0 ? C.mintSoft : C.pinkSoft }}>
                    <Text style={{ fontFamily: F.monoBold, fontSize: 11.5, color: change >= 0 ? C.mintInk : C.pinkInk }}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</Text>
                  </View>
                )}
              </View>
              <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 10.5, color: C.ink2 }}>
                {sel
                  ? <>O {fmt(sel.o, priceDp)}  H {fmt(sel.h, priceDp)}  L {fmt(sel.l, priceDp)}  <Text style={{ fontFamily: F.monoBold, color: sel.c >= sel.o ? C.mintInk : C.pinkInk }}>C {fmt(sel.c, priceDp)}</Text></>
                  : `${candles.filter(c => !c.empty).length} × ${iv} candles · vol ${vol(candles.reduce((a, c) => a + c.v, 0))} ${symbol}`}
              </Text>
            </>
          ) : <Text style={{ fontFamily: F.monoBold, fontSize: 22, color: C.ink3 }}>–</Text>}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 2, padding: 3, borderRadius: 999, backgroundColor: C.panel3, marginBottom: 10 }}>
        {IV.map(k => (
          <Pressable key={k} testID={`iv-${k}`} accessibilityRole="button" accessibilityState={{ selected: iv === k }} accessibilityLabel={`${k} candles`} onPress={() => { tap(); setIv(k); setHover(null); }}
            style={{ flex: 1, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: iv === k ? C.plum : 'transparent' }}>
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: iv === k ? '#fff' : C.ink2 }}>{k.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height, overflow: 'hidden' }} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={e => touchEnd(e, true)} onTouchCancel={e => touchEnd(e, false)}>
        {!shown && !live.error && <Skeleton rows={1} height={height} />}
        {live.error && !shown && <Notice error>Candles unavailable: {live.error}.{oracle !== undefined ? ' The order book and fills below are still live from Fuji.' : ''}</Notice>}
        {w > 0 && candles.length > 0 && (
          // The SVG never takes touches itself: on iOS its hit test reached past its box (the glow filters), so taps on the
          // timeframe buttons above it went to the chart instead. The box above owns the crosshair touches.
          <Svg width={w} height={height} pointerEvents="none">
            <Defs>
              <LinearGradient id="kumi-plot" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={C.panel2} stopOpacity={0} /><Stop offset="1" stopColor={C.cream2} stopOpacity={0.5} /></LinearGradient>
            </Defs>
            <Rect x={0} y={top} width={plotW} height={plotH} rx={10} fill="url(#kumi-plot)" />
            {ticks.map(t => (
              <G key={t}>
                <Line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={C.line2} strokeWidth={1} strokeDasharray="2 4" />
                {[yOracle, lastChip ? yLast : undefined].every(v => v === undefined || Math.abs(y(t) - v) > 15) && hover === null &&
                  <SvgText x={plotW + 8} y={y(t) + 3.5} fontSize={10} fill={C.ink3} fontFamily={F.mono}>{fmt(t, priceDp)}</SvgText>}
              </G>
            ))}
            <Line x1={0} x2={plotW} y1={volTop - 3} y2={volTop - 3} stroke={C.line} strokeWidth={1} />

            <G opacity={pending ? 0.4 : 1}>
              {candles.map((c, i) => {
                if (c.empty) return null;
                const up = c.c >= c.o;
                const x = cx(i);
                const yo = y(c.o), yc = y(c.c);
                const vh = Math.max(1, (c.v / vmax) * (VOL_H - 4));
                const dim = hover !== null && hover !== i;
                return (
                  <G key={c.t} opacity={dim ? 0.38 : 1}>
                    <Rect x={x - body / 2} y={volTop + VOL_H - 4 - vh} width={body} height={vh} rx={Math.min(1.5, body / 3)} fill={up ? C.mint : C.pink} opacity={0.35} />
                    <Rect x={x - 0.8} y={y(c.h)} width={1.6} height={Math.max(1, y(c.l) - y(c.h))} rx={0.8} fill={up ? C.mintInk : C.pinkInk} opacity={0.8} />
                    {!dim && <Rect x={x - body / 2 - 1.6} y={Math.min(yo, yc) - 1.6} width={body + 3.2} height={Math.max(1.6, Math.abs(yc - yo)) + 3.2} rx={Math.min(4, body / 2)} fill={up ? C.mint : C.pink} opacity={0.28} />}
                    <Rect x={x - body / 2} y={Math.min(yo, yc)} width={body} height={Math.max(1.6, Math.abs(yc - yo))} rx={Math.min(2.5, body / 2.6)} fill={up ? C.mint : C.pink} />
                    <Rect x={x - body / 2} y={Math.min(yo, yc)} width={body} height={Math.max(1.6, Math.abs(yc - yo))} rx={Math.min(2.5, body / 2.6)} fill="none" stroke={up ? C.mintInk : C.pinkInk} strokeWidth={0.8} strokeOpacity={0.55} />
                  </G>
                );
              })}
              {marks.map((m, i) => {
                const idx = candles.findIndex(c => c.t === m.t);
                if (idx < 0) return null;
                const x = Math.min(plotW - 7, Math.max(7, cx(idx)));
                const yy = y(m.price);
                const d = m.takerBuy ? `M${x} ${yy + 2} l5.5 8.5 h-11z` : `M${x} ${yy - 2} l5.5 -8.5 h-11z`;
                return <Path key={i} d={d} fill={C.plum} stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />;
              })}
            </G>

            {yLast !== undefined && !pending && (
              <G>
                <Line x1={0} x2={plotW} y1={yLast} y2={yLast} stroke={C.coral} strokeWidth={1} strokeDasharray="1 3" opacity={0.9} />
                <Circle cx={cx(lastIdx)} cy={yLast} r={6} fill={C.coral} opacity={0.22} />
                <Circle cx={cx(lastIdx)} cy={yLast} r={3} fill={C.coral} stroke="#fff" strokeWidth={1.2} />
                {lastChip && hover === null && <>
                  <Rect x={plotW + 3} y={yLast - 9.5} width={AXIS_W - 3} height={19} rx={9.5} fill={C.coral} />
                  <SvgText x={plotW + 3 + (AXIS_W - 3) / 2} y={yLast + 3.5} fontSize={10} fill="#fff" fontFamily={F.monoBold} textAnchor="middle">{fmt(last!.c, priceDp)}</SvgText>
                </>}
              </G>
            )}
            {yOracle !== undefined && (
              <G>
                <Line x1={0} x2={plotW} y1={yOracle} y2={yOracle} stroke={C.plum} strokeWidth={1.3} strokeDasharray="5 4" />
                {hover === null && <>
                  <Rect x={plotW + 3} y={yOracle - 9.5} width={AXIS_W - 3} height={19} rx={6} fill={C.plum} />
                  <SvgText x={plotW + 3 + (AXIS_W - 3) / 2} y={yOracle + 3.5} fontSize={10} fill="#fff" fontFamily={F.monoBold} textAnchor="middle">{fmt(oracle!, priceDp)}</SvgText>
                </>}
              </G>
            )}

            {sel && hover !== null && (
              <G>
                <Line x1={cx(hover)} x2={cx(hover)} y1={top} y2={volTop + VOL_H - 4} stroke={C.ink} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
                <Line x1={0} x2={plotW} y1={y(sel.c)} y2={y(sel.c)} stroke={C.ink} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
                <Rect x={plotW + 3} y={y(sel.c) - 9.5} width={AXIS_W - 3} height={19} rx={6} fill={C.ink} />
                <SvgText x={plotW + 3 + (AXIS_W - 3) / 2} y={y(sel.c) + 3.5} fontSize={10} fill="#fff" fontFamily={F.monoBold} textAnchor="middle">{fmt(sel.c, priceDp)}</SvgText>
                <Rect x={Math.min(plotW - 62, Math.max(0, cx(hover) - 31))} y={height - TIME_H + 1} width={62} height={TIME_H - 2} rx={5} fill={C.ink} />
                <SvgText x={Math.min(plotW - 31, Math.max(31, cx(hover)))} y={height - 5} fontSize={9.5} fill="#fff" fontFamily={F.monoBold} textAnchor="middle">{clock(sel.t, sec)}</SvgText>
                <SvgText x={plotW + 8} y={volTop + 12} fontSize={9.5} fill={C.ink2} fontFamily={F.mono}>{vol(sel.v)}</SvgText>
              </G>
            )}
            {hover === null && <SvgText x={plotW + 8} y={volTop + 12} fontSize={9.5} fill={C.ink3} fontFamily={F.mono}>Vol</SvgText>}
            {hover === null && timeIdx.map((i, k) => (
              <SvgText key={k} x={k === 0 ? 1 : k === 3 ? plotW - 1 : cx(i)} y={height - 5} fontSize={9.5} fill={C.ink3} fontFamily={F.mono} textAnchor={k === 0 ? 'start' : k === 3 ? 'end' : 'middle'}>{clock(candles[i]!.t, sec)}</SvgText>
            ))}
          </Svg>
        )}
        {w > 0 && candles.length > 0 && (
          <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: plotW + 2, height, backgroundColor: C.panel, transformOrigin: 'right center', transform: [{ scaleX: cover.interpolate({ inputRange: [0, 1], outputRange: [1, 0.001] }) }] }} />
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6, marginTop: 10 }}>
        <Legend swatch={<View style={{ flexDirection: 'row', gap: 2 }}><View style={{ width: 5, height: 10, borderRadius: 1.5, backgroundColor: C.mint }} /><View style={{ width: 5, height: 10, borderRadius: 1.5, backgroundColor: C.pink }} /></View>}
          text={shown ? `${shown.source.name} ${shown.source.pair}` : 'Exchange candles'} onPress={shown ? () => Linking.openURL(shown.source.url) : undefined} />
        {oracle !== undefined && <Legend swatch={<Svg width={16} height={4}><Line x1={0} x2={16} y1={2} y2={2} stroke={C.plum} strokeWidth={1.6} strokeDasharray="4 3" /></Svg>} text="Chainlink on Fuji" />}
        {oracle !== undefined && <Legend swatch={<Svg width={11} height={9}><Path d="M5.5 0.5 l5 8 h-10z" fill={C.plum} /></Svg>} text={`${marks.length} Kumi fill${marks.length === 1 ? '' : 's'}`} />}
      </View>
    </View>
  );
}

function Legend({ swatch, text, onPress }: { swatch: React.ReactNode; text: string; onPress?: () => void }) {
  const inner = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{swatch}<Text style={{ fontSize: 11.5, color: C.ink3, fontWeight: '600', textDecorationLine: onPress ? 'underline' : 'none' }}>{text}</Text></View>;
  return onPress ? <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6}>{inner}</Pressable> : inner;
}
