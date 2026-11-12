// Bundles each function (with viem, the Anthropic SDK and @kumi-avax/sdk inlined) into out/api/*.js for Vercel.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// keep out/.vercel (the project link), rebuild everything else
if (existsSync('out')) for (const f of readdirSync('out')) if (f !== '.vercel') rmSync(`out/${f}`, { recursive: true, force: true });
mkdirSync('out/api', { recursive: true });
for (const name of ['gas', 'ask', 'health']) {
  await build({
    entryPoints: [`functions/${name}.ts`], outfile: `out/api/${name}.js`, bundle: true, platform: 'node', target: 'node20', format: 'cjs',
    footer: { js: 'module.exports = module.exports.default;' }, legalComments: 'none', logLevel: 'warning',
  });
}
writeFileSync('out/package.json', JSON.stringify({ name: 'kumi-avax-api', private: true, license: 'MIT' }, null, 2));
writeFileSync('out/vercel.json', JSON.stringify({ functions: { 'api/*.js': { maxDuration: 60 } } }, null, 2));
writeFileSync('out/index.html', '<!doctype html><meta charset="utf-8"><title>Kumi API</title><p>Kumi API: <a href="/api/health">/api/health</a>. Kumi on Avalanche Fuji.</p>');
console.log('built out/api: gas, ask, health');
