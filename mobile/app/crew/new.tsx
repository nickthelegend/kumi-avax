import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text, TextInput } from '../../components/T';
import { Screen, SheetHeader } from '../../components/Screen';
import { inp } from '../../components/Sheet';
import { Btn, Card, Notice, Obj, st, useBusy } from '../../components/ui';
import { CREW_POLICY, createCrew } from '../../lib/actions';
import { crewChat, useApp } from '../../lib/store';
import { C, F } from '../../lib/theme';

const RULES: [string, string][] = [
  ['Votes', 'A trade passes when yes votes hold over half of all shares'],
  ['Shares', 'Chip in tUSDC, get shares at the fund\'s value'],
  ['Limits', `Up to ${CREW_POLICY.maxLeverage}x across the crew, ${CREW_POLICY.maxSlippageBps / 100}% max slippage`],
  ['Leaving', 'Anyone can leave with their exact share, any time'],
];

/** Start a crew: one KumiCrewFactory.createCrew from this phone, which becomes its first member. */
export default function NewCrew() {
  const router = useRouter();
  const { record } = useApp();
  const [name, setName] = useState('');
  const act = useBusy();
  const ok = name.trim().length >= 2 && name.trim().length <= 32;
  return (
    <Screen>
      <SheetHeader title="Start a crew" sub="Your group chat becomes a fund on Fuji" back />
      <Card pad={18}>
        <View style={{ gap: 12 }}>
          <View style={{ alignItems: 'center' }}><Obj name="jar" size={96} /></View>
          <Text style={st.k}>Crew name</Text>
          <TextInput testID="crew-name" value={name} onChangeText={setName} placeholder="Pond Club" placeholderTextColor={C.ink3} maxLength={32} autoCorrect={false} returnKeyType="done" style={[inp, { fontSize: 18, fontWeight: '700' }]} />
        </View>
      </Card>
      <Card pad={16}>
        <View style={{ gap: 10 }}>
          <Text style={st.h2}>House rules</Text>
          {RULES.map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={{ width: 70, fontFamily: F.monoBold, fontSize: 12.5, color: C.coralInk, marginTop: 1 }}>{k}</Text>
              <Text style={{ flex: 1, fontSize: 14, color: C.ink2, lineHeight: 20 }}>{v}</Text>
            </View>
          ))}
        </View>
      </Card>
      {act.error && <Notice error>{act.error}</Notice>}
      <Btn testID="create-crew" size="lg" tone="coral" icon="plus" disabled={!ok} busy={act.busy !== null} title={act.busy ? `${act.busy}…` : `Start ${name.trim() || 'the crew'}`}
        onPress={() => act.run('Creating the vault on Fuji', async () => { const r = await createCrew(name.trim()); record([r.tx]); router.replace({ pathname: `/chat/${crewChat(r.crew)}` as any, params: { fresh: '1' } }); })} />
      <Text style={{ fontSize: 12, color: C.ink3, textAlign: 'center' }}>Signed on this phone. The vault is a KumiCrew contract; its money trades on KumiPerps.</Text>
    </Screen>
  );
}
