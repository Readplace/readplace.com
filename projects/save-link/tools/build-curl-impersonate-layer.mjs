#!/usr/bin/env node
/**
 * Build script for the curl-impersonate Lambda layer. Downloads the prebuilt
 * curl-impersonate-chrome release for Linux x86_64 and packages the binary +
 * shared libraries into a layer zip at .lib/curl-impersonate-layer.zip.
 *
 * Lambda layers mount at /opt/, so the zip layout is:
 *   bin/curl_chrome116   — the impersonate binary (Lambda adds /opt/bin to PATH)
 *   lib/                 — shared libraries (Lambda adds /opt/lib to LD_LIBRARY_PATH)
 *
 * Runs before `pulumi up` (either in CI or locally). The infra reads the zip
 * path from this script's output location.
 *
 * Source: https://github.com/lexiforest/curl-impersonate (active fork)
 */
import { createWriteStream, mkdirSync, existsSync, chmodSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, ".lib", "curl-impersonate-layer");
const OUTPUT_ZIP = resolve(PROJECT_ROOT, ".lib", "curl-impersonate-layer.zip");

const RELEASE_VERSION = readFileSync(resolve(PROJECT_ROOT, ".curl-impersonate-version"), "utf-8").trim();
const RELEASE_URL = `https://github.com/lexiforest/curl-impersonate/releases/download/v${RELEASE_VERSION}/curl-impersonate-v${RELEASE_VERSION}.x86_64-linux-gnu.tar.gz`;

function run(command, args, options = {}) {
	const merged = { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", ...options };
	const result = spawnSync(command, args, merged);
	if (result.status !== 0) {
		const stderr = result.stderr?.trim() ?? "";
		const stdout = result.stdout?.trim() ?? "";
		throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}): ${stderr || stdout}`);
	}
	return result.stdout?.trim() ?? "";
}

async function downloadRelease() {
	const tarPath = resolve(OUTPUT_DIR, "curl-impersonate.tar.gz");
	mkdirSync(OUTPUT_DIR, { recursive: true });

	console.log(`[build-layer] downloading ${RELEASE_URL}`);
	const response = await fetch(RELEASE_URL);
	if (!response.ok) {
		throw new Error(`Download failed: ${response.status} ${response.statusText}`);
	}
	const fileStream = createWriteStream(tarPath);
	await pipeline(response.body, fileStream);
	return tarPath;
}

function extractAndPackage(tarPath) {
	const extractDir = resolve(OUTPUT_DIR, "extracted");
	mkdirSync(extractDir, { recursive: true });

	console.log("[build-layer] extracting release archive");
	run("tar", ["--extract", "--gzip", "--file", tarPath, "--directory", extractDir]);

	const layerRoot = resolve(OUTPUT_DIR, "layer");
	const binDir = resolve(layerRoot, "bin");
	const libDir = resolve(layerRoot, "lib");
	mkdirSync(binDir, { recursive: true });
	mkdirSync(libDir, { recursive: true });

	run("cp", [resolve(extractDir, "curl_chrome116"), binDir]);
	chmodSync(resolve(binDir, "curl_chrome116"), 0o755);

	/* Copy all shared libraries the binary needs. The release bundles them
	 * alongside the binary — they include libcurl-impersonate-chrome and the
	 * BoringSSL/NSS libraries that produce the Chrome TLS fingerprint. */
	const lsOutput = run("ls", [extractDir]);
	const libs = lsOutput.split("\n").filter((f) => f.includes(".so"));
	for (const lib of libs) {
		run("cp", ["--no-dereference", resolve(extractDir, lib), libDir]);
	}

	return layerRoot;
}

function createZip(layerRoot) {
	if (existsSync(OUTPUT_ZIP)) {
		rmSync(OUTPUT_ZIP);
	}
	console.log(`[build-layer] creating ${OUTPUT_ZIP}`);
	run("zip", ["--recurse-paths", "--symlinks", OUTPUT_ZIP, "."], { cwd: layerRoot });
}

async function main() {
	console.log("[build-layer] building curl-impersonate Lambda layer");
	rmSync(OUTPUT_DIR, { recursive: true, force: true });

	const tarPath = await downloadRelease();
	const layerRoot = extractAndPackage(tarPath);
	createZip(layerRoot);

	console.log(`[build-layer] done: ${OUTPUT_ZIP}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
