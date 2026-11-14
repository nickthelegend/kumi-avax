/** Kumi invite links (QR or pasted). Pure, so the unit tests cover them. */
/** Accepts kumi://join/<chat>, kumi://invite/<crew>/<address>, or a pasted chat id. Returns the route to open. */
export function routeFor(code: string): { path: string; params?: Record<string, string> } | null {
  const t = code.trim();
  let m = /^kumi:\/\/join\/((?:l-\d+)|(?:c-0x[0-9a-fA-F]{40}))$/.exec(t);
  if (m) return { path: `/chat/${m[1]!.toLowerCase()}` };
  m = /^kumi:\/\/invite\/(0x[0-9a-fA-F]{40})\/(0x[0-9a-fA-F]{40})$/.exec(t);
  if (m) return { path: `/chat/c-${m[1]!.toLowerCase()}`, params: { draft: `/invite ${m[2]}` } };
  m = /^(l-\d+|c-0x[0-9a-fA-F]{40})$/.exec(t);
  if (m) return { path: `/chat/${m[1]!.toLowerCase()}` };
  return null;
}

/**
 * A link handed to the app by the OS (`kumi:///invite/…` with three slashes, `kumi://join/…`, or a bare path) as the
 * app route to open, query string included; null when it is not a Kumi link.
 */
export function routeForSystemPath(path: string): string | null {
  const r = routeFor(`kumi://${path.trim().replace(/^kumi:/i, '').replace(/^\/+/, '')}`);
  if (!r) return null;
  const q = r.params ? `?${Object.entries(r.params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
  return `${r.path}${q}`;
}
