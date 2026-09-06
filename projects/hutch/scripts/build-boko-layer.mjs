import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const libraryDir = resolve(projectRoot, ".lib");
const downloadDir = resolve(libraryDir, "boko-downloads");
const layerWorkDir = resolve(libraryDir, "boko-layer");
const layerZipPath = resolve(libraryDir, "boko-layer.zip");
const hostBinaryDir = resolve(libraryDir, "boko-host");
const bokoVersion = "0.5.0";
const releaseBaseUrl = `https://github.com/zacharydenton/boko/releases/download/v${bokoVersion}`;
const archiveSuffix = ".tar.xz";
const fixedMtime = new Date(2000, 0, 1);

const releaseAssets = {
  "darwin-arm64": {
    archive: "boko-aarch64-apple-darwin.tar.xz",
    sha256: "8afc038df31d970a51b06cae75467a219ea890306d17d7b88e4d76e2999fe39f",
  },
  "darwin-x64": {
    archive: "boko-x86_64-apple-darwin.tar.xz",
    sha256: "93eee621af74c0b8f519ac059dd87328ef60d74f20ca6131d274d8f9a34e4e7f",
  },
  "linux-arm64": {
    archive: "boko-aarch64-unknown-linux-gnu.tar.xz",
    sha256: "c25958f7eddec7a73e3f522547d4b3e38f27c6889ac6029628236899579f2a45",
  },
  "linux-x64": {
    archive: "boko-x86_64-unknown-linux-gnu.tar.xz",
    sha256: "3df50e781c7533666d4718ce23e392423674ade8acb1955c805997af51af42a6",
  },
};

const layerAsset = releaseAssets["linux-x64"];
const hostAsset = releaseAssets[`${process.platform}-${process.arch}`];
assert(hostAsset, `boko ${bokoVersion} has no release for ${process.platform}/${process.arch}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.error || result.status !== 0) {
    const output = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()]
      .filter(Boolean)
      .join("\n");
    throw new Error(`${command} ${args.join(" ")} failed: ${output}`);
  }
}

function archivePath(asset) {
  return resolve(downloadDir, asset.archive);
}

function checksum(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyArchive(path, asset) {
  assert.strictEqual(
    checksum(path),
    asset.sha256,
    `${asset.archive} did not match the pinned SHA-256 checksum`,
  );
}

async function downloadArchive(asset) {
  mkdirSync(downloadDir, { recursive: true });
  const path = archivePath(asset);
  if (existsSync(path)) {
    try {
      verifyArchive(path, asset);
      return path;
    } catch {
      rmSync(path, { force: true });
    }
  }

  const temporaryPath = `${path}.download`;
  rmSync(temporaryPath, { force: true });
  try {
    const response = await fetch(`${releaseBaseUrl}/${asset.archive}`);
    assert(response.ok, `boko ${asset.archive} download failed with ${response.status} ${response.statusText}`);
    assert(response.body, `boko ${asset.archive} download returned no body`);
    await pipeline(response.body, createWriteStream(temporaryPath));
    verifyArchive(temporaryPath, asset);
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return path;
}

function extractArchive({ asset, path, destination }) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  run("tar", ["--extract", "--xz", "--file", path, "--directory", destination]);
  return resolve(destination, asset.archive.slice(0, -archiveSuffix.length));
}

function stageLayer(extractedDir) {
  rmSync(layerWorkDir, { recursive: true, force: true });
  const binaryDir = resolve(layerWorkDir, "bin");
  const licenseDir = resolve(layerWorkDir, "share", "licenses", "boko");
  mkdirSync(binaryDir, { recursive: true });
  mkdirSync(licenseDir, { recursive: true });
  const binaryPath = resolve(binaryDir, "boko");
  const licensePath = resolve(licenseDir, "LICENSE");
  copyFileSync(resolve(extractedDir, "boko"), binaryPath);
  copyFileSync(resolve(extractedDir, "LICENSE"), licensePath);
  chmodSync(binaryPath, 0o755);
  chmodSync(licensePath, 0o644);
  utimesSync(binaryPath, fixedMtime, fixedMtime);
  utimesSync(licensePath, fixedMtime, fixedMtime);
  rmSync(layerZipPath, { force: true });
  run("zip", ["-X", "-q", layerZipPath, "bin/boko", "share/licenses/boko/LICENSE"], {
    cwd: layerWorkDir,
  });
}

function stageHostBinary(extractedDir) {
  rmSync(hostBinaryDir, { recursive: true, force: true });
  mkdirSync(hostBinaryDir, { recursive: true });
  const hostBinaryPath = resolve(hostBinaryDir, "boko");
  copyFileSync(resolve(extractedDir, "boko"), hostBinaryPath);
  chmodSync(hostBinaryPath, 0o755);
}

async function main() {
  const layerArchivePath = await downloadArchive(layerAsset);
  const hostArchivePath = await downloadArchive(hostAsset);
  const layerExtractedDir = extractArchive({
    asset: layerAsset,
    path: layerArchivePath,
    destination: resolve(libraryDir, "boko-layer-extracted"),
  });
  const hostExtractedDir =
    hostAsset.archive === layerAsset.archive
      ? layerExtractedDir
      : extractArchive({
          asset: hostAsset,
          path: hostArchivePath,
          destination: resolve(libraryDir, "boko-host-extracted"),
        });
  stageLayer(layerExtractedDir);
  stageHostBinary(hostExtractedDir);
  console.log(`Built ${layerZipPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
