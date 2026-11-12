import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming, ReduceMotion } from 'react-native-reanimated';
import { price as fmtPrice, size as fmtSize, type MARKETS } from '@kumi-avax/sdk';
import { Text } from './T';
import { Image } from 'expo-image';
import { C, F, art } from '../lib/theme';
import type { Book } from '../lib/chain';
import { ago, tap } from './ui';

type M = (typeof MARKETS)[number];
type Level = { price: bigint; size: bigint; count: number };

/** The on-chain book, read live from KumiPerps.depth: asks over bids, cumulative depth bars, spread and Chainlink in the middle. */
export function OrderBook({ book, m, rows = 7, onPrice }: { book: Book; m: M; rows?: number; onPrice?: (p: bigint) => void }) {
  const asks = book.asks.slice(0, rows);
  const bids = book.bids.slice(0, rows);
  const cum = (ls: Level[]) => { let s = 0n; return ls.map(l => (s += l.size)); };
  const askCum = cum(asks), bidCum = cum(bids);
  const maxCum = [...askCum, ...bidCum].reduce((a, b) => (b > a ? b : a), 1n);
  const spread = book.bestAsk && book.bestBid ? book.bestAsk - book.bestBid : 0n;
  const mid = book.bestAsk && book.bestBid ? (book.bestAsk + book.bestBid) / 2n : 0n;
  const bps = mid ? Number((spread * 1_000_000n) / mid) / 100 : 0;
  return (
    <View accessibilityLabel={`${m.pair} order book`}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 8, marginBottom: 4 }}>
        <Text style={[hd, { flex: 1 }]}>Price</Text>
        <Text style={[hd, { flex: 1, textAlign: 'right' }]}>Size {m.symbol}</Text>
        <Text style={[hd, { width: 74, textAlign: 'right' }]}>Total</Text>
      </View>
      {asks.length === 0 && bids.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: 8, gap: 4 }}>
          <Image source={art.scene.emptyMarket} accessibilityLabel="A sleepy chat bubble on an empty price ladder" style={{ width: 120, height: 120 }} contentFit="contain" />
          <Text style={{ fontSize: 13, color: C.ink2, fontWeight: '600' }}>The book is empty. Place the first order below.</Text>
        </View>
      )}
      {asks.length === 0 && bids.length > 0 && <Text style={{ fontSize: 12.5, color: C.ink3, padding: 8 }}>No asks resting on the book.</Text>}
      {[...asks].reverse().map((l, ri) => { const i = asks.length - 1 - ri; return <Row key={`a${l.price}`} l={l} total={askCum[i]!} max={maxCum} side="ask" m={m} onPrice={onPrice} />; })}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6, paddingHorizontal: 10, height: 40, borderRadius: 14, backgroundColor: C.butterSoft }}>
        <LastPrice price={book.lastPrice} m={m} up={book.trades[0]?.takerBuy ?? true} />
        <Text style={{ fontSize: 11.5, color: C.ink2, fontWeight: '600' }}>Chainlink <Text style={{ fontFamily: F.mono, color: C.ink }}>{fmtPrice(book.oracle, m.priceDp)}</Text></Text>
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.ink2 }}>{bps.toFixed(1)} bp</Text>
      </View>
      {bids.map((l, i) => <Row key={`b${l.price}`} l={l} total={bidCum[i]!} max={maxCum} side="bid" m={m} onPrice={onPrice} />)}
      {bids.length === 0 && asks.length > 0 && <Text style={{ fontSize: 12.5, color: C.ink3, padding: 8 }}>No bids resting on the book.</Text>}
    </View>
  );
}
const hd = { fontSize: 11, fontWeight: '700' as const, color: C.ink3 };

function Row({ l, total, max, side, m, onPrice }: { l: Level; total: bigint; max: bigint; side: 'ask' | 'bid'; m: M; onPrice?: (p: bigint) => void }) {
  const pct = Number((total * 1000n) / max) / 10;
  const ink = side === 'ask' ? C.pinkInk : C.mintInk;
  const bar = side === 'ask' ? 'rgba(255,143,199,0.22)' : 'rgba(61,220,151,0.22)';
  const flash = useSharedValue(0);
  const prev = useRef(l.size);
  useEffect(() => {
    if (prev.current !== l.size) flash.value = withSequence(withTiming(1, { duration: 120, reduceMotion: ReduceMotion.System }), withTiming(0, { duration: 650, reduceMotion: ReduceMotion.System }));
    prev.current = l.size;
  }, [l.size]);
  const a = useAnimatedStyle(() => ({ opacity: flash.value }));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${side} ${fmtPrice(l.price, m.priceDp)}, ${fmtSize(l.size, m.sizeDp)} ${m.symbol}`} onPress={() => { tap(); onPrice?.(l.price); }}
      style={{ height: 26, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderRadius: 7, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', right: 0, top: 2, bottom: 2, width: `${pct}%`, backgroundColor: bar, borderRadius: 6 }} />
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: side === 'ask' ? C.pinkSoft : C.mintSoft }, a]} />
      <Text style={{ flex: 1, fontFamily: F.monoBold, fontSize: 12.5, color: ink }}>{fmtPrice(l.price, m.priceDp)}</Text>
      <Text style={{ flex: 1, textAlign: 'right', fontFamily: F.mono, fontSize: 12.5, color: C.ink }}>{fmtSize(l.size, m.sizeDp)}</Text>
      <Text style={{ width: 74, textAlign: 'right', fontFamily: F.mono, fontSize: 11.5, color: C.ink3 }}>{fmtSize(total, Math.min(m.sizeDp, 2))}</Text>
    </Pressable>
  );
}

/** The last fill price; it pulses in its side's colour when a new fill lands. */
function LastPrice({ price, m, up }: { price: bigint; m: M; up: boolean }) {
  const pulse = useSharedValue(1);
  const prev = useRef(price);
  useEffect(() => {
    if (prev.current !== price) pulse.value = withSequence(withTiming(1.12, { duration: 140, reduceMotion: ReduceMotion.System }), withTiming(1, { duration: 300, reduceMotion: ReduceMotion.System }));
    prev.current = price;
  }, [price]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View style={a}>
      <Text style={{ fontFamily: F.monoBold, fontSize: 15, color: up ? C.mintInk : C.pinkInk }}>{price ? fmtPrice(price, m.priceDp) : '–'}</Text>
    </Animated.View>
  );
}

/** Recent fills from the venue's on-chain ring buffer. */
export function Tape({ book, m, max = 8 }: { book: Book; m: M; max?: number }) {
  if (!book.trades.length) return <Text style={{ fontSize: 13, color: C.ink3 }}>No fills yet on this market.</Text>;
  return (
    <View>
      {book.trades.slice(0, max).map((t, i) => (
        <View key={`${t.ts}-${i}`} style={{ flexDirection: 'row', height: 26, alignItems: 'center', borderTopWidth: i ? 1 : 0, borderColor: C.line }}>
          <Text style={{ flex: 1, fontFamily: F.mono, fontSize: 12.5, color: t.takerBuy ? C.mintInk : C.pinkInk }}>{fmtPrice(t.price, m.priceDp)}</Text>
          <Text style={{ flex: 1, textAlign: 'right', fontFamily: F.mono, fontSize: 12.5, color: C.ink }}>{fmtSize(t.size, m.sizeDp)}</Text>
          <Text style={{ width: 70, textAlign: 'right', fontFamily: F.mono, fontSize: 11.5, color: C.ink3 }}>{ago(t.ts)}</Text>
        </View>
      ))}
    </View>
  );
}
