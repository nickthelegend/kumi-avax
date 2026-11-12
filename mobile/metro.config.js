// Metro: bundle the shared SDK (../sdk, TypeScript with .ts import paths) into the app, resolving the SDK's own
// imports (viem) from this app's node_modules so there is one copy of viem.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const sdk = path.resolve(__dirname, '../sdk');
config.watchFolders = [sdk];
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (moduleName === '@kumi-avax/sdk') return { type: 'sourceFile', filePath: path.join(sdk, 'src/index.ts') };
  if (moduleName === '@kumi-avax/sdk/eerc') return { type: 'sourceFile', filePath: path.join(sdk, 'src/eerc.ts') };
  if (context.originModulePath.startsWith(sdk + path.sep) && !moduleName.startsWith('.')) {
    return resolve({ ...context, originModulePath: path.join(__dirname, 'package.json') }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};
module.exports = config;
