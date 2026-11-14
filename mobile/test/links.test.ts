// Invite links the phone accepts from a QR, a photo or a paste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFor, routeForSystemPath } from '../lib/links.ts';

test('public channel link opens the chat', () => {
  assert.deepEqual(routeFor('kumi://join/l-2'), { path: '/chat/l-2' });
  assert.deepEqual(routeFor('  l-0 '), { path: '/chat/l-0' });
});
test('crew link is lower-cased', () => {
  assert.deepEqual(routeFor('kumi://join/c-0x16E639793291E35dB63fC411fFe97dA76F35eb2b'), { path: '/chat/c-0x16e639793291e35db63fc411ffe97da76f35eb2b' });
});
test('a join code drafts the /invite pitch for the member who scans it', () => {
  const r = routeFor('kumi://invite/0x16E639793291E35dB63fC411fFe97dA76F35eb2b/0xb2af224B6387d3FFD60Dd6254B3E84Aff58f8E6C');
  assert.equal(r?.path, '/chat/c-0x16e639793291e35db63fc411ffe97da76f35eb2b');
  assert.equal(r?.params?.draft, '/invite 0xb2af224B6387d3FFD60Dd6254B3E84Aff58f8E6C');
});
test('anything else is refused', () => {
  for (const bad of ['https://evil.example/join/l-0', 'kumi://join/l-x', 'kumi://invite/0x12/0x34', '0xb2af224B6387d3FFD60Dd6254B3E84Aff58f8E6C', '']) assert.equal(routeFor(bad), null, bad);
});
test('links from iOS open the right screen, however many slashes they carry', () => {
  const crew = '0x3401461BC3beE85096184D0625Eaa274A050f74f', who = '0xfA64A68213d008D36e63d284D0f560bEB3f9d2A5';
  const want = `/chat/c-${crew.toLowerCase()}?draft=${encodeURIComponent(`/invite ${who}`)}`;
  assert.equal(routeForSystemPath(`kumi:///invite/${crew}/${who}`), want);
  assert.equal(routeForSystemPath(`kumi://invite/${crew}/${who}`), want);
  assert.equal(routeForSystemPath(`/invite/${crew}/${who}`), want);
  assert.equal(routeForSystemPath('kumi:///join/l-0'), '/chat/l-0');
  assert.equal(routeForSystemPath('/'), null);
  assert.equal(routeForSystemPath('/onboarding'), null);
});
