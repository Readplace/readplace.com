#!/usr/bin/env node
/**
 * Build script for the comprehensive-crawl-command Lambda container image.
 * Runs before `pulumi up` (either in CI or via `pnpm deploy-infra` locally)
 * so Pulumi can read the image URI from `.lib/ocr-image-tags.json`.
 *
 *   1. esbuild bundles src/runtime/comprehensive-crawl-command.main.ts
 *      → .lib/comprehensive-crawl-command/index.js
 *   2. copyAssetFiles copies non-TS assets from src/ → .lib/comprehensive-crawl-command/
 *   3. docker buildx build with HANDLER_DIR=.lib/comprehensive-crawl-command
 *      + push to ECR
 *
 * Image tag: <gitSha>-comprehensive-crawl-command. ECR repo URL is resolved
 * from the platform stack via `aws ecr describe-repositories` — the platform
 * stack (PR #336) must already be deployed before this runs.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { copyAssetFiles } from "@packages/hutch-infra-components/infra/copy-asset-files";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const REPO_NAME = "hutch-ocr-lambda";
const AWS_REGION = process.env.AWS_REGION;
assert(AWS_REGION, "AWS_REGION environment variable is required");

const HANDLER = {
	name: "comprehensive-crawl-command",
	entryPoint: "src/runtime/comprehensive-crawl-command.main.ts",
};

function run(command, args, options = {}) {
	const merged = { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", ...options };
	// Node spawnSync silently drops `input` unless stdio[0] is "pipe" — fix that here
	// so callers can pass `{ input }` without also having to remember the stdio dance.
	if (merged.input != null && merged.stdio[0] !== "pipe") {
		merged.stdio = ["pipe", ...merged.stdio.slice(1)];
	}
	const result = spawnSync(command, args, merged);
	if (result.status !== 0) {
		const stderr = result.stderr?.trim() ?? "";
		const stdout = result.stdout?.trim() ?? "";
		throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}): ${stderr || stdout}`);
	}
	return result.stdout?.trim() ?? "";
}

function resolveRepositoryUrl() {
	const stdout = run("aws", [
		"ecr", "describe-repositories",
		"--repository-names", REPO_NAME,
		"--region", AWS_REGION,
		"--query", "repositories[0].repositoryUri",
		"--output", "text",
	]);
	if (!stdout) {
		throw new Error(`ECR repository '${REPO_NAME}' not found in ${AWS_REGION}. Deploy the platform stack first.`);
	}
	return stdout;
}

function loginToEcr(repositoryUrl) {
	const registry = repositoryUrl.split("/")[0];
	const password = run("aws", ["ecr", "get-login-password", "--region", AWS_REGION]);
	run("docker", ["login", "--username", "AWS", "--password-stdin", registry], { input: password });
}

async function bundleHandler() {
	const outputDir = resolve(PROJECT_ROOT, ".lib", HANDLER.name);
	mkdirSync(outputDir, { recursive: true });
	await build({
		entryPoints: [resolve(PROJECT_ROOT, HANDLER.entryPoint)],
		bundle: true,
		sourcemap: true,
		platform: "node",
		format: "cjs",
		minify: true,
		outfile: `${outputDir}/index.js`,
		target: ["node22"],
		loader: { ".ts": "ts" },
	});
	copyAssetFiles({ src: resolve(PROJECT_ROOT, "src"), dest: outputDir });
	return outputDir;
}

function buildAndPushImage(repositoryUrl, tag) {
	const imageUri = `${repositoryUrl}:${tag}`;
	const handlerDirRelative = `.lib/${HANDLER.name}`;
	console.log(`[build-image] building ${imageUri}`);
	run("docker", [
		"buildx", "build",
		"--platform", "linux/amd64",
		// Lambda rejects the SLSA provenance attestation manifest buildx adds by default
		// with InvalidParameterValueException ("image manifest ... not supported").
		"--provenance=false",
		"--build-arg", `HANDLER_DIR=${handlerDirRelative}`,
		"--tag", imageUri,
		"--file", "Dockerfile",
		"--push",
		".",
	], { stdio: "inherit", cwd: PROJECT_ROOT });
	return imageUri;
}

async function main() {
	const gitSha = run("git", ["rev-parse", "--short=12", "HEAD"]);
	const repositoryUrl = resolveRepositoryUrl();
	console.log(`[build-image] git=${gitSha} repo=${repositoryUrl}`);

	loginToEcr(repositoryUrl);

	console.log(`[build-image] bundling ${HANDLER.name}`);
	await bundleHandler();
	const tag = `${gitSha}-${HANDLER.name}`;
	const imageUri = buildAndPushImage(repositoryUrl, tag);

	const tags = { [HANDLER.name]: imageUri };
	const tagsFile = resolve(PROJECT_ROOT, ".lib", "ocr-image-tags.json");
	mkdirSync(dirname(tagsFile), { recursive: true });
	writeFileSync(tagsFile, `${JSON.stringify(tags, null, 2)}\n`);
	console.log(`[build-image] wrote ${tagsFile}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
