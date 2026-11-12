import { useState } from 'react';
import { Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Text } from '../components/T';
import { Screen, SheetHeader } from '../components/Screen';
import { Btn, Card, CrewAvatar, Empty, Notice, st } from '../components/ui';
import { C, F, art } from '../lib/theme';
import { useApp } from '../lib/store';

/**
 * Invite QR (Nakama's flow). A public channel's QR opens it on another phone (kumi://join/l-<id>).
 * For an invite-only crew, a non-member shows a "join code" (kumi://invite/<crew>/<their address>): a member scans it
 * and the app drafts the on-chain /invite pitch for the crew to vote on.
 */
export default function Invite() {
  const { chat = '', name = '', request } = useLocalSearchParams<{ chat: string; name: string; request?: string }>();
  const { address } = useApp();
  const [copied, setCopied] = useState(false);
  const isCrew = chat.startsWith('c-');
  const asRequest = isCrew && request === '1';
  const link = asRequest && address ? `kumi://invite/${chat.slice(2)}/${address}` : `kumi://join/${chat}`;
  if (!chat) return (
    <Screen>
      <SheetHeader title="Invite" sub="Open a chat first" />
      <Card pad={6}><Empty scene={art.scene.joinCrew} alt="A frog and a fox welcoming a bunny into a chat bubble" title="Pick a chat to share" body="Each chat has its own invite code. Open one and tap Invite." action={<Btn title="Go to chats" tone="plum" size="sm" onPress={() => router.replace('/')} />} /></Card>
    </Screen>
  );
  return (
    <Screen>
      <SheetHeader title={asRequest ? 'Your join code' : `Invite to ${name}`} sub={asRequest ? `Show this to a ${name} member` : isCrew ? 'Crews vote new members in' : 'Anyone with the code can join'} />
      <Card pad={18}>
        <View style={{ alignItems: 'center', gap: 14 }}>
          <View style={st.row}><CrewAvatar id={isCrew ? chat.slice(2) : `lobby-${chat.slice(2)}`} size={44} /><Text style={{ fontWeight: '800', fontSize: 20, color: C.ink }}>{name}</Text></View>
          <View style={{ padding: 14, borderRadius: 24, backgroundColor: '#fff', borderWidth: 3, borderColor: C.edge }}>
            <QRCode value={link} size={220} color={C.plum2} backgroundColor="#fff" />
          </View>
          <Text selectable style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink2, textAlign: 'center' }}>{link}</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
            <Btn title={copied ? 'Copied' : 'Copy link'} tone="white" icon={copied ? 'check' : 'link'} style={{ flex: 1 }} onPress={() => { Clipboard.setStringAsync(link).then(() => setCopied(true)).catch(() => {}); }} />
            <Btn title="Share" tone="coral" icon="send" style={{ flex: 1 }} onPress={() => { Share.share({ message: `Join ${name} on Kumi: ${link}` }).catch(() => {}); }} />
          </View>
        </View>
      </Card>
      <Notice>{asRequest ? 'A member scans this in Kumi (Chats → Join). Their app drafts /invite with your address; when the crew votes yes, you are in and can chip in.' : isCrew ? 'This opens the crew chat read-only. To add someone, they show you their join code and you scan it.' : 'Scanning opens the chat; one tap joins it on-chain (KumiLobby.join).'}</Notice>
    </Screen>
  );
}
