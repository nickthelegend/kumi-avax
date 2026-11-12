import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { readChannelMessages, readChannels, readCrewList, readCrewMessages, preview, type ChatItem } from '@kumi-avax/sdk';
import { FACTORY, LOBBY, nameOf, pub } from './chain';
import { IS_WEB, createWallet, importWallet, loadWallet } from './wallet';

/**
 * App state: the wallet address, onboarding, and what this device has read in each chat (for unread badges).
 * Chats themselves are never stored here; they are read from Fuji every few seconds.
 */
type Seen = Record<string, number>;
type Ctx = {
  ready: boolean;
  address: `0x${string}` | null;
  onboarded: boolean;
  seen: Seen;
  createWallet: () => Promise<string>;
  importWallet: (k: string) => Promise<string>;
  finishOnboarding: () => Promise<void>;
  markSeen: (chat: string, index: number) => void;
  /** Transactions this phone signed (label, hash, time), newest first: the Wallet tab's activity list. */
  activity: Activity[];
  record: (txs: { hash: string; label: string }[]) => void;
  unread: number;
  setUnread: (n: number) => void;
};
export type Activity = { hash: string; label: string; at: number };
const Store = createContext<Ctx | null>(null);
export const useApp = () => {
  const v = useContext(Store);
  if (!v) throw Error('useApp outside provider');
  return v;
};

const K = { onboarded: 'kumi.onboarded', seen: 'kumi.seen.v1', notified: 'kumi.notified.v1', activity: 'kumi.activity.v1' };
async function getItem(k: string) {
  if (IS_WEB) { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } }
  return SecureStore.getItemAsync(k);
}
async function setItem(k: string, v: string) {
  if (IS_WEB) { try { globalThis.localStorage?.setItem(k, v); } catch { /* private mode */ } return; }
  await SecureStore.setItemAsync(k, v);
}

if (!IS_WEB) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function askNotificationPermission(): Promise<boolean> {
  if (IS_WEB) return false;
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('kumi-calls', { name: 'Trade calls', importance: Notifications.AndroidImportance.HIGH, lightColor: '#FF6F59' });
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Chat ids: `l-<channel>` for lobby channels, `c-<crew address>` for crew rooms. */
export const lobbyChat = (id: number) => `l-${id}`;
export const crewChat = (a: string) => `c-${a.toLowerCase()}`;

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [seen, setSeen] = useState<Seen>({});
  const notified = useRef<Seen>({});
  const [activity, setActivity] = useState<Activity[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    (async () => {
      setAddress(await loadWallet());
      setOnboarded((await getItem(K.onboarded)) === '1');
      setSeen(JSON.parse((await getItem(K.seen)) ?? '{}'));
      notified.current = JSON.parse((await getItem(K.notified)) ?? '{}');
      setActivity(JSON.parse((await getItem(K.activity)) ?? '[]'));
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  const markSeen = useCallback((chat: string, index: number) => {
    setSeen(s => {
      if ((s[chat] ?? -1) >= index) return s;
      const next = { ...s, [chat]: index };
      void setItem(K.seen, JSON.stringify(next));
      return next;
    });
  }, []);

  // New trade calls and pitches in this phone's chats become a local notification (native only). Foreground poll.
  useEffect(() => {
    if (!ready || !address || !onboarded || IS_WEB) return;
    let stop = false;
    const tick = async () => {
      try {
        const [chans, crews] = await Promise.all([readChannels(pub as any, LOBBY, address), readCrewList(pub as any, FACTORY, address)]);
        const feeds: [string, ChatItem[]][] = await Promise.all([
          ...chans.filter(c => c.joined).map(async c => [lobbyChat(c.id), await readChannelMessages(pub as any, LOBBY, c.id, 20)] as [string, ChatItem[]]),
          ...crews.filter(c => c.isMember).map(async c => [crewChat(c.address), await readCrewMessages(pub as any, c.address, 20)] as [string, ChatItem[]]),
        ]);
        for (const [chat, items] of feeds) {
          const last = notified.current[chat];
          const fresh = items.filter(m => (m.kind === 'call' || m.kind === 'pitch') && m.who.toLowerCase() !== address.toLowerCase() && (last === undefined ? false : m.index > last));
          notified.current[chat] = items.length ? items[items.length - 1]!.index : -1;
          for (const m of fresh.slice(-2)) {
            await Notifications.scheduleNotificationAsync({ content: { title: m.kind === 'call' ? 'New trade call' : 'New pitch to vote on', body: preview(m, a => nameOf(a)), data: { chat } }, trigger: null });
          }
        }
        await setItem(K.notified, JSON.stringify(notified.current));
      } catch { /* the chats screen shows RPC errors; notifications just wait for the next tick */ }
      if (!stop) timer = setTimeout(tick, 15_000);
    };
    let timer = setTimeout(tick, 2_000);
    return () => { stop = true; clearTimeout(timer); };
  }, [ready, address, onboarded]);

  const record = useCallback((txs: { hash: string; label: string }[]) => {
    setActivity(list => {
      const next = [...txs.map(t => ({ hash: t.hash, label: t.label, at: Date.now() })).reverse(), ...list].slice(0, 60);
      void setItem(K.activity, JSON.stringify(next));
      return next;
    });
  }, []);

  const value: Ctx = {
    ready, address, onboarded, seen, markSeen, activity, record, unread, setUnread,
    createWallet: async () => { const a = await createWallet(); setAddress(a); return a; },
    importWallet: async (k: string) => { const a = await importWallet(k); setAddress(a); return a; },
    finishOnboarding: async () => { await setItem(K.onboarded, '1'); setOnboarded(true); },
  };
  return <Store.Provider value={value}>{children}</Store.Provider>;
}
