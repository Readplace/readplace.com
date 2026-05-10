const assert = require('node:assert');
const { join, basename, dirname } = require('node:path');
const { execSync } = require('node:child_process');
const { initBuildExtension } = require('browser-extension-core/build');
const config = require('../build-extension.config.js');

const projectDir = join(__dirname, '..');
const serverUrl = process.env.HUTCH_SERVER_URL;
const gitHash = execSync('git rev-parse --short=6 HEAD').toString().trim();
const isDev = serverUrl && serverUrl.includes('127.0.0.1');
const filename = isDev ? `hutch-${gitHash}-dev.xpi` : `hutch-${gitHash}.xpi`;
// Firefox's manifest validator requires numeric dot-separated parts, so the
// dev fallback is plain 0.0.0 rather than something like 0.0.0-dev.
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
    const isCI = process.env.CI === 'true';
    execSync(`web-ext build --source-dir ${sourceDir} --artifacts-dir ${dirname(outputPath)} --overwrite-dest --filename ${basename(outputPath)}`, {
      cwd: projectDir,
      stdio: isCI ? ['inherit', 'ignore', 'inherit'] : 'inherit',
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
