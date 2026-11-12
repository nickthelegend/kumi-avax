/** Small HTTP helpers for Kumi's Vercel functions: CORS, the caller's IP, JSON replies and a per-instance limiter. */
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Req = IncomingMessage & { body?: unknown; query?: Record<string, string> };
export type Res = ServerResponse;
export type Reply = { status: number; body: Record<string, unknown> };

const ORIGINS = [/^https:\/\/kumi-avax-(app|web)(-[a-z0-9-]+)?\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

/** Sets CORS for Kumi's own apps (the native app sends no Origin). Returns true when the request was a preflight. */
export function cors(req: Req, res: Res): boolean {
  const o = req.headers.origin;
  if (typeof o === 'string' && ORIGINS.some(r => r.test(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}

export function send(res: Res, r: Reply) {
  res.statusCode = r.status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(r.body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/** The caller's IP as Vercel's edge saw it. */
export function ipOf(req: Req): string {
  const h = (k: string) => { const v = req.headers[k]; return Array.isArray(v) ? v[0] : v; };
  return (h('x-vercel-forwarded-for') ?? h('x-forwarded-for') ?? h('x-real-ip') ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0]!.trim();
}

/** A keyed hash of the IP for the on-chain per-requester cap: the IP itself never leaves the server. */
export function tagOf(ip: string, secret: string): `0x${string}` {
  return `0x${createHmac('sha256', secret).update(`kumi-gas:${ip}`).digest('hex')}`;
}

export async function bodyOf(req: Req): Promise<any> {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const t = Buffer.concat(chunks).toString('utf8');
  return t ? JSON.parse(t) : {};
}

/** Sliding-window limiter. It lives in one warm function instance, so it is a first line only; hard limits that must
 *  hold everywhere (the gas caps) are enforced on-chain. */
export class Limiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) { this.max = max; this.windowMs = windowMs; }
  take(key: string, now = Date.now()): { ok: boolean; retryS: number } {
    const list = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (list.length >= this.max) { this.hits.set(key, list); return { ok: false, retryS: Math.ceil((this.windowMs - (now - list[0]!)) / 1000) }; }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some(t => now - t < this.windowMs)) this.hits.delete(k);
    return { ok: true, retryS: 0 };
  }
}

export const setup = (what: string): Reply => ({ status: 503, body: { error: `Setup required: ${what}`, setup: true } });
