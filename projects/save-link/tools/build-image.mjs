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
 * lifecycle policy now retains enough images (see EcrRepository) that a
 * reused image cannot age out before its content next changes; the forensic
 * gitsha tag is still copied onto the reused image so every deployed commit
 * remains traceable. An existence probe that errors falls back to building, so
 * uncertainty never skips.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initBuildHandlerImages } from "@packages/infra-components/infra/build-handler-images";
import { consoleLogger, Logger } from "@packages/logger";

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
  {
    name: "render-crawl-command",
    entryPoint: "src/runtime/render-crawl-command.main.ts",
    assets: [{ from: "node_modules/@sparticuz/chromium/bin", to: "chromium-bin" }],
  },
];

const buildHandlerImages = initBuildHandlerImages({ spawn: spawnSync, logger: Logger.from(consoleLogger) });

buildHandlerImages({
  projectRoot: PROJECT_ROOT,
  repositoryName: REPO_NAME,
  handlers: HANDLERS,
  buildArgs: { CURL_IMPERSONATE_VERSION },
  tagsFile: ".lib/ocr-image-tags.json",
  tagOnly: process.argv.includes("--tag-only"),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
