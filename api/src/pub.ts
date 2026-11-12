import { createPublicClient, type PublicClient } from 'viem';
import { fuji, fujiTransport } from '@kumi-avax/sdk';

let pub: PublicClient | null = null;
/** One Fuji client per warm instance (two public RPCs behind a fallback). */
export const fujiClient = (): PublicClient => (pub ??= createPublicClient({ chain: fuji, transport: fujiTransport() }) as PublicClient);
