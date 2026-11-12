import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Text, TextInput } from '../components/T';
import { Screen } from '../components/Screen';
import { Brand, Btn, Card, Notice, Obj, st, useBusy } from '../components/ui';
import { useApp, askNotificationPermission } from '../lib/store';
import { C, F, art } from '../lib/theme';

/** First run: make (or import) the phone's Fuji wallet, then a short tour of what Kumi does. */
export default function Onboarding() {
  const app = useApp();
  const router = useRouter();
  const act = useBusy();
  const [importing, setImporting] = useState(false);
  const [key, setKey] = useState('');
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

      {!app.address ? (
        <Card pad={16}>
          <View style={{ gap: 12 }}>
            <View style={st.row}><Obj name="shield" size={54} /><Text style={{ flex: 1, fontSize: 14, color: C.ink2, lineHeight: 20 }}>Kumi makes a wallet on this phone. The key stays in the phone's keystore; Kumi has no server that holds it.</Text></View>
            {act.error && <Notice error>{act.error}</Notice>}
            {!importing ? (
              <>
                <Btn testID="create-wallet" title="Create my wallet" size="lg" busy={act.busy !== null} onPress={() => act.run('Creating', async () => { await app.createWallet(); })} />
                <Btn title="I have a Fuji key" tone="ghost" onPress={() => setImporting(true)} />
              </>
            ) : (
              <>
                <TextInput value={key} onChangeText={setKey} placeholder="0x… private key (Fuji test wallet)" placeholderTextColor={C.ink3} secureTextEntry autoCapitalize="none" autoCorrect={false}
                  style={{ height: 50, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: C.edge, paddingHorizontal: 14, fontSize: 15, color: C.ink, fontFamily: F.mono, outlineStyle: 'none' } as any} />
                <Btn title="Import" size="lg" tone="plum" busy={act.busy !== null} onPress={() => act.run('Importing', async () => { await app.importWallet(key); setKey(''); })} />
                <Btn title="Make a new one instead" tone="ghost" onPress={() => setImporting(false)} />
              </>
            )}
          </View>
        </Card>
      ) : (
        <Card pad={16}>
          <View style={{ gap: 12 }}>
            <View style={st.row}><Obj name="success" size={54} /><View style={{ flex: 1 }}><Text style={st.h2}>Wallet ready</Text><Text style={{ fontFamily: F.mono, fontSize: 12, color: C.ink2 }}>{app.address}</Text></View></View>
            {[['chat', 'Join a public chat, or open your crew'], ['rocket', 'Copy a trade call: your order fills on the book'], ['vote', 'In a crew, vote pitches with your shares']].map(([o, t]) => (
              <View key={t} style={st.row}><Obj name={o as any} size={40} still /><Text style={{ flex: 1, fontSize: 14.5, color: C.ink }}>{t}</Text></View>
            ))}
            <Btn testID="finish-onboarding" title="Open Kumi" size="lg" onPress={() => act.run('Opening', finish)} />
            <Btn title="Back up the key first" tone="white" icon="key" onPress={() => router.push('/backup')} />
          </View>
        </Card>
      )}
      <Text style={{ fontSize: 11.5, color: C.ink3, textAlign: 'center' }}>Testnet only. Test money (tUSDC) and free Fuji AVAX for gas. MIT · © 2026 Nivesh Gajengi</Text>
    </Screen>
  );
}
