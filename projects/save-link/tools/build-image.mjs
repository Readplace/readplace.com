#!/usr/bin/env node
/**
 * Build script for the OCR container Lambdas. Runs before `pulumi up` (either
 * in CI or via `pnpm deploy-infra` locally) so Pulumi can read the per-handler
 * image URIs from `.lib/ocr-image-tags.json`.
 *
 * Each entry produces:
 *   1. esbuild bundles each handler's entry point into a single file
 *   2. copyAssetFiles copies non-TS assets from src/ → .lib/<name>/
 *   3. docker buildx build with HANDLER_DIR=.lib/<name> + push to ECR
 *
 * With `--tag-only` it stops after computing the content-addressed tags and
 * writing ocr-image-tags.json — no docker login, build, or push. `check-infra`
 * (drift detection) runs it this way: `pulumi preview` diffs only the imageUri
 * STRING, and the tag is a hash of the bundle + Dockerfile + curl-impersonate
 * version, so it is identical whether or not the image is built. The real
 * build+push stays in `deploy-infra`, which runs on a github-hosted runner. This
 * is what lets the self-hosted runner ship with no docker and no docker socket.
 *
 * All handlers share the same base image (poppler-utils for pdftoppm + pdfinfo).
 * Image tag: <contentHash>-<name>, where contentHash covers the whole handler
 * output dir (bundle + copied assets, incl. the runtime-loaded prompt files),
 * the Dockerfile, and the curl-impersonate build-arg — content-addressed so an
 * unchanged handler keeps its tag and does NOT force a redeploy. The commit SHA
 * is pushed as a second, forensic-only tag (gitsha-<sha>-<name>) that Pulumi
 * never references. ECR repo URL is resolved from the platform stack via
 * `aws ecr describe-repositories` — the platform stack must already be
 * deployed before this runs.
 *
 * Because the tag is content-addressed, a deploy first asks ECR whether that
 * exact tag is already present and, if so, reuses it instead of rebuilding —
 * an unchanged handler costs one describe-images call rather than a ~minute-long
 * docker build+push, on the staging AND prod registries independently. Only
 * genuinely new content is built. Skipping the re-push is safe because the
 * lifecycle policy now retains enough images (see HutchEcrRepository) that a
 * reused image cannot age out before its content next changes; the forensic
 * gitsha tag is still copied onto the reused image so every deployed commit
 * remains traceable. An existence probe that errors falls back to building, so
 * uncertainty never skips.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { computeImageTag } from "@packages/hutch-infra-components/infra/compute-image-tag";
import { copyAssetFiles } from "@packages/hutch-infra-components/infra/copy-asset-files";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const REPO_NAME = "hutch-ocr-lambda";
const CURL_IMPERSONATE_VERSION = readFileSync(resolve(PROJECT_ROOT, ".curl-impersonate-version"), "utf-8").trim();

const HANDLERS = [
	{
		name: "comprehensive-crawl-command",
		entryPoint: "src/runtime/comprehensive-crawl-command.main.ts",
	},
	{
		name: "pdf-page-ocr",
		entryPoint: "src/runtime/pdf-page-ocr.main.ts",
	},
	{
		name: "save-link-raw-pdf-command",
		entryPoint: "src/runtime/save-link-raw-pdf-command.main.ts",
	},
];

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

function imageTagExists(repositoryName, tag) {
	// Non-throwing existence probe. describe-images exits non-zero
	// (ImageNotFoundException) when the tag is absent; any failure at all —
	// missing tag or a transient API error — resolves to "not present" so the
	// caller falls back to building. Uncertainty must never skip a build.
	const result = spawnSync("aws", [
		"ecr", "describe-images",
		"--repository-name", repositoryName,
		"--image-ids", `imageTag=${tag}`,
		"--query", "imageDetails[0].imageDigest",
		"--output", "text",
	], { encoding: "utf-8" });
	const digest = result.status === 0 ? (result.stdout?.trim() ?? "") : "";
	return digest !== "" && digest !== "None";
}

function retagForensic(repositoryName, contentTag, forensicTag) {
	// Keep the invariant that every deployed commit's image carries its gitsha
	// tag even when the content build was skipped: copy the existing manifest
	// onto the forensic tag with no rebuild. Best-effort — the tag is
	// forensic-only (Pulumi never references it), and put-image also rejects a
	// tag that already exists (a redeploy of the same commit), so a failure here
	// must never fail the deploy.
	try {
		const manifest = run("aws", [
			"ecr", "batch-get-image",
			"--repository-name", repositoryName,
			"--image-ids", `imageTag=${contentTag}`,
			"--query", "images[0].imageManifest",
			"--output", "text",
		]);
		run("aws", [
			"ecr", "put-image",
			"--repository-name", repositoryName,
			"--image-tag", forensicTag,
			"--image-manifest", manifest,
		]);
	} catch (err) {
		console.warn(`[build-image] forensic retag ${forensicTag} skipped: ${err.message}`);
	}
}

function resolveRepositoryUrl() {
	const stdout = run("aws", [
		"ecr", "describe-repositories",
		"--repository-names", REPO_NAME,
		"--query", "repositories[0].repositoryUri",
		"--output", "text",
	]);
	if (!stdout) {
		throw new Error(`ECR repository '${REPO_NAME}' not found in target region. Deploy the platform stack first.`);
	}
	return stdout;
}

function loginToEcr(repositoryUrl) {
	const registry = repositoryUrl.split("/")[0];
	const password = run("aws", ["ecr", "get-login-password"]);
	run("docker", ["login", "--username", "AWS", "--password-stdin", registry], { input: password });
}

async function bundleHandler(handler) {
	const outputDir = resolve(PROJECT_ROOT, ".lib", handler.name);
	mkdirSync(outputDir, { recursive: true });
	await build({
		entryPoints: [resolve(PROJECT_ROOT, handler.entryPoint)],
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

function buildAndPushImage(handler, repositoryUrl, tag, gitSha) {
	const imageUri = `${repositoryUrl}:${tag}`;
	// A second tag on the same image, carrying the commit SHA purely for
	// forensics (image → commit). Pulumi references only `imageUri` (the content
	// tag) via ocr-image-tags.json, so this never affects the drift decision.
	const forensicUri = `${repositoryUrl}:gitsha-${gitSha}-${handler.name}`;
	const handlerDirRelative = `.lib/${handler.name}`;
	console.log(`[build-image] building ${imageUri} (+${forensicUri})`);
	run("docker", [
		"buildx", "build",
		"--platform", "linux/amd64",
		// Lambda rejects the SLSA provenance attestation manifest buildx adds by default
		// with InvalidParameterValueException ("image manifest ... not supported").
		"--provenance=false",
		"--build-arg", `HANDLER_DIR=${handlerDirRelative}`,
		"--build-arg", `CURL_IMPERSONATE_VERSION=${CURL_IMPERSONATE_VERSION}`,
		"--tag", imageUri,
		"--tag", forensicUri,
		"--file", "Dockerfile",
		"--push",
		".",
	], { stdio: "inherit", cwd: PROJECT_ROOT });
	return imageUri;
}

const TAG_ONLY = process.argv.includes("--tag-only");

async function main() {
	const repositoryUrl = resolveRepositoryUrl();
	// The forensic gitsha tag and the ECR login are only needed for an actual
	// build+push; --tag-only skips both (no docker involved).
	const gitSha = TAG_ONLY ? null : run("git", ["rev-parse", "--short=12", "HEAD"]);
	console.log(`[build-image] ${TAG_ONLY ? "tag-only " : ""}git=${gitSha ?? "-"} repo=${repositoryUrl}`);

	console.log(`[build-image] bundling ${HANDLERS.length} handlers in parallel`);
	await Promise.all(HANDLERS.map((handler) => bundleHandler(handler)));

	/* Image-level inputs shared across handlers — Dockerfile contents and the
	 * curl-impersonate version pinned via build-arg. If either changes, every
	 * handler's image changes too, so they must contribute to the tag. */
	const dockerfileContents = readFileSync(resolve(PROJECT_ROOT, "Dockerfile"));

	// Log in to ECR once, lazily, and only if a handler actually needs a
	// build+push. A deploy where every image is already in ECR does no docker
	// work at all.
	let loggedIn = false;
	const ensureLogin = () => {
		if (!loggedIn) {
			loginToEcr(repositoryUrl);
			loggedIn = true;
		}
	};

	const tags = {};
	for (const handler of HANDLERS) {
		/* Content-address the tag over every input that can change the image so
		 * Pulumi sees a different imageUri and redeploys the Lambda only when the
		 * content actually changed — ECR tags are mutable, so the tag string is
		 * the sole thing Pulumi diffs. Hashing covers the whole handler output
		 * dir (bundle + copied assets, incl. runtime-loaded prompts), the
		 * Dockerfile, and the curl-impersonate build-arg. */
		const tag = computeImageTag({
			handlerName: handler.name,
			handlerOutputDir: resolve(PROJECT_ROOT, ".lib", handler.name),
			dockerfileContents,
			curlImpersonateVersion: CURL_IMPERSONATE_VERSION,
		});
		const imageUri = `${repositoryUrl}:${tag}`;
		// --tag-only writes the imageUri Pulumi would diff, no docker involved.
		if (TAG_ONLY) {
			tags[handler.name] = imageUri;
			continue;
		}
		// Content-addressed: if the tag is already in ECR the image is byte-for-byte
		// what a rebuild would produce, so reuse it and skip the build+push — still
		// stamping the forensic gitsha tag so the commit stays traceable.
		if (imageTagExists(REPO_NAME, tag)) {
			console.log(`[build-image] reuse ${imageUri} — already in ECR, skipping build`);
			retagForensic(REPO_NAME, tag, `gitsha-${gitSha}-${handler.name}`);
			tags[handler.name] = imageUri;
			continue;
		}
		ensureLogin();
		tags[handler.name] = buildAndPushImage(handler, repositoryUrl, tag, gitSha);
	}

	const tagsFile = resolve(PROJECT_ROOT, ".lib", "ocr-image-tags.json");
	mkdirSync(dirname(tagsFile), { recursive: true });
	writeFileSync(tagsFile, `${JSON.stringify(tags, null, 2)}\n`);
	console.log(`[build-image] wrote ${tagsFile}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
