import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { readCrewList, usd as fmtUsd } from '@kumi-avax/sdk';
import { Text } from '../../components/T';
import { Screen, SheetHeader } from '../../components/Screen';
import { Btn, Card, CrewAvatar, Empty, Ic, Obj, Skeleton, st, tap } from '../../components/ui';
import { FACTORY, pub, useLive } from '../../lib/chain';
import { crewChat, useApp } from '../../lib/store';
import { C, F, art } from '../../lib/theme';

/** The crew button's screen: the crews this phone is in (read from Fuji), and a way to start one. */
export default function Crews() {
  const { address } = useApp();
  const router = useRouter();
  const live = useLive(async () => (await readCrewList(pub as any, FACTORY, address ?? undefined)).filter(c => c.isMember).reverse(), [address], 8000);
  const mine = live.data ?? [];
  return (
    <Screen>
      <SheetHeader title="Your crews" sub="Friends who pool money and trade by vote" back />
      <Card pad={16}>
        <Pressable testID="start-crew" accessibilityRole="button" accessibilityLabel="Start a crew" onPress={() => { tap(); router.push('/crew/new'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Obj name="jar" size={64} />
          <View style={{ flex: 1 }}>
            <Text style={st.h2}>Start a crew</Text>
            <Text style={{ fontSize: 13.5, color: C.ink2, marginTop: 2 }}>A shared vault on Fuji. Invite friends, chip in, vote on trades.</Text>
          </View>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.coral, alignItems: 'center', justifyContent: 'center' }}><Ic name="plus" size={20} color="#fff" /></View>
        </Pressable>
      </Card>
      {live.error && !live.data && <Card pad={6}><Empty scene={art.scene.offline} alt="A worried penguin holding an unplugged cable" title="Can't reach Fuji" body={live.error} action={<Btn title="Try again" tone="plum" size="sm" onPress={live.reload} />} /></Card>}
      {!live.data && !live.error && <Skeleton rows={2} height={70} />}
      {live.data && (
        <Card pad={6}>
          {mine.length === 0 ? <Empty scene={art.scene.joinCrew} alt="A frog and a fox welcoming a bunny into a chat bubble" title="No crew yet" body="Start one, or open a friend's invite link." />
            : mine.map((c, i) => (
              <Pressable key={c.address} testID={`crew-${c.address.toLowerCase()}`} accessibilityRole="button" accessibilityLabel={`Open ${c.name}`} onPress={() => { tap(); router.replace(`/chat/${crewChat(c.address)}`); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderTopWidth: i ? 1 : 0, borderColor: C.line }}>
                <CrewAvatar id={c.address} size={50} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 16.5, color: C.ink }}>{c.name}</Text>
                  <Text style={{ fontSize: 13, color: C.ink2 }}>{c.members.length} {c.members.length === 1 ? 'member' : 'members'}</Text>
                </View>
                <Text style={{ fontFamily: F.monoBold, fontSize: 13.5, color: C.ink }}>${fmtUsd(c.nav, 0)}</Text>
              </Pressable>
            ))}
        </Card>
      )}
    </Screen>
  );
}
