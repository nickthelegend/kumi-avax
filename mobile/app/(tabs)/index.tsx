import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { readChannelMessages, readChannels, readCrewList, readCrewMessages, preview, unreadCount, usd as fmtUsd, type ChatItem } from '@kumi-avax/sdk';
import { Text } from '../../components/T';
import { Screen } from '../../components/Screen';
import { Avatar, Brand, Btn, Card, Chip, CrewAvatar, Empty, Ic, Notice, Skeleton, TokenLogo, ago, st, tap, useBusy } from '../../components/ui';
import { FACTORY, LOBBY, nameOf, pub, useLive } from '../../lib/chain';
import { joinChannel } from '../../lib/actions';
import { crewChat, lobbyChat, useApp } from '../../lib/store';
import { C, F, TONE, crewTone, art } from '../../lib/theme';
import { MARKETS } from '@kumi-avax/sdk';

type Row = { chat: string; name: string; kind: 'channel' | 'crew'; idKey: string; last?: ChatItem; unread: number; members: number; joined: boolean; sub: string; market?: number; nav?: bigint };

/** Chats: the crews and public channels this phone is in, then the public lobby to join, all read from Fuji. */
export default function Chats() {
  const { address, seen, setUnread, record } = useApp();
  const router = useRouter();
  const join = useBusy();
  const [joining, setJoining] = useState<number | null>(null);
  const live = useLive(async () => {
    const [chans, crews] = await Promise.all([readChannels(pub as any, LOBBY, address ?? undefined), readCrewList(pub as any, FACTORY, address ?? undefined)]);
    const [cLast, kLast] = await Promise.all([
      Promise.all(chans.map(c => readChannelMessages(pub as any, LOBBY, c.id, 30))),
      Promise.all(crews.map(k => readCrewMessages(pub as any, k.address, 30))),
    ]);
    return { chans, crews, cLast, kLast };
  }, [address], 6000);

  const rows = useMemo<Row[]>(() => {
    const d = live.data;
    if (!d) return [];
    const chanRows: Row[] = d.chans.map((c, i) => {
      const items = d.cLast[i]!;
      const chat = lobbyChat(c.id);
      const visible = items.filter(m => m.kind !== 'join' && m.kind !== 'leave');
      return { chat, name: c.name, kind: 'channel', idKey: `lobby-${c.id}`, last: visible[visible.length - 1] ?? items[items.length - 1], unread: c.joined ? unreadCount(items, seen[chat] ?? -1, address ?? undefined) : 0, members: c.memberCount, joined: c.joined, sub: c.topic, market: c.market };
    });
    const crewRows: Row[] = d.crews.map((k, i) => {
      const items = d.kLast[i]!;
      const chat = crewChat(k.address);
      return { chat, name: k.name, kind: 'crew', idKey: k.address, last: items[items.length - 1], unread: k.isMember ? unreadCount(items, seen[chat] ?? -1, address ?? undefined) : 0, members: k.members.length, joined: k.isMember, sub: 'Crew vault · invite-only', nav: k.nav };
    });
    return [...chanRows, ...crewRows].sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0));
  }, [live.data, seen, address]);

  const mine = rows.filter(r => r.joined);
  const lobby = rows.filter(r => !r.joined && r.kind === 'channel');
  const crews = rows.filter(r => !r.joined && r.kind === 'crew');
  const totalUnread = mine.reduce((s, r) => s + r.unread, 0);
  useEffect(() => { setUnread(totalUnread); }, [totalUnread]);

  return (
    <Screen tabs>
      <View style={st.between}>
        <Brand size={30} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Scan or paste an invite" testID="scan" onPress={() => { tap(); router.push('/scan'); }}
            style={{ height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: '#fff', borderWidth: 2, borderColor: C.edge, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ic name="qr" size={16} color={C.plum} /><Text style={{ fontWeight: '700', fontSize: 14, color: C.plum }}>Join</Text>
          </Pressable>
          {address && <Pressable accessibilityRole="button" accessibilityLabel="Your wallet" onPress={() => router.push('/wallet')}><Avatar address={address} size={42} ring="#fff" /></Pressable>}
        </View>
      </View>

      <View>
        <Text style={{ fontWeight: '800', fontSize: 30, lineHeight: 36, color: C.ink, letterSpacing: -0.6 }}>Your chats</Text>
      </View>

      {live.error && !live.data && <Card pad={6}><Empty scene={art.scene.offline} alt="A worried penguin holding an unplugged cable" title="Can't reach Fuji" body={`Could not read the chats: ${live.error}`} action={<Btn title="Try again" tone="plum" size="sm" onPress={live.reload} />} /></Card>}
      {join.error && <Notice error>{join.error}</Notice>}
      {!live.data && !live.error && <Skeleton rows={4} height={76} />}

      {live.data && (
        <Card pad={6}>
          {mine.length === 0 ? (
            <Empty scene={art.scene.joinCrew} alt="A frog and a fox welcoming a bunny into a chat bubble" title="No chats yet" body="Start a crew with your friends, or join a public chat below and copy calls." action={<Btn testID="start-crew-empty" title="Start a crew" tone="coral" size="sm" icon="plus" onPress={() => router.push('/crew/new')} />} />
          ) : mine.map((r, i) => <ChatRow key={r.chat} r={r} me={address} first={i === 0} onPress={() => router.push(`/chat/${r.chat}`)} />)}
        </Card>
      )}

      {live.data && lobby.length > 0 && (
        <View style={{ gap: 10 }}>
          <View style={st.between}>
            <Text style={st.h2}>Public lobby</Text>
            <Chip text={`${lobby.length} open`} tone="mint" dot />
          </View>
          {lobby.map(r => {
            const id = Number(r.chat.slice(2));
            return (
              <Card key={r.chat} pad={14}>
                <Pressable onPress={() => router.push(`/chat/${r.chat}`)} style={{ gap: 10 }} accessibilityRole="button" accessibilityLabel={`Open ${r.name}`}>
                  <View style={st.row}>
                    <CrewAvatar id={r.idKey} size={48} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '800', fontSize: 17, color: C.ink }}>{r.name}</Text>
                      <Text style={{ fontSize: 13, color: C.ink2 }} numberOfLines={1}>{r.sub}</Text>
                    </View>
                    {r.market !== undefined && <TokenLogo sym={MARKETS[r.market]!.symbol} size={26} />}
                  </View>
                  {r.last && <Text numberOfLines={1} style={{ fontSize: 13.5, color: C.ink2 }}>{preview(r.last, a => nameOf(a, address))}</Text>}
                  <View style={st.between}>
                    <Text style={{ fontSize: 12.5, color: C.ink3, fontWeight: '600' }}>{r.members} members · active {r.last ? ago(r.last.ts) : '–'} ago</Text>
                    <Btn testID={`join-${id}`} title={joining === id ? 'Joining…' : 'Join'} size="sm" tone="mint" icon="plus" busy={joining === id} onPress={() => { setJoining(id); join.run('Joining', async () => { const tx = await joinChannel(id); record([tx]); live.reload(); router.push(`/chat/${r.chat}`); }).finally(() => setJoining(null)); }} />
                  </View>
                </Pressable>
              </Card>
            );
          })}
        </View>
      )}

      {live.data && crews.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={st.h2}>Crews on Kumi</Text>
          <Text style={{ fontSize: 13.5, color: C.ink2, marginTop: -4 }}>Crews are invite-only vaults that trade by vote. Watch the chat, or show a member your code to get voted in.</Text>
          <Card pad={6}>{crews.map((r, i) => <ChatRow key={r.chat} r={r} me={address} first={i === 0} onPress={() => router.push(`/chat/${r.chat}`)} />)}</Card>
        </View>
      )}
    </Screen>
  );
}

