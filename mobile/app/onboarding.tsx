import { useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Text, TextInput } from '../components/T';
import { Screen } from '../components/Screen';
import { Brand, Btn, Card, Ic, Notice, Obj, TxLink, st, useBusy } from '../components/ui';
import { useApp, askNotificationPermission } from '../lib/store';
import { C, F, art } from '../lib/theme';
import { FAUCET_URL, pub } from '../lib/chain';
import { getTestUsdc } from '../lib/actions';
import { SetupError, getGas } from '../lib/kumiApi';
import { signer } from '../lib/wallet';

type StepState = { state: 'wait' | 'busy' | 'done' | 'fail'; hash?: string };
type Start = { gas: StepState; usdc: StepState; error?: string; setup?: boolean };

/** One row of the gas-free start: a spinner while it runs, a check (with its Snowtrace link) when it lands. */
function StartRow({ s, title }: { s: StepState; title: string }) {
  return (
    <View style={st.row}>
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: s.state === 'done' ? C.mint : s.state === 'fail' ? C.pinkSoft : C.panel3 }}>
        {s.state === 'busy' ? <ActivityIndicator size="small" color={C.plum} /> : s.state === 'done' ? <Ic name="check" size={15} color="#08311f" /> : s.state === 'fail' ? <Ic name="x" size={14} color={C.pinkInk} /> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 14.5, color: C.ink, fontWeight: s.state === 'busy' ? '700' : '500' }}>{title}</Text>
      {s.hash ? <TxLink hash={s.hash} /> : null}
    </View>
  );
}

