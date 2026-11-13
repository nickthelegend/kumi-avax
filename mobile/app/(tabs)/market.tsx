import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { MARKETS, initialMargin, parseDecimal, sizeFor, notionalOf, price as fmtPrice, size as fmtSize, usd as fmtUsd, signedUsd } from '@kumi-avax/sdk';
import { Text, TextInput } from '../../components/T';
import { Screen } from '../../components/Screen';
import { Candles } from '../../components/Candles';
import { CountUp, LiveDot } from '../../components/Live';
import { OrderBook, Tape } from '../../components/OrderBook';
import { Btn, Card, Chip, Notice, Skeleton, TokenLogo, TxLink, st, tap, useBusy } from '../../components/ui';
import { readAccount, readBook, useLive } from '../../lib/chain';
import { cancelOrder, closePosition, placeTicket } from '../../lib/actions';
import { useApp } from '../../lib/store';
import { C, F } from '../../lib/theme';

/** Market: live on-chain book, real candles, a ticket that signs on this phone, and your position from KumiPerps. */
export default function Market() {
  const [mid, setMid] = useState(0);
  const m = MARKETS[mid]!;
  const { address, record } = useApp();
  const book = useLive(() => readBook(mid, 10), [mid], 3000);
  const acct = useLive(() => (address ? readAccount(address) : Promise.resolve(null)), [address], 6000);
  const b = book.data;
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [kind, setKind] = useState<'market' | 'limit'>('market');
  const [px, setPx] = useState('');
  const [margin, setMargin] = useState('25');
  const [lev, setLev] = useState(3);
  const act = useBusy();
  const [sent, setSent] = useState<{ hash: string; label: string }[]>([]);

  const isBuy = side === 'buy';
  let preview: { size: bigint; ref: bigint; im: bigint } | null = null;
  let previewErr = '';
  try {
    const ref = kind === 'limit' && px ? parseDecimal(px, 8) : b ? (isBuy ? b.bestAsk : b.bestBid) || b.oracle : 0n;
    if (ref > 0n) { const size = sizeFor(m, parseDecimal(margin || '0', 6), lev, ref); preview = { size, ref, im: initialMargin(size, ref) }; }
  } catch (e) { previewErr = (e as Error).message; }
  const pos = acct.data?.positions.find(p => Number(p.market) === mid);
  const myOrders = acct.data?.orders.filter(o => o.market === mid) ?? [];
  const oracleNum = b ? Number(b.oracle) / 1e8 : undefined;

  return (
    <Screen tabs>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {MARKETS.map(x => {
          const on = x.id === mid;
          return (
            <Pressable key={x.id} testID={`market-${x.symbol}`} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { tap(); setMid(x.id); setPx(''); }}
              style={{ flex: 1, borderRadius: 22, backgroundColor: on ? C.plumEdge : C.edge, paddingBottom: 4 }}>
              <View style={{ height: 50, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, backgroundColor: on ? C.plum : '#fff' }}>
                <TokenLogo sym={x.symbol} size={28} />
                <Text style={{ fontWeight: '800', fontSize: 15, color: on ? '#fff' : C.ink }}>{x.pair}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {book.error && !b && <Notice error>Could not read the {m.pair} book from Fuji: {book.error}</Notice>}
      {!b && !book.error && <Skeleton rows={3} height={90} />}
      {b && (
        <>
          {b.stale && <Notice error>Chainlink's {m.pair} price is older than the venue accepts, so new orders revert until it updates. Cancels still work.</Notice>}
          <View style={{ borderRadius: 28, backgroundColor: C.plumEdge, paddingBottom: 6 }}>
            <View style={{ borderRadius: 28, backgroundColor: C.plum, padding: 16, gap: 4 }}>
              <View style={st.between}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><LiveDot size={7} /><Text style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)', fontWeight: '700' }}>{m.pair} · Chainlink on Fuji</Text></View>
                <Chip text={`${b.tradeCount.toString()} fills on Kumi`} tone="mint" />
              </View>
              <CountUp value={Number(b.oracle) / 1e8} format={n => `$${n.toLocaleString('en-US', { minimumFractionDigits: m.priceDp + 1, maximumFractionDigits: m.priceDp + 1 })}`} style={{ fontFamily: F.display, fontSize: 42, lineHeight: 48, color: '#fff' }} />
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>Book {fmtPrice(b.bestBid, m.priceDp)} / {fmtPrice(b.bestAsk, m.priceDp)} · last fill {b.lastPrice ? `$${fmtPrice(b.lastPrice, m.priceDp)}` : '–'}</Text>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Chainlink updated {Math.max(0, Math.round((Date.now() / 1000 - b.oracleAt) / 60))} min ago · open interest {fmtSize(b.openInterest, m.sizeDp)} {m.symbol}</Text>
            </View>
          </View>

          <Card pad={14}>
            <View style={[st.between, { marginBottom: 10 }]}>
              <Text style={st.h2}>Price</Text>
              <Chip text="real data" tone="mint" dot />
            </View>
            <Candles symbol={m.symbol} priceDp={m.priceDp} trades={b.trades} oracle={oracleNum} />
          </Card>

          <Card pad={12}>
            <View style={[st.between, { marginBottom: 8, paddingHorizontal: 4 }]}>
              <Text style={st.h2}>Order book</Text>
              <Chip text="on-chain" tone="mint" dot />
            </View>
            <OrderBook book={b} m={m} onPrice={p => { setKind('limit'); setPx((Number(p) / 1e8).toFixed(m.priceDp)); }} />
            <Text style={{ fontSize: 11.5, color: C.ink3, marginTop: 6, paddingHorizontal: 4 }}>Read live from KumiPerps.depth on Fuji. Tap a level to set a limit price.</Text>
          </Card>

          <Card pad={14}>
            <Text style={[st.h2, { marginBottom: 10 }]}>Trade {m.symbol}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {(['buy', 'sell'] as const).map(s2 => (
                <Pressable key={s2} testID={`side-${s2}`} onPress={() => { tap(); setSide(s2); }} accessibilityRole="button" accessibilityState={{ selected: side === s2 }}
                  style={{ flex: 1, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: side === s2 ? (s2 === 'buy' ? C.mint : C.pink) : C.panel3, borderBottomWidth: side === s2 ? 4 : 0, borderColor: s2 === 'buy' ? C.mintEdge : C.pinkEdge }}>
                  <Text style={{ fontWeight: '800', fontSize: 15.5, color: side === s2 ? (s2 === 'buy' ? '#08311f' : C.plum2) : C.ink2 }}>{s2 === 'buy' ? 'Long / Buy' : 'Short / Sell'}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 999, backgroundColor: C.panel3, marginBottom: 12 }}>
              {(['market', 'limit'] as const).map(k => (
                <Pressable key={k} onPress={() => { tap(); setKind(k); }} accessibilityRole="button" accessibilityState={{ selected: kind === k }} style={{ flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: kind === k ? C.plum : 'transparent' }}>
                  <Text style={{ fontWeight: '700', fontSize: 13.5, color: kind === k ? '#fff' : C.ink2 }}>{k === 'market' ? 'Market' : 'Limit'}</Text>
                </Pressable>
              ))}
            </View>
            {kind === 'limit' && (
              <View style={{ gap: 6, marginBottom: 10 }}>
                <Text style={st.k}>Limit price (USD)</Text>
                <TextInput testID="limit-price" value={px} onChangeText={setPx} keyboardType="decimal-pad" placeholder={b ? fmtPrice(isBuy ? b.bestBid : b.bestAsk, m.priceDp) : ''} placeholderTextColor={C.ink3} style={inp} />
              </View>
            )}
            <View style={{ gap: 6, marginBottom: 10 }}>
              <Text style={st.k}>Margin (tUSDC)</Text>
              <TextInput testID="margin" value={margin} onChangeText={setMargin} keyboardType="decimal-pad" style={inp} />
            </View>
            <View style={{ gap: 6, marginBottom: 12 }}>
              <Text style={st.k}>Leverage</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>{[1, 2, 3, 5, 10].map(l => <Pressable key={l} onPress={() => { tap(); setLev(l); }} accessibilityRole="button" accessibilityState={{ selected: lev === l }} style={{ flex: 1, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: lev === l ? C.butter : '#fff', borderWidth: 2, borderColor: lev === l ? C.butterEdge : C.edge }}><Text style={{ fontFamily: F.monoBold, fontSize: 14, color: C.ink }}>{l}x</Text></Pressable>)}</View>
            </View>
            <View style={{ padding: 12, borderRadius: 16, backgroundColor: C.panel2, gap: 4, marginBottom: 12 }}>
              {preview ? <>
                <Row k="Size" v={`${fmtSize(preview.size, m.sizeDp)} ${m.symbol}`} />
                <Row k="Notional" v={`$${fmtUsd(notionalOf(preview.size, preview.ref))}`} />
                <Row k="Initial margin held (10%)" v={`$${fmtUsd(preview.im)}`} />
                <Row k={kind === 'market' ? 'Fills against' : 'Rests at'} v={`$${fmtPrice(preview.ref, m.priceDp)}`} />
              </> : <Text style={{ fontSize: 13, color: previewErr ? C.pinkInk : C.ink3 }}>{previewErr || 'Enter a margin to see the size.'}</Text>}
            </View>
            {act.error && <Notice error style={{ marginBottom: 10 }}>{act.error}</Notice>}
            {sent.length > 0 && !act.busy && <View style={{ gap: 4, marginBottom: 10 }}>{sent.map(t => <View key={t.hash} style={st.between}><Text style={{ fontSize: 13, color: C.mintInk, fontWeight: '700' }}>{t.label}</Text><TxLink hash={t.hash} /></View>)}</View>}
            <Btn testID="place-order" size="lg" tone={isBuy ? 'mint' : 'pink'} busy={act.busy !== null} disabled={!preview || preview.size === 0n || !address}
              title={act.busy ? `${act.busy}…` : `${kind === 'market' ? 'Market' : 'Limit'} ${isBuy ? 'long' : 'short'} ${preview ? fmtSize(preview.size, m.sizeDp) : ''} ${m.symbol}`}
              onPress={() => act.run('Signing', async step => {
                const r = await placeTicket({ market: mid, isBuy, kind, price: kind === 'limit' ? parseDecimal(px, 8) : undefined, margin: parseDecimal(margin, 6), leverage: lev }, step);
                record(r.txs); setSent(r.txs); book.reload(); acct.reload();
              })} />
            <Text style={{ fontSize: 11.5, color: C.ink3, textAlign: 'center', marginTop: 8 }}>Signed on this phone, sent to KumiPerps on Avalanche Fuji. Margin is Kumi's test dollar (tUSDC).</Text>
          </Card>

          <Card pad={14}>
            <View style={[st.between, { marginBottom: 8 }]}><Text style={st.h2}>Your {m.symbol} position</Text><Chip text="from chain" tone="plum" /></View>
            {!address ? <Text style={st.body}>No wallet yet.</Text> : !acct.data ? <Skeleton rows={1} /> : !pos ? <Text style={st.body}>No open {m.symbol} position. Trades above, or copies of lobby calls, show up here.</Text> : (
              <View style={{ gap: 8 }}>
                <View style={st.between}>
                  <Chip text={pos.size > 0n ? 'Long' : 'Short'} tone={pos.size > 0n ? 'mint' : 'pink'} dot />
                  <Text style={{ fontFamily: F.monoBold, fontSize: 20, color: pos.unrealized >= 0n ? C.mintInk : C.pinkInk }}>{signedUsd(pos.unrealized)}</Text>
                </View>
                <Row k="Size" v={`${fmtSize(pos.size < 0n ? -pos.size : pos.size, m.sizeDp)} ${m.symbol}`} />
                <Row k="Entry / Chainlink mark" v={`${fmtPrice(pos.entry, m.priceDp)} / ${fmtPrice(pos.mark, m.priceDp)}`} />
                <Row k="Liquidation (approx.)" v={pos.liqPrice ? `$${fmtPrice(pos.liqPrice, m.priceDp)}` : 'none'} />
                <Btn title="Close at market" tone="white" icon="exit" busy={act.busy !== null} onPress={() => act.run('Closing', async step => { const tx = await closePosition(mid, pos.size, step); record([tx]); setSent([tx]); acct.reload(); book.reload(); })} />
              </View>
            )}
            {myOrders.length > 0 && (
              <View style={{ marginTop: 12, gap: 6 }}>
                <Text style={st.k}>Open orders</Text>
                {myOrders.map(o => (
                  <View key={String(o.id)} style={st.between}>
                    <Text style={{ fontFamily: F.mono, fontSize: 12.5, color: o.isBuy ? C.mintInk : C.pinkInk }}>{o.isBuy ? 'Buy' : 'Sell'} {fmtSize(o.size, m.sizeDp)} @ {fmtPrice(o.price, m.priceDp)}</Text>
                    <Btn title="Cancel" size="sm" tone="white" onPress={() => act.run('Cancelling', async () => { const tx = await cancelOrder(o.id); record([tx]); acct.reload(); book.reload(); })} />
                  </View>
                ))}
              </View>
            )}
          </Card>

          <Card pad={14}>
            <View style={[st.between, { marginBottom: 6 }]}><Text style={st.h2}>Recent fills</Text><Text style={{ fontSize: 11.5, color: C.ink3 }}>on-chain ring buffer</Text></View>
            <Tape book={b} m={m} />
          </Card>
        </>
      )}
    </Screen>
  );
}

const inp = { height: 50, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: C.edge, paddingHorizontal: 14, fontSize: 16, color: C.ink, fontFamily: F.mono, outlineStyle: 'none' } as any;
function Stat({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, padding: 12, borderRadius: 20, backgroundColor: '#fff', borderWidth: 2, borderColor: '#fff', borderBottomWidth: 5, borderBottomColor: C.edge }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: C.ink3 }}>{k}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: F.monoBold, fontSize: 15.5, color: C.ink, marginTop: 2 }}>{v}</Text>
      <Text style={{ fontSize: 11, color: C.ink3 }}>{sub}</Text>
    </View>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <View style={st.between}><Text style={{ fontSize: 13, color: C.ink2 }}>{k}</Text><Text style={{ fontFamily: F.mono, fontSize: 13, color: C.ink }}>{v}</Text></View>;
}
