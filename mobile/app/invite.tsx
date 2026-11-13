import { useState } from 'react';
import { Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import type { Address } from 'viem';
import { Text, TextInput } from '../components/T';
import { Screen, SheetHeader } from '../components/Screen';
import { inp } from '../components/Sheet';
import { Avatar, Btn, Card, CrewAvatar, Empty, Notice, TxLink, st, useBusy } from '../components/ui';
import { C, F, art } from '../lib/theme';
import { useApp } from '../lib/store';
import { inviteToCrew } from '../lib/actions';
import { crewAbi, nameOf, pub } from '../lib/chain';

/** A join code (kumi://invite/<crew>/<address>), a bare address, or nothing. */
function joinCodeOf(code: string, crew: string): { address: Address } | { error: string } | null {
  const t = code.trim();
  if (!t) return null;
  const m = /^kumi:\/\/invite\/(0x[0-9a-fA-F]{40})\/(0x[0-9a-fA-F]{40})$/.exec(t);
  if (m) return m[1]!.toLowerCase() === crew.toLowerCase() ? { address: m[2] as Address } : { error: 'That join code is for another crew.' };
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return { address: t as Address };
  return { error: 'Join codes look like kumi://invite/0x…/0x… (or paste a 0x address).' };
}

/**
 * Invite. A public channel's QR opens it on another phone (kumi://join/l-<id>); scanning joins it on-chain.
 * A crew is invite-only: members share the crew link (kumi://join/c-<crew>); a friend opens it and sends back their
 * join code (kumi://invite/<crew>/<their address>). A member adds it here (or opens the link), which pitches /invite;
 * when yes shares pass half, the friend is in and can chip in. A non-member sees their own join code (request=1).
 */
export default function Invite() {
  const { chat = '', name = '', request } = useLocalSearchParams<{ chat: string; name: string; request?: string }>();
  const { address, record } = useApp();
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [added, setAdded] = useState<{ who: Address; hash: string; inNow: boolean }[]>([]);
  const act = useBusy();
  const isCrew = chat.startsWith('c-');
  const crew = chat.slice(2) as Address;
  const asRequest = isCrew && request === '1';
  const link = asRequest && address ? `kumi://invite/${crew}/${address}` : `kumi://join/${chat}`;
  const parsed = isCrew && !asRequest ? joinCodeOf(code, crew) : null;
  if (!chat) return (
    <Screen modal>
      <SheetHeader title="Invite" sub="Open a chat first" />
      <Card pad={6}><Empty scene={art.scene.joinCrew} alt="A frog and a fox welcoming a bunny into a chat bubble" title="Pick a chat to share" body="Each chat has its own invite code. Open one and tap Invite." action={<Btn title="Go to chats" tone="plum" size="sm" onPress={() => router.replace('/')} />} /></Card>
    </Screen>
  );
  return (
    <Screen modal>
      <SheetHeader title={asRequest ? 'Your join code' : `Invite to ${name}`} sub={asRequest ? `Send it to a ${name} member` : isCrew ? 'Share the link; friends send back a join code' : 'Anyone with the code can join'} />
      <Card pad={18}>
        <View style={{ alignItems: 'center', gap: 14 }}>
          <View style={st.row}><CrewAvatar id={isCrew ? crew : `lobby-${chat.slice(2)}`} size={44} /><Text style={{ fontWeight: '800', fontSize: 20, color: C.ink }}>{name}</Text></View>
          <View style={{ padding: 12, borderRadius: 24, backgroundColor: '#fff', borderWidth: 3, borderColor: C.edge }}>
            <QRCode value={link} size={isCrew && !asRequest ? 132 : 220} color={C.plum2} backgroundColor="#fff" />
          </View>
          <Text selectable style={{ fontFamily: F.mono, fontSize: 11, color: C.ink2, textAlign: 'center' }}>{link}</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
            <Btn title={copied ? 'Copied' : 'Copy link'} tone="white" icon={copied ? 'check' : 'link'} style={{ flex: 1 }} onPress={() => { Clipboard.setStringAsync(link).then(() => setCopied(true)).catch(() => {}); }} />
            <Btn title="Share" tone="coral" icon="send" style={{ flex: 1 }} onPress={() => { Share.share({ message: asRequest ? `Vote me into ${name} on Kumi: ${link}` : `Join ${name} on Kumi: ${link}` }).catch(() => {}); }} />
          </View>
        </View>
      </Card>

      {isCrew && !asRequest && (
        <Card pad={16}>
          <View style={{ gap: 10 }}>
            <Text style={st.h2}>Add a friend</Text>
            <Text style={{ fontSize: 13.5, color: C.ink2, marginTop: -4 }}>Paste the join code they sent you. It pitches /invite; your shares vote yes, so it passes when you hold over half.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput testID="join-code" value={code} onChangeText={t => { setCode(t); act.setError(null); }} placeholder="kumi://invite/0x…/0x…" placeholderTextColor={C.ink3} autoCapitalize="none" autoCorrect={false} style={[inp, { flex: 1, fontFamily: F.mono, fontSize: 13 }]} />
              <Btn testID="paste-code" title="Paste" tone="butter" icon="copy" onPress={() => { Clipboard.getStringAsync().then(t => { if (t) { setCode(t.trim()); act.setError(null); } }).catch(() => {}); }} />
            </View>
            {parsed && 'error' in parsed && <Text style={{ fontSize: 12.5, color: C.pinkInk }}>{parsed.error}</Text>}
            {parsed && 'address' in parsed && <View style={st.row}><Avatar address={parsed.address} size={26} /><Text style={{ fontSize: 13.5, color: C.ink, fontWeight: '700' }}>{nameOf(parsed.address, address)}</Text><Text style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink3 }}>{parsed.address.slice(0, 8)}…{parsed.address.slice(-6)}</Text></View>}
            {act.error && <Notice error>{act.error}</Notice>}
            <Btn testID="add-friend" title={act.busy ? `${act.busy}…` : 'Pitch /invite'} tone="plum" icon="plus" disabled={!parsed || !('address' in parsed)} busy={act.busy !== null}
              onPress={() => act.run('Signing on this phone', async () => {
                if (!parsed || !('address' in parsed)) return;
                const who = parsed.address;
                const tx = await inviteToCrew(crew, who);
                record([tx]);
                const inNow = await pub.readContract({ address: crew, abi: crewAbi, functionName: 'isMember', args: [who] }).catch(() => false);
                setAdded(a => [{ who, hash: tx.hash, inNow: !!inNow }, ...a]); setCode('');
              })} />
            {added.map(a => (
              <View key={a.hash} style={[st.between, { padding: 10, borderRadius: 16, backgroundColor: a.inNow ? C.mintSoft : C.butterSoft }]}>
                <View style={st.row}><Avatar address={a.who} size={26} /><Text style={{ fontSize: 13.5, fontWeight: '700', color: C.ink }}>{nameOf(a.who, address)} {a.inNow ? 'is in the crew' : 'is up for a vote'}</Text></View>
                <TxLink hash={a.hash} />
              </View>
            ))}
          </View>
        </Card>
      )}

      <Notice>{asRequest ? 'A member pastes or scans this in Kumi. Their app pitches /invite with your address; when the crew votes yes, you are in and can chip in.' : isCrew ? 'The link opens the crew read-only, with a button that shows the friend their join code.' : 'Scanning opens the chat; one tap joins it on-chain (KumiLobby.join).'}</Notice>
      {isCrew && !asRequest && added.length > 0 && <Btn title={`Back to ${name}`} tone="white" onPress={() => router.back()} />}
    </Screen>
  );
}
