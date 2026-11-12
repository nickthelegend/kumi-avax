import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Address } from 'viem';
import { MARKETS, describe, parseCommand, parseDecimal, readChannelMessages, readChannels, readCrewMessages, sizeFor, price as fmtPrice, size as fmtSize, usd as fmtUsd, signedUsd, type ChatItem } from '@kumi-avax/sdk';
import { Text, TextInput } from '../../components/T';
import { Backdrop } from '../../components/Screen';
import { Bubble, CallCard, CopyPill, EventPill, PitchCard } from '../../components/Message';
import { Btn, Chip, CrewAvatar, Empty, Ic, Notice, Skeleton, TokenLogo, TxLink, st, tap, useBusy } from '../../components/ui';
import { LOBBY, crewAbi, nameOf, pub, useLive, PERPS, perpsAbi } from '../../lib/chain';
import { callInChannel, copyCall, joinChannel, leaveChannel, pitchInCrew, sayInChannel, sayInCrew, voteInCrew } from '../../lib/actions';
import { useApp } from '../../lib/store';
import { C, F } from '../../lib/theme';

const HINTS: [string, 'coral' | 'pink' | 'butter' | 'mint'][] = [['/long AVAX 3x 20%', 'coral'], ['/short BTC 2x 10%', 'pink'], ['/close AVAX', 'butter']];

