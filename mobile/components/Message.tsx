import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import type { Address } from 'viem';
import { MARKETS, price as fmtPrice, size as fmtSize, usd as fmtUsd, signedUsd, type CallerStat, type ChatItem } from '@kumi-avax/sdk';
import { Text } from './T';
import { Avatar, Btn, CallerBadge, Chip, Ic, TestTag, TokenLogo, TxLink, ago } from './ui';
import { Image } from 'expo-image';
import { C, F, TONE, art, type Tone } from '../lib/theme';
import { crewAbi, nameOf, pub, useLive } from '../lib/chain';

const enter = FadeInDown.duration(260).reduceMotion(ReduceMotion.System);

export function Bubble({ m, me, showWho, stat }: { m: ChatItem; me?: string | null; showWho: boolean; stat?: CallerStat | null }) {
  const mine = !!me && m.who.toLowerCase() === me.toLowerCase();
  const isCmd = m.text.startsWith('/');
  return (
    <Animated.View entering={enter} style={{ flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%' }}>
      {!mine && (showWho ? <Avatar address={m.who} size={30} /> : <View style={{ width: 30 }} />)}
      <View style={{ flexShrink: 1 }}>
        {showWho && (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 3, marginHorizontal: 4, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
            <Text style={{ fontWeight: '700', fontSize: 13, color: C.ink }}>{nameOf(m.who, me)}</Text>
            {!mine && <TestTag address={m.who} />}
            {stat && <CallerBadge rank={stat.rank} winRate={stat.winRate} />}
            <Text style={{ fontSize: 11.5, color: C.ink3 }}>{ago(m.ts)}</Text>
          </View>
        )}
        <View style={{ borderRadius: 22, borderBottomLeftRadius: mine ? 22 : 8, borderBottomRightRadius: mine ? 8 : 22, backgroundColor: mine ? '#1f0e29' : C.edge, paddingBottom: 4 }}>
          <View style={{ paddingVertical: 10, paddingHorizontal: 15, borderRadius: 22, borderBottomLeftRadius: mine ? 22 : 8, borderBottomRightRadius: mine ? 8 : 22, backgroundColor: mine ? C.plum : C.panel, borderWidth: 2, borderColor: mine ? C.plum : '#fff' }}>
            <Text style={{ fontSize: 15.5, lineHeight: 22, color: mine ? '#fff' : C.ink, fontFamily: isCmd ? F.mono : undefined }}>{m.text}</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

/** A chat event as the web's pill: tone by kind (butter money, mint gains and copies, pink exits, coral trades). */
export function EventPill({ m, me, tone, icon, text }: { m: ChatItem; me?: string | null; tone: Tone; icon: string; text: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <Animated.View entering={enter} style={{ alignSelf: 'center', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingLeft: 5, paddingRight: 13, borderRadius: 999, backgroundColor: t.soft, borderWidth: 2, borderColor: '#fff' }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: t.base, alignItems: 'center', justifyContent: 'center' }}><Ic name={icon} size={14} color={C.plum2} /></View>
      <Text style={{ flexShrink: 1, fontSize: 13.5, color: C.ink2, fontWeight: '600' }}><Text style={{ fontWeight: '800', color: C.ink }}>{nameOf(m.who, me)}</Text> {text}</Text>
    </Animated.View>
  );
}

/** A lobby trade call, drawn like the web's trade card: coral top for longs, plum for shorts. */
export function CallCard({ m, me, copies, canCopy, onCopy, onTip, busy, stat }: { m: ChatItem; me?: string | null; copies: ChatItem[]; canCopy: boolean; onCopy: () => void; onTip?: () => void; busy?: boolean; stat?: CallerStat | null }) {
  const mk = MARKETS[m.market ?? 0]!;
  const mine = !!me && m.who.toLowerCase() === me.toLowerCase();
  const copiedByMe = !!me && copies.some(c => c.who.toLowerCase() === me.toLowerCase());
  return (
    <Animated.View entering={enter} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', width: '94%', borderRadius: 28, backgroundColor: C.edge, paddingBottom: 7 }}>
      <View style={{ borderRadius: 28, borderWidth: 3, borderColor: '#fff', backgroundColor: C.panel, overflow: 'hidden' }}>
        <LinearGradient colors={m.isLong ? ['#ff9a7e', C.coral, '#ff6a7f'] : ['#6a3a80', C.plum, C.plum]} locations={[0, 0.55, 1]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <TokenLogo sym={mk.symbol} size={40} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: 1, color: 'rgba(255,255,255,0.85)' }}>{nameOf(m.who, me).toUpperCase()} CALLED · #{m.index}</Text>
              {stat && <CallerBadge rank={stat.rank} winRate={stat.winRate} light />}
            </View>
            <Text style={{ fontFamily: F.display, fontSize: 25, lineHeight: 30, color: '#fff' }}>{m.isLong ? 'LONG' : 'SHORT'} {mk.symbol} {m.leverage}X</Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.92)' }}>{fmtUsd(m.amount, 0)} tUSDC margin · {fmtUsd(m.amount * BigInt(m.leverage ?? 1), 0)} notional</Text>
          </View>
          <View style={{ paddingHorizontal: 10, height: 26, borderRadius: 999, backgroundColor: '#fff', justifyContent: 'center' }}><Text style={{ fontSize: 11.5, fontWeight: '800', color: C.plum }}>{copies.length} copied</Text></View>
        </LinearGradient>
        <View style={{ padding: 14, gap: 10 }}>
          {m.text ? <Text style={{ fontSize: 15, color: C.ink, lineHeight: 21 }}>"{m.text}"</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat k="Chainlink when called" v={m.price ? `$${fmtPrice(m.price, mk.priceDp)}` : 'feed stale'} />
            <Stat k="Size at that price" v={m.price ? `${fmtSize((m.amount * BigInt(m.leverage ?? 1) * 10n ** 20n) / m.price, mk.sizeDp)} ${mk.symbol}` : '–'} />
          </View>
          {copies.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ flexDirection: 'row' }}>{copies.slice(0, 5).map((c, i) => <View key={c.key} style={{ marginLeft: i ? -8 : 0 }}><Avatar address={c.who} size={26} ring="#fff" /></View>)}</View>
              <Text style={{ fontSize: 12.5, color: C.ink2, flexShrink: 1 }}>{copies.map(c => nameOf(c.who, me)).slice(0, 3).join(', ')}{copies.length > 3 ? ` +${copies.length - 3}` : ''} copied on the book</Text>
            </View>
          )}
          {mine ? <Chip text="Your call" tone="coral" />
            : copiedByMe ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Chip text="You copied this" tone="mint" dot />
                {onTip && <Btn testID={`tip-${m.index}`} title="Tip privately" tone="plum" size="sm" icon="lock" onPress={onTip} />}
              </View>
            )
            : canCopy ? <Btn testID={`copy-${m.index}`} title={busy ? 'Copying…' : `Copy with ${fmtUsd(m.amount, 0)} tUSDC`} tone={m.isLong ? 'coral' : 'plum'} busy={busy} onPress={onCopy} icon="copy" />
            : <Text style={{ fontSize: 12.5, color: C.ink3 }}>Join the chat to copy calls.</Text>}
        </View>
      </View>
    </Animated.View>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 16, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line }}>
      <Text style={{ fontSize: 11.5, color: C.ink3, fontWeight: '600' }}>{k}</Text>
      <Text style={{ fontFamily: F.monoBold, fontSize: 14, color: C.ink, marginTop: 2 }}>{v}</Text>
    </View>
  );
}

