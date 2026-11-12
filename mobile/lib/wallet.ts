import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/**
 * The in-app wallet: one Fuji (EVM) key, created on this phone and kept in the OS keystore (expo-secure-store,
 * this device only, after first unlock). The key leaves this module only through revealSecret(), which only the
 * backup screen calls after the owner confirms. Nothing here logs it.
 * The web preview (Expo web, used for screenshots) has no keystore: there the key sits in this browser's
 * localStorage, and the app says so on the wallet screen.
 */
/** QA only: Metro started with EXPO_PUBLIC_KUMI_SLOT=<name> keeps a separate wallet and app state on this device, so a
 *  first run (onboarding, the gas-free start) can be shown without touching the phone's real wallet. Unset in builds. */
export const SLOT = process.env.EXPO_PUBLIC_KUMI_SLOT ? `.${process.env.EXPO_PUBLIC_KUMI_SLOT.replace(/[^a-z0-9]/gi, '')}` : '';
const KEY = `kumi.wallet.v1${SLOT}`;
const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export const IS_WEB = Platform.OS === 'web';
let cached: PrivateKeyAccount | null = null;

async function getSecret(): Promise<string | null> {
  if (IS_WEB) { try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; } }
  return SecureStore.getItemAsync(KEY, OPTS);
}
async function setSecret(v: string) {
  if (IS_WEB) { globalThis.localStorage?.setItem(KEY, v); return; }
  await SecureStore.setItemAsync(KEY, v, OPTS);
}

export async function loadWallet(): Promise<`0x${string}` | null> {
  const s = await getSecret();
  if (!s) return null;
  cached = privateKeyToAccount(s as Hex);
  return cached.address;
}

export async function createWallet(): Promise<`0x${string}`> {
  const k = generatePrivateKey();
  await setSecret(k);
  cached = privateKeyToAccount(k);
  return cached.address;
}

/** Imports a 32-byte hex private key (with or without 0x). Throws a readable error for anything else. */
export async function importWallet(text: string): Promise<`0x${string}`> {
  const t = text.trim();
  const k = (t.startsWith('0x') ? t : `0x${t}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw Error('That is not a private key: expected 64 hex characters.');
  const acct = privateKeyToAccount(k);
  await setSecret(k);
  cached = acct;
  return acct.address;
}

export function signer(): PrivateKeyAccount {
  if (!cached) throw Error('No wallet on this phone yet.');
  return cached;
}

/** Only for the backup screen, after the owner taps "Reveal". */
export async function revealSecret(): Promise<string> {
  const s = await getSecret();
  if (!s) throw Error('No wallet on this phone');
  return s;
}
