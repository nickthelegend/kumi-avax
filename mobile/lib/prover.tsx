/**
 * Groth16 proving for Kumi's private balance, on the device. The circuits and zkeys are Ava Labs' production files
 * (copied from the pinned EncryptedERC submodule by scripts/copy-eerc-assets.mjs into public/eerc).
 *  - Web build: snarkjs runs in the page (WebAssembly).
 *  - iOS / Android: React Native's Hermes has no WebAssembly, so a hidden WebView on this phone runs the same
 *    snarkjs build. The witness and the proof are computed in that WebView; nothing is sent to a server. It only
 *    downloads the public circuit files (wasm + zkey, about 30 MB the first time) from the hosted Kumi app.
 */
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import type { Circuit, Prover, SnarkProof } from '@kumi-avax/sdk/eerc';

/** Where the circuit files are served for the native prover (the hosted phone app). */
export const EERC_HOST = (process.env.EXPO_PUBLIC_KUMI_APP_URL ?? 'https://kumi-avax-app.vercel.app').replace(/\/$/, '');
const strings = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(strings) : v);
const flatten = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).map(([k, v]) => [k, strings(v)]));

// ---------------------------------------------------------------- web
let snarkLoad: Promise<void> | null = null;
function loadSnarkjs(): Promise<void> {
  if ((globalThis as any).snarkjs) return Promise.resolve();
  snarkLoad ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = '/eerc/snarkjs-0.7.5.min.js';
    s.onload = () => ok();
    s.onerror = () => { snarkLoad = null; fail(Error('Could not load the zk prover (snarkjs) from /eerc. Setup required: run scripts/copy-eerc-assets.mjs before exporting.')); };
    document.head.appendChild(s);
  });
  return snarkLoad;
}
const webProver: Prover = async (circuit, input) => {
  await loadSnarkjs();
  return (globalThis as any).snarkjs.groth16.fullProve(flatten(input), `/eerc/${circuit}.wasm`, `/eerc/${circuit}.zkey`);
};

// ---------------------------------------------------------------- native (hidden WebView)
type Pending = { ok: (v: { proof: SnarkProof; publicSignals: string[] }) => void; fail: (e: Error) => void };
const pending = new Map<number, Pending>();
let seq = 0;
let inject: ((js: string) => void) | null = null;
let ready: Promise<void> | null = null;
let markReady: (() => void) | null = null;
const resetReady = () => { ready = new Promise(r => { markReady = r; }); };
resetReady();

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script src="${EERC_HOST}/eerc/snarkjs-0.7.5.min.js"></script></head><body><script>
const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
window.kumiProve = async (id, circuit, input) => {
  try {
    const out = await snarkjs.groth16.fullProve(input, '${EERC_HOST}/eerc/' + circuit + '.wasm', '${EERC_HOST}/eerc/' + circuit + '.zkey');
    post({ id, proof: out.proof, publicSignals: out.publicSignals });
  } catch (e) { post({ id, error: String((e && e.message) || e) }); }
};
window.addEventListener('load', () => post({ ready: !!window.snarkjs }));
</script></body></html>`;

const nativeProver: Prover = async (circuit, input) => {
  const timeout = new Promise<never>((_, fail) => setTimeout(() => fail(Error('The on-phone prover did not start. Check the connection: it loads the circuit files from the Kumi app the first time.')), 30_000));
  await Promise.race([ready, timeout]);
  if (!inject) throw Error('The on-phone prover is not mounted.');
  const id = ++seq;
  return new Promise((ok, fail) => {
    pending.set(id, { ok, fail });
    inject!(`window.kumiProve(${id}, ${JSON.stringify(circuit)}, ${JSON.stringify(flatten(input))}); true;`);
    setTimeout(() => { if (pending.delete(id)) fail(Error(`The ${circuit} proof took longer than 3 minutes.`)); }, 180_000);
  });
};

/** Mount once at the app root. Renders nothing visible; on the web it renders nothing at all. */
export function ProverHost() {
  if (Platform.OS === 'web') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview');
  const ref = useRef<any>(null);
  useEffect(() => () => { inject = null; resetReady(); }, []);
  return (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: PAGE, baseUrl: `${EERC_HOST}/` }}
        javaScriptEnabled
        onLoadEnd={() => { inject = js => ref.current?.injectJavaScript(js); }}
        onMessage={e => {
          let m: any;
          try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
          if ('ready' in m) { if (m.ready) markReady?.(); return; }
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          if (m.error) p.fail(Error(`Proof failed: ${m.error}`)); else p.ok({ proof: m.proof, publicSignals: m.publicSignals });
        }}
      />
    </View>
  );
}

export const prove: Prover = (c: Circuit, input) => (Platform.OS === 'web' ? webProver(c, input) : nativeProver(c, input));
export const PROVER_WHERE = Platform.OS === 'web' ? 'in this browser' : 'on this phone';