/** A verified copy: the size and entry come from KumiPerps (the lobby read them from the venue). */
export function CopyPill({ m, me }: { m: ChatItem; me?: string | null }) {
  const mk = MARKETS[m.market ?? 0]!;
  return (
    <Animated.View entering={enter} style={{ alignSelf: 'center', alignItems: 'center', gap: 3 }}>
      <EventPill m={m} me={me} tone="mint" icon="check" text={<>copied #{m.ref}: {m.isLong ? 'long' : 'short'} <Text style={{ fontFamily: F.monoBold }}>{fmtSize(m.size ?? 0n, mk.sizeDp)} {mk.symbol}</Text> at <Text style={{ fontFamily: F.monoBold }}>${fmtPrice(m.price ?? 0n, mk.priceDp)}</Text></>} />
      {m.orderTx && <TxLink hash={m.orderTx} label="order on Snowtrace" color={C.mintInk} />}
    </Animated.View>
  );
}

/** A crew pitch: the trade card with the share-weighted vote bar, read live from the crew vault. */
export function PitchCard({ crew, m, me, isMember, onVote, onShare, busy }: { crew: Address; m: ChatItem; me?: string | null; isMember: boolean; onVote: (id: number, yes: boolean) => void; onShare?: (market: number, isLong: boolean, leverage: number) => void; busy?: boolean }) {
  const p = useLive(async () => {
    const [prop, tally, totalShares] = await Promise.all([
      pub.readContract({ address: crew, abi: crewAbi, functionName: 'getProposal', args: [BigInt(m.ref)] }),
      pub.readContract({ address: crew, abi: crewAbi, functionName: 'tally', args: [BigInt(m.ref)] }),
      pub.readContract({ address: crew, abi: crewAbi, functionName: 'totalShares' }),
    ]);
    const mine = me ? await pub.readContract({ address: crew, abi: crewAbi, functionName: 'voteOf', args: [BigInt(m.ref), me as Address] }) : 0;
    return { prop, yes: tally[0], no: tally[1], needed: tally[2], totalShares, mine: Number(mine) };
  }, [crew, m.ref, me], 8000);
  const d = p.data;
  const pr = d?.prop;
  const kind = pr ? Number(pr.kind) : 0;
  const mk = MARKETS[pr?.market ?? 0]!;
  // Yes and no are shares of the whole crew (not of the votes cast): a pitch passes when yes passes the threshold of all shares.
  const total = d && d.totalShares > 0n ? d.totalShares : 1n;
  const status = !pr ? null : pr.executed ? (kind > 1 ? ['Passed', 'mint'] : pr.filled > 0n ? [kind === 1 ? 'Closed' : 'Opened', 'mint'] : ['Not filled', 'pink']) : Date.now() / 1000 > Number(pr.deadline) ? ['Expired', 'grey'] : ['Voting', 'butter'];
  const title = !pr ? m.text : kind === 0 ? `${pr.isLong ? 'LONG' : 'SHORT'} ${mk.symbol} ${pr.leverage}X` : kind === 1 ? `CLOSE ${mk.symbol}` : kind === 3 ? `ADD ${nameOf(pr.target, me).toUpperCase()}` : 'NEW CAPTAIN';
  return (
    <Animated.View entering={enter} style={{ alignSelf: 'stretch', borderRadius: 28, backgroundColor: C.edge, paddingBottom: 7 }}>
      <View style={{ borderRadius: 28, borderWidth: 3, borderColor: '#fff', backgroundColor: C.panel, overflow: 'hidden' }}>
        <LinearGradient colors={kind === 1 ? ['#ffe08f', C.butter, C.butter] : pr?.isLong || kind > 1 ? ['#6a3a80', C.plum, C.plum] : ['#6a3a80', C.plum, C.plum]} locations={[0, 0.6, 1]}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          {kind <= 1 ? <TokenLogo sym={mk.symbol} size={40} /> : <Avatar address={pr?.target ?? m.who} size={40} />}
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: 1, color: kind === 1 ? C.plum3 : 'rgba(255,255,255,0.85)' }}>{nameOf(m.who, me).toUpperCase()} PITCHED · #{m.ref}</Text>
            <Text style={{ fontFamily: F.display, fontSize: 24, lineHeight: 29, color: kind === 1 ? C.plum2 : '#fff' }}>{title}</Text>
            {pr && kind === 0 && <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>{pr.sizeBps / 100}% of the fund</Text>}
            {pr && kind === 3 && <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>by join code · {pr.target.slice(0, 6)}…{pr.target.slice(-4)}</Text>}
          </View>
          {status && <View style={{ paddingHorizontal: 10, height: 26, borderRadius: 999, backgroundColor: '#fff', justifyContent: 'center' }}><Text style={{ fontSize: 11.5, fontWeight: '800', color: status[1] === 'mint' ? C.mintInk : status[1] === 'pink' ? C.pinkInk : C.plum }}>{status[0]}</Text></View>}
        </LinearGradient>
        <View style={{ padding: 14, gap: 10 }}>
          {!d ? <View style={{ height: 54, borderRadius: 16, backgroundColor: C.panel3 }} /> : (
            <View style={{ padding: 12, borderRadius: 18, backgroundColor: C.butterSoft, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, color: C.ink }}><Text style={{ fontFamily: F.monoBold }}>{(Number((d.yes * 10000n) / total) / 100).toFixed(1)}%</Text> of shares yes</Text>
                <Text style={{ fontSize: 12.5, color: C.ink2 }}>needs {(Number((d.needed * 10000n) / total) / 100).toFixed(2)}%</Text>
              </View>
              <View style={{ height: 12, borderRadius: 6, backgroundColor: '#e8dcc6', overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, Number((d.yes * 10000n) / total) / 100)}%`, height: '100%', backgroundColor: C.coral, borderRadius: 6 }} />
                <View style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 3, backgroundColor: C.plum }} />
              </View>
              {pr && pr.executed && kind === 0 && pr.filled > 0n && <Text style={{ fontSize: 13, color: C.ink2 }}>Filled <Text style={{ fontFamily: F.monoBold, color: C.ink }}>{fmtSize(pr.filled, mk.sizeDp)} {mk.symbol}</Text> at ${fmtPrice(pr.avgPrice, mk.priceDp)} on the book</Text>}
              {pr && pr.executed && kind === 1 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Image source={pr.resultPnl >= 0n ? art.sticker.winFox : art.sticker.lossBear} accessibilityLabel={pr.resultPnl >= 0n ? 'A fox cheering with an up arrow' : 'A bear holding a bending down arrow'} style={{ width: 52, height: 52 }} contentFit="contain" />
                  <Text style={{ flex: 1, fontSize: 13, color: C.ink2 }}>Closed, realised <Text style={{ fontFamily: F.monoBold, color: pr.resultPnl >= 0n ? C.mintInk : C.pinkInk }}>{signedUsd(pr.resultPnl)} tUSDC</Text></Text>
                </View>
              )}
            </View>
          )}
          {d && pr && !pr.executed && Date.now() / 1000 <= Number(pr.deadline) && isMember && d.mine === 0 && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title="Vote yes" tone="coral" icon="thumb" busy={busy} onPress={() => onVote(m.ref, true)} style={{ flex: 1 }} />
              <Btn title="No" tone="white" icon="thumbDown" disabled={busy} onPress={() => onVote(m.ref, false)} style={{ flex: 0.6 }} />
            </View>
          )}
          {d && d.mine !== 0 && <Chip text={d.mine > 0 ? 'You voted yes' : 'You voted no'} tone={d.mine > 0 ? 'mint' : 'pink'} dot />}
          {pr && pr.executed && kind === 0 && pr.filled > 0n && isMember && onShare && (
            <Btn testID={`share-${m.ref}`} title="Share as a call so others can copy" tone="white" icon="send" size="sm" busy={busy} onPress={() => onShare(pr.market, pr.isLong, pr.leverage)} />
          )}
        </View>
      </View>
    </Animated.View>
  );
}