/** First run: make (or import) the phone's Fuji wallet, then a short tour of what Kumi does. */
export default function Onboarding() {
  const app = useApp();
  const router = useRouter();
  const act = useBusy();
  const [importing, setImporting] = useState(false);
  const [key, setKey] = useState('');
  const [start, setStart] = useState<Start | null>(null);
  /** Gas from Kumi's sponsor, then 1,000 test USDC, both landing on Fuji before Kumi opens. */
  const fund = async () => {
    const s: Start = { gas: { state: 'busy' }, usdc: { state: 'wait' } };
    setStart({ ...s });
    try {
      const me = signer().address;
      if ((await pub.getBalance({ address: me })) > 0n) s.gas = { state: 'done' };
      else { const g = await getGas(); s.gas = { state: 'done', hash: g.hash }; app.record([{ hash: g.hash, label: 'Gas from Kumi' }]); }
      s.usdc = { state: 'busy' }; setStart({ ...s });
      const tx = await getTestUsdc();
      app.record([tx]);
      s.usdc = { state: 'done', hash: tx.hash };
      setStart({ ...s });
    } catch (e) {
      if (s.gas.state === 'busy') s.gas = { state: 'fail' }; else s.usdc = { state: 'fail' };
      setStart({ ...s, error: (e as Error).message, setup: e instanceof SetupError });
    }
  };
  const finish = async () => { await askNotificationPermission().catch(() => false); await app.finishOnboarding(); router.replace('/'); };

  return (
    <Screen>
      <View style={[st.between, { marginTop: 4 }]}><Brand size={32} /><Text style={{ fontSize: 12.5, color: C.ink3, fontWeight: '700' }}>Avalanche Fuji testnet</Text></View>
      <View style={{ borderRadius: 28, backgroundColor: '#22102b', paddingBottom: 7 }}>
        <View style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: C.plum }}>
          <Image source={art.hero} style={{ width: '100%', aspectRatio: 1.45 }} contentFit="cover" />
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ fontWeight: '800', fontSize: 32, lineHeight: 37, color: C.ink, letterSpacing: -0.7 }}>Your group chat is a fund.</Text>
        <Text style={{ fontSize: 16, lineHeight: 23, color: C.ink2 }}>Chat with your crew, call a trade, and copy it with one tap. Orders fill on Kumi's on-chain order book on Avalanche, signed right here on your phone.</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={232} decelerationRate="fast" contentContainerStyle={{ gap: 12, paddingRight: 8 }} style={{ marginHorizontal: -16, paddingLeft: 16 }}>
        {([[art.scene.onboard1, 'Start a crew', 'A cat, a bunny and a bear waving from chat bubbles'], [art.scene.onboard2, 'Vote on trades together', 'A fox and a frog giving thumbs up beside a rising chart'], [art.scene.onboard3, 'Leave anytime with your share', 'A bunny walking out a door with a jar of coins']] as const).map(([img, t, alt]) => (
          <View key={t} style={{ width: 220, borderRadius: 24, backgroundColor: C.edge, paddingBottom: 5 }}>
            <View style={{ borderRadius: 24, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 3, borderColor: '#fff' }}>
              <Image source={img} accessibilityLabel={alt} style={{ width: '100%', aspectRatio: 1.25 }} contentFit="cover" />
              <Text style={{ fontWeight: '800', fontSize: 15, color: C.ink, padding: 10 }}>{t}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {!app.address ? (
        <Card pad={16}>
          <View style={{ gap: 12 }}>
            <View style={st.row}><Obj name="shield" size={54} /><Text style={{ flex: 1, fontSize: 14, color: C.ink2, lineHeight: 20 }}>Kumi makes a wallet on this phone. The key stays in the phone's keystore; Kumi has no server that holds it.</Text></View>
            {act.error && <Notice error>{act.error}</Notice>}
            {!importing ? (
              <>
                <Btn testID="create-wallet" title="Create my wallet" size="lg" busy={act.busy !== null} onPress={() => act.run('Creating', async () => { await app.createWallet(); void fund(); })} />
                <Btn title="I have a Fuji key" tone="ghost" onPress={() => setImporting(true)} />
              </>
            ) : (
              <>
                <TextInput value={key} onChangeText={setKey} placeholder="0x… private key (Fuji test wallet)" placeholderTextColor={C.ink3} secureTextEntry autoCapitalize="none" autoCorrect={false}
                  style={{ height: 50, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: C.edge, paddingHorizontal: 14, fontSize: 15, color: C.ink, fontFamily: F.mono, outlineStyle: 'none' } as any} />
                <Btn title="Import" size="lg" tone="plum" busy={act.busy !== null} onPress={() => act.run('Importing', async () => { await app.importWallet(key); setKey(''); void fund(); })} />
                <Btn title="Make a new one instead" tone="ghost" onPress={() => setImporting(false)} />
              </>
            )}
          </View>
        </Card>
      ) : (
        <Card pad={16}>
          <View style={{ gap: 12 }}>
            <View style={st.row}><Image source={art.scene.wallet} accessibilityLabel="A happy coral wallet with coins dropping in" style={{ width: 58, height: 58 }} contentFit="contain" /><View style={{ flex: 1 }}><Text style={st.h2}>Wallet ready</Text><Text style={{ fontFamily: F.mono, fontSize: 12, color: C.ink2 }}>{app.address}</Text></View></View>
            {start && (
              <View testID="gas-free-start" style={{ gap: 10, padding: 12, borderRadius: 18, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line }}>
                <StartRow s={start.gas} title="Gas from Kumi · 0.0002 AVAX" />
                <StartRow s={start.usdc} title="1,000 test USDC" />
                {start.error && <Notice error>{start.error}</Notice>}
                {start.error && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Btn title="Try again" tone="plum" size="sm" onPress={() => void fund()} style={{ flex: 1 }} />
                    {start.setup && <Btn title="Fuji faucet" tone="white" size="sm" icon="external" onPress={() => Linking.openURL(FAUCET_URL)} style={{ flex: 1 }} />}
                  </View>
                )}
              </View>
            )}
            {[['chat', 'Join a public chat, or open your crew'], ['rocket', 'Copy a trade call: your order fills on the book'], ['vote', 'In a crew, vote pitches with your shares']].map(([o, t]) => (
              <View key={t} style={st.row}><Obj name={o as any} size={40} still /><Text style={{ flex: 1, fontSize: 14.5, color: C.ink }}>{t}</Text></View>
            ))}
            <View style={st.row}><Image source={art.scene.notify} accessibilityLabel="A ringing coral bell" style={{ width: 40, height: 40 }} contentFit="contain" /><Text style={{ flex: 1, fontSize: 13.5, color: C.ink2 }}>Next, Kumi asks to notify you when someone posts a call. You can say no.</Text></View>
            <Btn testID="finish-onboarding" title={start && (start.gas.state === 'busy' || start.usdc.state === 'busy') ? 'Funding your wallet…' : 'Open Kumi'} size="lg" disabled={!!start && (start.gas.state === 'busy' || start.usdc.state === 'busy')} onPress={() => act.run('Opening', finish)} />
            <Btn title="Back up the key first" tone="white" icon="key" onPress={() => router.push('/backup')} />
          </View>
        </Card>
      )}
      <Text style={{ fontSize: 11.5, color: C.ink3, textAlign: 'center' }}>Testnet only. Test money (tUSDC); Kumi covers your first gas. MIT · © 2026 Nivesh Gajengi</Text>
    </Screen>
  );
}