function ChatRow({ r, me, first, onPress }: { r: Row; me: string | null; first: boolean; onPress: () => void }) {
  const tone = TONE[crewTone(r.idKey)];
  return (
    <Pressable testID={`chat-${r.chat}`} accessibilityRole="button" accessibilityLabel={`${r.name}${r.unread ? `, ${r.unread} unread` : ''}`} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: pressed ? tone.soft : 'transparent', borderTopWidth: first ? 0 : 1, borderColor: C.line })}>
      <CrewAvatar id={r.idKey} size={50} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 16.5, color: C.ink, flexShrink: 1 }}>{r.name}</Text>
          <Chip text={r.kind === 'crew' ? 'crew' : 'public'} tone={r.kind === 'crew' ? 'plum' : 'mint'} style={{ height: 20, paddingHorizontal: 7 }} textStyle={{ fontSize: 10.5 }} />
        </View>
        <Text numberOfLines={1} style={{ fontSize: 13.5, color: r.unread ? C.ink : C.ink2, fontWeight: r.unread ? '600' : '400', marginTop: 1 }}>{r.last ? preview(r.last, a => nameOf(a, me)) : 'No messages yet'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.ink3 }}>{r.last ? ago(r.last.ts) : ''}</Text>
        {r.unread > 0 ? (
          <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: C.coral, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 11.5, fontWeight: '800', color: '#fff' }}>{r.unread}</Text></View>
        ) : r.nav !== undefined ? <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.ink2 }}>${fmtUsd(r.nav, 0)}</Text> : <Text style={{ fontSize: 11, color: C.ink3 }}>{r.members} in</Text>}
      </View>
    </Pressable>
  );
}
