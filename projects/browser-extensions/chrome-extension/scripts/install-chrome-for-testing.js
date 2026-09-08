#!/usr/bin/env node

// Chrome 137+ removed --load-extension support in branded Google Chrome.
// E2E tests need Chrome for Testing (CfT) which still supports it.
// We also install the matching ChromeDriver so Selenium uses a compatible version.

const assert = require("node:assert");
const { execSync } = require("node:child_process");
const { writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const projectRoot = join(__dirname, "..");
const cacheDir = join(projectRoot, ".cache", "chrome");
mkdirSync(cacheDir, { recursive: true });

// The version CI is pinned to, so a developer's Chrome matches the one the
// suites are vetted against. Read from the pin rather than an env accessor: this
// is a CJS script outside the workspace's TypeScript build.
function pinnedChromeVersion() {
  const pin = join(__dirname, "..", "..", "..", "..", ".github", "browser-image", "image.env");
  const match = readFileSync(pin, "utf8").match(/^CHROME_FOR_TESTING_VERSION=(.+)$/m);
  assert(match, `CHROME_FOR_TESTING_VERSION missing from ${pin}`);
  return match[1].trim();
}

// Every CI runner is handed Chrome-for-Testing + chromedriver from the digest in
// .github/browser-image/image.env — baked into the self-hosted image, copied in
// by the pinned-browsers step on hosted. When that bake is present, reuse it by
// copying the recorded paths into the workspace cache; the download below is the
// developer-machine path, at the same pinned version.
const bakedDir = process.env.CFT_BAKED_DIR;
if (
  bakedDir &&
  existsSync(join(bakedDir, "binary-path")) &&
  existsSync(join(bakedDir, "driver-path"))
) {
  copyFileSync(join(bakedDir, "binary-path"), join(cacheDir, "binary-path"));
  copyFileSync(join(bakedDir, "driver-path"), join(cacheDir, "driver-path"));
  console.log(`Chrome for Testing: reused from baked image cache (${bakedDir})`);
  process.exit(0);
}

const chromeVersion = pinnedChromeVersion();

const chromeOutput = execSync(
  `npx @puppeteer/browsers install chrome@${chromeVersion} --path "${cacheDir}"`,
  { encoding: "utf8", timeout: 600_000, stdio: ["pipe", "pipe", "inherit"] },
);

// Output format: "chrome@{version} {path}" — path may contain spaces
const chromeLastLine = chromeOutput.trim().split("\n").pop();
const chromeBinaryPath = chromeLastLine.replace(/^chrome@\S+\s+/, "");
assert(
  chromeLastLine.startsWith(`chrome@${chromeVersion} `),
  `Unexpected chrome install output: ${chromeLastLine}`,
);

writeFileSync(join(cacheDir, "binary-path"), chromeBinaryPath, "utf8");
console.log(`Chrome for Testing: ${chromeBinaryPath}`);

const driverOutput = execSync(
  `npx @puppeteer/browsers install chromedriver@${chromeVersion} --path "${cacheDir}"`,
  { encoding: "utf8", timeout: 600_000, stdio: ["pipe", "pipe", "inherit"] },
);

const driverLastLine = driverOutput.trim().split("\n").pop();
const driverMatch = driverLastLine.match(/^chromedriver@(\S+)/);
assert(driverMatch, `Unexpected chromedriver install output: ${driverLastLine}`);
const driverBinaryPath = driverLastLine.replace(/^chromedriver@\S+\s+/, "");

writeFileSync(join(cacheDir, "driver-path"), driverBinaryPath, "utf8");
console.log(`ChromeDriver: ${driverBinaryPath}`);