/** One chat: a public lobby channel (`l-<id>`) or a crew room (`c-<vault>`), read live from Fuji. */
export default function ChatRoom() {
  const { id, draft } = useLocalSearchParams<{ id: string; draft?: string }>();
  const chat = String(id ?? '');
  const isCrew = chat.startsWith('c-');
  const channel = isCrew ? -1 : Number(chat.slice(2));
  const crew = (isCrew ? chat.slice(2) : '0x') as Address;
  const { address, markSeen, record } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const act = useBusy();
  const [text, setText] = useState(typeof draft === 'string' ? draft : '');
  const [sheet, setSheet] = useState<null | 'call' | { copy: ChatItem }>(null);
  const [lastTxs, setLastTxs] = useState<{ hash: string; label: string }[]>([]);

  const live = useLive(async () => {
    if (isCrew) {
      const [items, name, members, isMember, policy, nav] = await Promise.all([
        readCrewMessages(pub as any, crew, 120),
        pub.readContract({ address: crew, abi: crewAbi, functionName: 'name' }),
        pub.readContract({ address: crew, abi: crewAbi, functionName: 'members' }),
        address ? pub.readContract({ address: crew, abi: crewAbi, functionName: 'isMember', args: [address] }) : Promise.resolve(false),
        pub.readContract({ address: crew, abi: crewAbi, functionName: 'policy' }),
        pub.readContract({ address: crew, abi: crewAbi, functionName: 'nav' }).catch(() => 0n),
      ]);
      return { items, name, members: members.length, joined: isMember, topic: `Crew vault · NAV $${fmtUsd(nav, 2)}`, maxLev: Number(policy[2]), market: undefined as number | undefined };
    }
    const [items, chans] = await Promise.all([readChannelMessages(pub as any, LOBBY, channel, 120), readChannels(pub as any, LOBBY, address ?? undefined)]);
    const c = chans[channel];
    if (!c) throw Error(`No channel #${channel} in the Kumi lobby`);
    return { items, name: c.name, members: c.memberCount, joined: c.joined, topic: c.topic, maxLev: 10, market: c.market };
  }, [chat, address], 4000);

  const d = live.data;
  const items = d?.items ?? [];
  useEffect(() => { if (items.length) markSeen(chat, items[items.length - 1]!.index); }, [items.length, chat]);
  const copiesOf = useMemo(() => {
    const m = new Map<number, ChatItem[]>();
    for (const it of items) if (it.kind === 'copy') m.set(it.ref, [...(m.get(it.ref) ?? []), it]);
    return m;
  }, [items]);
  const parsed = isCrew ? parseCommand(text, d?.maxLev ?? 5) : null;
  const list = useMemo(() => [...items].reverse(), [items]);

  const sendText = () => act.run('Sending', async () => {
    const t = text.trim();
    if (!t) return;
    let tx;
    if (isCrew && parsed) {
      if (!parsed.ok) throw Error(parsed.error);
      tx = await pitchInCrew(crew, parsed.cmd);
    } else tx = isCrew ? await sayInCrew(crew, t) : await sayInChannel(channel, t);
    record([tx]); setLastTxs([tx]); setText(''); live.reload();
  });

  const renderItem = ({ item: m, index }: { item: ChatItem; index: number }) => {
    const prev = list[index + 1];
    const showWho = !prev || prev.who !== m.who || prev.kind !== 'chat' || m.ts - prev.ts > 600;
    switch (m.kind) {
      case 'chat': return <Bubble m={m} me={address} showWho={showWho} />;
      case 'call': return <CallCard m={m} me={address} copies={copiesOf.get(m.index) ?? []} canCopy={!!d?.joined} busy={act.busy !== null && sheet !== null} onCopy={() => setSheet({ copy: m })} />;
      case 'copy': return <CopyPill m={m} me={address} />;
      case 'pitch': return <PitchCard crew={crew} m={m} me={address} isMember={!!d?.joined} busy={act.busy !== null} onVote={(pid, yes) => act.run('Voting', async () => { const tx = await voteInCrew(crew, pid, yes); record([tx]); setLastTxs([tx]); live.reload(); })} />;
      case 'join': return <EventPill m={m} me={address} tone="mint" icon="plus" text="joined the chat" />;
      case 'leave': return <EventPill m={m} me={address} tone="pink" icon="exit" text="left the chat" />;
      case 'vote-yes': return <EventPill m={m} me={address} tone="butter" icon="thumb" text={`voted yes on #${m.ref}`} />;
      case 'vote-no': return <EventPill m={m} me={address} tone="pink" icon="thumbDown" text={`voted no on #${m.ref}`} />;
      case 'executed': return <EventPill m={m} me={address} tone="coral" icon="bolt" text={m.text || `cast the deciding vote: #${m.ref} traded on the book`} />;
      case 'failed': return <EventPill m={m} me={address} tone="pink" icon="x" text={`#${m.ref} passed but did not fill`} />;
      case 'deposit': return <EventPill m={m} me={address} tone="butter" icon="coin" text={<>chipped in <Text style={{ fontFamily: F.monoBold }}>{fmtUsd(m.amount)}</Text> tUSDC</>} />;
      case 'ragequit': return <EventPill m={m} me={address} tone="pink" icon="exit" text={<>ragequit with <Text style={{ fontFamily: F.monoBold }}>{fmtUsd(m.amount)}</Text> tUSDC</>} />;
      case 'captain': return <EventPill m={m} me={address} tone="coral" icon="bolt" text={m.text || 'traded in the captain lane'} />;
      case 'member': return <EventPill m={m} me={address} tone="mint" icon="plus" text="was voted into the crew" />;
      default: return <EventPill m={m} me={address} tone="butter" icon="clock" text={`pitch #${m.ref} expired`} />;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.cream }}>
      <Backdrop />
      {/* header */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,249,241,0.94)', borderBottomWidth: 1, borderColor: C.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to chats" onPress={() => { tap(); router.canGoBack() ? router.back() : router.replace('/'); }} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 2, borderColor: C.edge }}>
          <Ic name="back" size={17} />
        </Pressable>
        <CrewAvatar id={isCrew ? crew : `lobby-${channel}`} size={42} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 18, color: C.ink }}>{d?.name ?? ' '}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.mint }} />
            <Text numberOfLines={1} style={{ fontSize: 12.5, color: C.mintInk, fontWeight: '700' }}>Live on Fuji</Text>
            <Text numberOfLines={1} style={{ fontSize: 12.5, color: C.ink2, flexShrink: 1 }}>· {d ? `${d.members} members` : ''}</Text>
          </View>
        </View>
        <Pressable testID="invite" accessibilityRole="button" accessibilityLabel="Invite people" onPress={() => { tap(); router.push({ pathname: '/invite', params: { chat, name: d?.name ?? '' } }); }} hitSlop={10} style={{ height: 38, paddingHorizontal: 12, borderRadius: 19, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.plum }}>
          <Ic name="qr" size={15} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Invite</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {live.error && !d && <View style={{ padding: 16 }}><Notice error>Could not read this chat from Fuji: {live.error}</Notice></View>}
        {!d && !live.error && <View style={{ padding: 16 }}><Skeleton rows={5} height={70} /></View>}
        {d && (
          <FlatList
            inverted
            data={list}
            keyExtractor={m => m.key}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 14, gap: 12 }}
            ListFooterComponent={<View style={{ alignItems: 'center', gap: 8, paddingVertical: 10 }}>
              <Text style={{ fontSize: 13, color: C.ink2, textAlign: 'center' }}>{d.topic}</Text>
              <Text style={{ fontSize: 11.5, color: C.ink3, textAlign: 'center' }}>{isCrew ? 'On-chain chat in the crew vault' : `KumiLobby channel #${channel}`} · {items.length} messages shown</Text>
            </View>}
            ListEmptyComponent={<Empty obj="empty" title="Quiet in here" body={isCrew ? 'Chip in, then pitch a perp with /long AVAX 3x 20%.' : 'Say hi, or post the first trade call.'} />}
          />
        )}

        {/* composer */}
        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 10, backgroundColor: 'rgba(255,249,238,0.97)', borderTopWidth: 1, borderColor: C.line, gap: 8 }}>
          {act.error && <Notice error>{act.error}</Notice>}
          {lastTxs.length > 0 && !act.busy && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><Text style={{ fontSize: 12, color: C.mintInk, fontWeight: '700' }}>Sent on Fuji</Text>{lastTxs.map(t => <TxLink key={t.hash} hash={t.hash} label={t.label} />)}</View>}
          {act.busy && <Text style={{ fontSize: 12.5, color: C.ink2, fontWeight: '600' }}>{act.busy}… signing on this phone</Text>}
          {d && !d.joined ? (
            isCrew ? (
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 13.5, color: C.ink2 }}><Text style={{ fontWeight: '800', color: C.ink }}>Invite-only.</Text> Members vote new people in. Show a member your code; they scan it and pitch /invite.</Text>
                <Btn title="Show my join code" tone="plum" icon="qr" onPress={() => router.push({ pathname: '/invite', params: { chat, name: d.name, request: '1' } })} />
              </View>
            ) : (
              <Btn testID="join-chat" title={`Join ${d.name}`} tone="mint" icon="plus" busy={act.busy !== null} onPress={() => act.run('Joining', async () => { const tx = await joinChannel(channel); record([tx]); setLastTxs([tx]); live.reload(); })} />
            )
          ) : d ? (
            <>
              {isCrew && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {HINTS.map(([h, tone]) => <Pressable key={h} onPress={() => { tap(); setText(h); }} style={{ height: 32, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', backgroundColor: tone === 'coral' ? C.coralSoft : tone === 'pink' ? C.pinkSoft : tone === 'butter' ? C.butterSoft : C.mintSoft }}><Text style={{ fontWeight: '700', fontSize: 12.5, color: tone === 'coral' ? C.coralInk : tone === 'pink' ? C.pinkInk : C.butterInk }}>{h}</Text></Pressable>)}
                </ScrollView>
              )}
              {parsed && <Text style={{ fontSize: 12.5, color: parsed.ok ? C.coralInk : C.pinkInk, fontWeight: '600' }}>{parsed.ok ? `Pitch: ${describe(parsed.cmd)}. Your shares vote yes; it trades when yes passes 50%.` : parsed.error}</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {!isCrew && (
                  <Pressable testID="new-call" accessibilityRole="button" accessibilityLabel="Post a trade call" onPress={() => { tap(); setSheet('call'); }} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.butter, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4, borderColor: C.butterEdge }}>
                    <Ic name="bolt" size={20} color={C.plum2} />
                  </Pressable>
                )}
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 5, height: 54, borderRadius: 27, backgroundColor: '#fff', borderWidth: 3, borderColor: '#fff', borderBottomWidth: 6, borderBottomColor: C.edge }}>
                  <TextInput testID="composer" value={text} onChangeText={setText} placeholder={isCrew ? 'Message the crew, or /long AVAX 3x 20%' : `Message ${d.name}`} placeholderTextColor={C.ink3} maxLength={280} returnKeyType="send" onSubmitEditing={sendText}
                    style={{ flex: 1, fontSize: 15.5, color: C.ink, height: 44, outlineStyle: 'none' } as any} />
                  <Pressable testID="send" accessibilityRole="button" accessibilityLabel="Send" disabled={!text.trim() || act.busy !== null} onPress={sendText} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: text.trim() ? C.coral : C.coralSoft }}>
                    <Ic name="send" size={18} color="#fff" />
                  </Pressable>
                </View>
              </View>
              <Text style={{ fontSize: 11, color: C.ink3, textAlign: 'center' }}>Every message is a Fuji transaction signed on this phone.{!isCrew ? ' ⚡ posts a trade call.' : ''}</Text>
            </>
          ) : null}
          {d && d.joined && !isCrew && <Pressable onPress={() => act.run('Leaving', async () => { const tx = await leaveChannel(channel); record([tx]); live.reload(); })} accessibilityRole="button"><Text style={{ fontSize: 11.5, color: C.ink3, textAlign: 'center', textDecorationLine: 'underline' }}>Leave {d.name}</Text></Pressable>}
        </View>
      </KeyboardAvoidingView>

      {sheet === 'call' && <CallSheet channel={channel} defaultMarket={d?.market ?? 0} onClose={() => setSheet(null)} onDone={txs => { record(txs); setLastTxs(txs); live.reload(); }} />}
      {sheet && typeof sheet === 'object' && <CopySheet channel={channel} call={sheet.copy} onClose={() => setSheet(null)} onDone={txs => { record(txs); setLastTxs(txs.slice(-2)); live.reload(); }} />}
    </View>
  );
}

