// Copies what the browser and the phone need to prove eERC actions into web/public/eerc and mobile/public/eerc:
// the circuits and production zkeys from the pinned Ava Labs submodule (contracts/lib/EncryptedERC at 8dc98cd),
// the snarkjs browser build, and upstream's license. Generated and gitignored; the submodule is the source of truth.
// Upstream file names: registration and withdraw ship circuit_final.zkey, transfer ships transfer.zkey.
import { copyFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'contracts/lib/EncryptedERC/circom/build');
const files = {
  'registration.wasm': join(build, 'registration/registration.wasm'),
  'registration.zkey': join(build, 'registration/circuit_final.zkey'),
  'transfer.wasm': join(build, 'transfer/transfer.wasm'),
  'transfer.zkey': join(build, 'transfer/transfer.zkey'),
  'withdraw.wasm': join(build, 'withdraw/withdraw.wasm'),
  'withdraw.zkey': join(build, 'withdraw/circuit_final.zkey'),
  'snarkjs-0.7.5.min.js': join(root, 'scripts/node_modules/snarkjs/build/snarkjs.min.js'),
  'LICENSE-EncryptedERC.md': join(root, 'contracts/lib/EncryptedERC/LICENSE.md'),
};
const targets = (process.argv[2] ? [process.argv[2]] : ['web', 'mobile']).map((t) => join(root, t, 'public/eerc'));
const sums = [];
for (const [name, from] of Object.entries(files)) {
  const h = createHash('sha256');
  await new Promise((ok, fail) => createReadStream(from).on('data', (d) => h.update(d)).on('end', ok).on('error', fail));
  sums.push(`${h.digest('hex')}  ${name}`);
}
for (const out of targets) {
  mkdirSync(out, { recursive: true });
  for (const [name, from] of Object.entries(files)) copyFileSync(from, join(out, name));
  writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  console.log(`copied ${sums.length} eERC files into ${out.slice(root.length + 1)}`);
}
