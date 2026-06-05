const assert = require('node:assert');
const { join } = require('node:path');
const { execSync } = require('node:child_process');
const { initBuildExtension } = require('browser-extension-core/build');
const config = require('../build-extension.config.js');

const projectDir = join(__dirname, '..');
const serverUrl = process.env.HUTCH_SERVER_URL;
const gitHash = execSync('git rev-parse --short=6 HEAD').toString().trim();
const isDev = serverUrl && serverUrl.includes('127.0.0.1');
const filename = isDev ? `readplace-safari-${gitHash}-dev.zip` : `readplace-safari-${gitHash}.zip`;
// Safari's app-extension build (xcrun safari-web-extension-converter) reads the
// unpacked dist-extension-compiled/ directory directly. This zip is only a
// convenience artifact, so the dev fallback is plain 0.0.0.
const version = process.env.EXTENSION_VERSION ?? (isDev ? '0.0.0' : undefined);
assert(version, 'EXTENSION_VERSION environment variable is required for production builds.\nSet it before building (e.g. EXTENSION_VERSION=1.2.3)');

const appDomains = ['readplace.com'];

const { createBuildPlan } = initBuildExtension();

const plan = createBuildPlan({
  config,
  projectDir,
  serverUrl,
  version,
  appDomains,
  pack: ({ sourceDir, outputPath }) => {
    const zipFlags = process.env.CI === 'true' ? '-rq' : '-r';
    execSync(`zip ${zipFlags} ${JSON.stringify(outputPath)} .`, {
      cwd: sourceDir,
      stdio: 'inherit',
    });
  },
});

(async () => {
  await plan.buildExtension();
  plan.packExtension(filename);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