function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(42,20,54,0.45)' }} onPress={onClose} accessibilityLabel="Close" />
      <View style={{ backgroundColor: C.cream, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 18, paddingBottom: insets.bottom + 18, gap: 14, maxHeight: '88%' }}>
        <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.line2 }} />
        <View style={st.between}>
          <Text style={{ fontWeight: '800', fontSize: 22, color: C.ink }}>{title}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}><Ic name="x" size={20} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string; tone?: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: C.panel3, gap: 4 }}>
      {options.map(o => (
        <Pressable key={String(o.v)} accessibilityRole="button" accessibilityState={{ selected: value === o.v }} onPress={() => { tap(); onChange(o.v); }} style={{ flex: 1, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: value === o.v ? (o.tone ?? C.plum) : 'transparent' }}>
          <Text style={{ fontWeight: '700', fontSize: 14, color: value === o.v ? '#fff' : C.ink2 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Post a trade call to a lobby channel: market, side, leverage, suggested margin, a note. */
function CallSheet({ channel, defaultMarket, onClose, onDone }: { channel: number; defaultMarket: number; onClose: () => void; onDone: (txs: { hash: string; label: string }[]) => void }) {
  const [market, setMarket] = useState(defaultMarket);
  const [long, setLong] = useState(true);
  const [lev, setLev] = useState(3);
  const [margin, setMargin] = useState('50');
  const [note, setNote] = useState('');
  const act = useBusy();
  const mk = MARKETS[market]!;
  return (
    <Sheet title="Post a trade call" onClose={onClose}>
      <Seg value={market} onChange={setMarket} options={MARKETS.map(m => ({ v: m.id, label: m.pair }))} />
      <Seg value={long ? 'l' : 's'} onChange={v => setLong(v === 'l')} options={[{ v: 'l', label: 'Long', tone: C.coral }, { v: 's', label: 'Short', tone: C.plum }]} />
      <View style={{ gap: 6 }}>
        <Text style={st.k}>Leverage</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>{[1, 2, 3, 5, 10].map(l => <Pressable key={l} onPress={() => { tap(); setLev(l); }} style={{ flex: 1, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: lev === l ? C.butter : '#fff', borderWidth: 2, borderColor: lev === l ? C.butterEdge : C.edge }}><Text style={{ fontFamily: F.monoBold, fontSize: 14, color: C.ink }}>{l}x</Text></Pressable>)}</View>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={st.k}>Suggested margin (tUSDC)</Text>
        <TextInput value={margin} onChangeText={setMargin} keyboardType="decimal-pad" style={inp} />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={st.k}>Why (optional)</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="higher low at 8.50, invalid under 8.40" placeholderTextColor={C.ink3} maxLength={280} style={inp} />
      </View>
      <Notice>A call moves no money. Anyone in the chat can copy it: their phone places their own order on KumiPerps, and the lobby checks the position before it shows "copied".</Notice>
      {act.error && <Notice error>{act.error}</Notice>}
      <Btn testID="post-call" title={act.busy ? `${act.busy}…` : `Call ${long ? 'Long' : 'Short'} ${mk.symbol} ${lev}x`} tone={long ? 'coral' : 'plum'} size="lg" busy={act.busy !== null}
        onPress={() => act.run('Posting the call', async () => { const tx = await callInChannel(channel, market, long, lev, parseDecimal(margin, 6), note.trim()); onDone([tx]); onClose(); })} />
    </Sheet>
  );
}
const inp = { height: 50, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: C.edge, paddingHorizontal: 14, fontSize: 16, color: C.ink, outlineStyle: 'none' } as any;

/** Copy a call: shows the live book's fill estimate, then margin in, an IOC order, and the lobby's checked copy. */
function CopySheet({ channel, call, onClose, onDone }: { channel: number; call: ChatItem; onClose: () => void; onDone: (txs: { hash: string; label: string }[]) => void }) {
  const mk = MARKETS[call.market ?? 0]!;
  const [margin, setMargin] = useState(fmtUsd(call.amount, 0).replace(/,/g, ''));
  const [done, setDone] = useState<{ hash: string; label: string }[] | null>(null);
  const act = useBusy();
  const book = useLive(() => pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'getMarket', args: [mk.id] }), [mk.id], 4000);
  let est = '';
  try {
    const touch = call.isLong ? book.data?.bestAsk : book.data?.bestBid;
    if (touch) { const sz = sizeFor(mk, parseDecimal(margin || '0', 6), call.leverage ?? 1, touch); est = `${fmtSize(sz, mk.sizeDp)} ${mk.symbol} at about $${fmtPrice(touch, mk.priceDp)}`; }
  } catch { est = ''; }
  return (
    <Sheet title={`Copy #${call.index}`} onClose={onClose}>
      <View style={[st.row, { padding: 14, borderRadius: 22, backgroundColor: call.isLong ? C.coralSoft : C.plumSoft }]}>
        <TokenLogo sym={mk.symbol} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.display, fontSize: 22, color: C.ink }}>{call.isLong ? 'LONG' : 'SHORT'} {mk.symbol} {call.leverage}X</Text>
          <Text style={{ fontSize: 13, color: C.ink2 }}>called by {nameOf(call.who)}{call.price ? ` at $${fmtPrice(call.price, mk.priceDp)}` : ''}</Text>
        </View>
      </View>
      {!done ? (
        <>
          <View style={{ gap: 6 }}>
            <Text style={st.k}>Your margin (tUSDC)</Text>
            <TextInput testID="copy-margin" value={margin} onChangeText={setMargin} keyboardType="decimal-pad" style={inp} />
            <Text style={{ fontSize: 13, color: C.ink2 }}>{est ? `≈ ${est} on the live book` : 'Reading the book…'}</Text>
          </View>
          <View style={{ gap: 6 }}>
            {['Deposit margin into KumiPerps (approve once)', 'Market order (IOC) on the on-chain book, max 0.5% past the touch', 'Lobby checks your new position and posts the copy'].map((s, i) => (
              <View key={s} style={st.row}><View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.butter, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.monoBold, fontSize: 11, color: C.plum2 }}>{i + 1}</Text></View><Text style={{ fontSize: 13.5, color: C.ink2, flex: 1 }}>{s}</Text></View>
            ))}
          </View>
          {act.error && <Notice error>{act.error}</Notice>}
          <Btn testID="confirm-copy" title={act.busy ? `${act.busy}…` : 'Sign on this phone and copy'} tone={call.isLong ? 'coral' : 'plum'} size="lg" busy={act.busy !== null}
            onPress={() => act.run('Starting', async step => { const r = await copyCall(channel, call, parseDecimal(margin, 6), step); setDone(r.txs); onDone(r.txs); })} />
        </>
      ) : (
        <View style={{ gap: 10 }}>
          <Empty obj="success" title="Copied on the book" body="Your order filled on KumiPerps and the lobby recorded your position." />
          {done.map(t => <View key={t.hash} style={st.between}><Text style={{ fontSize: 13.5, color: C.ink }}>{t.label}</Text><TxLink hash={t.hash} /></View>)}
          <Btn title="Back to the chat" tone="plum" onPress={onClose} />
        </View>
      )}
    </Sheet>
  );
}
