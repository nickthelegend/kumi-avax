import { Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { formatEther } from 'viem';
import { MARKETS, addressUrl, readCrewList, price as fmtPrice, size as fmtSize, usd as fmtUsd, signedUsd, crewAbi } from '@kumi-avax/sdk';
import { Text } from '../../components/T';
import { Screen } from '../../components/Screen';
import { Avatar, Btn, Card, Chip, CrewAvatar, Notice, Obj, Skeleton, TokenLogo, TxLink, ago, st, tap, useBusy } from '../../components/ui';
import { FACTORY, FAUCET_URL, pub, readAccount, useLive } from '../../lib/chain';
import { getTestUsdc } from '../../lib/actions';
import { getGas } from '../../lib/kumiApi';
import { useApp } from '../../lib/store';
import { IS_WEB } from '../../lib/wallet';
import { PrivateBalance } from '../../components/PrivateBalance';
import { C, F } from '../../lib/theme';

/** Wallet: this phone's Fuji wallet, deposit QR, test-dollar faucet, positions, crew shares and signed activity. */
export default function Wallet() {
  const { address, activity, record } = useApp();
  const router = useRouter();
  const act = useBusy();
  const acct = useLive(() => (address ? readAccount(address) : Promise.resolve(null)), [address], 6000);
  const crews = useLive(async () => {
    if (!address) return [];
    const list = (await readCrewList(pub as any, FACTORY, address)).filter(c => c.isMember);
    return Promise.all(list.map(async c => {
      const [shares, total] = await Promise.all([
        pub.readContract({ address: c.address, abi: crewAbi, functionName: 'shares', args: [address] }),
        pub.readContract({ address: c.address, abi: crewAbi, functionName: 'totalShares' }),
      ]);
      return { ...c, shares, total, worth: total ? (BigInt(c.nav) * shares) / total : 0n };
    }));
  }, [address], 15000);
  const a = acct.data;
  const noGas = a && a.avax === 0n;
  if (!address) return <Screen tabs><Skeleton rows={3} /></Screen>;
  return (
    <Screen tabs>
      <Text style={{ fontWeight: '800', fontSize: 30, color: C.ink, letterSpacing: -0.6 }}>Wallet</Text>

      <View style={{ borderRadius: 28, backgroundColor: '#22102b', paddingBottom: 7 }}>
        <LinearGradient colors={['#55306a', C.plum, C.plum2]} locations={[0, 0.55, 1]} style={{ borderRadius: 28, padding: 18, gap: 14 }}>
          <View style={st.between}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.75)' }}>On this phone · Fuji</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 26, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.mint }} /><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Live</Text>
            </View>
          </View>
          <View style={st.row}>
            <Avatar address={address} size={46} ring="rgba(255,255,255,0.3)" />
            <Pressable onPress={() => { tap(); Clipboard.setStringAsync(address).catch(() => {}); }} accessibilityRole="button" accessibilityLabel="Copy address" style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#fff' }}>{address.slice(0, 10)}…{address.slice(-8)}</Text>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Tap to copy</Text>
            </Pressable>
          </View>
          {!a ? <View style={{ height: 70, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)' }} /> : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Bal sym="USDC" test label="tUSDC" v={fmtUsd(a.usdc)} />
              <Bal sym="AVAX" label="AVAX gas" v={Number(formatEther(a.avax)).toFixed(5)} />
              <Bal sym="USDC" test label="Margin" v={fmtUsd(a.equity < 0n ? 0n : a.equity)} />
            </View>
          )}
        </LinearGradient>
      </View>

      {acct.error && !a && <Notice error>Could not read this wallet from Fuji: {acct.error}</Notice>}
      {IS_WEB && <Notice>Web preview: the key is stored in this browser. The app keeps it in the phone's keychain.</Notice>}
      {noGas && <Notice error>No Fuji AVAX for gas yet.</Notice>}
      {noGas && <Btn testID="get-gas" title="Get gas from Kumi" tone="mint" icon="bolt" busy={act.busy !== null} onPress={() => act.run('Getting gas', async () => { const g = await getGas(); record([{ hash: g.hash, label: 'Gas from Kumi' }]); acct.reload(); })} />}
      {act.error && <Notice error>{act.error}</Notice>}

      <PrivateBalance me={address} publicUsdc={a?.usdc} onTxs={t => { record(t); acct.reload(); }} />

      <Card pad={16}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <View style={{ padding: 8, borderRadius: 18, backgroundColor: '#fff', borderWidth: 2, borderColor: C.edge }}>
            <QRCode value={address} size={112} color={C.plum2} backgroundColor="#fff" />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={st.h2}>Deposit</Text>
            <Text style={{ fontSize: 13.5, color: C.ink2, lineHeight: 19 }}>Send Fuji AVAX (gas) or tUSDC to this address. Testnet only.</Text>
            <Pressable onPress={() => Linking.openURL(addressUrl(address))} accessibilityRole="link"><Text style={{ fontSize: 13, color: C.coralInk, fontWeight: '700' }}>View on Snowtrace</Text></Pressable>
          </View>
        </View>
        <View style={{ gap: 10, marginTop: 14 }}>
          <Btn testID="get-usdc" title="Get 1,000 test USDC" tone="butter" icon="coin" busy={act.busy !== null} onPress={() => act.run('Minting', async () => { const tx = await getTestUsdc(); record([tx]); acct.reload(); })} />
          <Btn title="Fuji AVAX faucet (gas)" tone="white" icon="external" onPress={() => Linking.openURL(FAUCET_URL)} />
        </View>
        <Text style={{ fontSize: 11.5, color: C.ink3, marginTop: 8 }}>1,000 test USDC, once a day per wallet.</Text>
      </Card>

      <Card pad={14}>
        <View style={[st.between, { marginBottom: 8 }]}><Text style={st.h2}>Positions</Text>{a && <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.ink2 }}>equity ${fmtUsd(a.equity)}</Text>}</View>
        {!a ? <Skeleton rows={1} /> : a.positions.length === 0 ? (
          <View style={[st.row, { paddingVertical: 6 }]}><Obj name="rocket" size={54} /><Text style={{ flex: 1, fontSize: 14, color: C.ink2 }}>No open positions. Copy a call in a chat or trade on the Market tab.</Text></View>
        ) : a.positions.map(p => {
          const m = MARKETS[Number(p.market)]!;
          return (
            <Pressable key={m.id} onPress={() => router.push('/market')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: C.line }}>
              <TokenLogo sym={m.symbol} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 15.5, color: C.ink }}>{m.symbol} <Text style={{ color: p.size > 0n ? C.mintInk : C.pinkInk }}>{p.size > 0n ? 'Long' : 'Short'}</Text></Text>
                <Text style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink2 }}>{fmtSize(p.size < 0n ? -p.size : p.size, m.sizeDp)} @ {fmtPrice(p.entry, m.priceDp)} · mark {fmtPrice(p.mark, m.priceDp)}</Text>
              </View>
              <Text style={{ fontFamily: F.monoBold, fontSize: 15, color: p.unrealized >= 0n ? C.mintInk : C.pinkInk }}>{signedUsd(p.unrealized)}</Text>
            </Pressable>
          );
        })}
        {a && a.orders.length > 0 && <Text style={{ fontSize: 12.5, color: C.ink2, marginTop: 6 }}>{a.orders.length} open order{a.orders.length > 1 ? 's' : ''} resting on the book (Market tab).</Text>}
      </Card>

      <Card pad={14}>
        <Text style={[st.h2, { marginBottom: 8 }]}>Crew vault shares</Text>
        {!crews.data ? <Skeleton rows={1} /> : crews.data.length === 0 ? <Text style={st.body}>Not in a crew yet. Crews are invite-only: open one from Chats and show a member your join code.</Text>
          : crews.data.map(c => (
            <Pressable key={c.address} onPress={() => router.push(`/chat/c-${c.address.toLowerCase()}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
              <CrewAvatar id={c.address} size={38} />
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', fontSize: 15, color: C.ink }}>{c.name}</Text><Text style={{ fontSize: 12, color: C.ink2 }}>{c.total ? ((Number(c.shares) / Number(c.total)) * 100).toFixed(1) : '0'}% of the vault</Text></View>
              <Text style={{ fontFamily: F.monoBold, fontSize: 14, color: C.ink }}>${fmtUsd(c.worth)}</Text>
            </Pressable>
          ))}
      </Card>

      <Card pad={14}>
        <View style={[st.between, { marginBottom: 6 }]}><Text style={st.h2}>Signed on this phone</Text><Chip text={`${activity.length}`} tone="butter" /></View>
        {activity.length === 0 ? <Text style={st.body}>Every transaction this phone signs shows here with its Snowtrace link.</Text> : activity.slice(0, 12).map(t => (
          <View key={t.hash} style={[st.between, { paddingVertical: 7, borderTopWidth: 1, borderColor: C.line }]}>
            <View><Text style={{ fontSize: 14, fontWeight: '600', color: C.ink }}>{t.label}</Text><Text style={{ fontSize: 11.5, color: C.ink3 }}>{ago(Math.floor(t.at / 1000))} ago</Text></View>
            <TxLink hash={t.hash} />
          </View>
        ))}
      </Card>

      <Btn title="Back up this wallet" tone="white" icon="key" onPress={() => router.push('/backup')} />
    </Screen>
  );
}

function Bal({ sym, label, v, test }: { sym: string; label: string; v: string; test?: boolean }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.09)', gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><TokenLogo sym={sym} size={18} /><Text numberOfLines={1} style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.72)', fontWeight: '600', flexShrink: 1 }}>{label}</Text></View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: F.monoBold, fontSize: 15, color: '#fff' }}>{v}</Text>
    </View>
  );
}
