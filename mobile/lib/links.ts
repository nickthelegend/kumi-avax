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
