#!/usr/bin/env node
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initBuildHandlerImages } from "@packages/infra-components/infra/build-handler-images";
import { consoleLogger, Logger } from "@packages/logger";
import { requireEnv } from "@packages/require-env";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FFMPEG_IMAGE_REF = readFileSync(resolve(PROJECT_ROOT, ".ffmpeg-version"), "utf-8").trim();

const stack = requireEnv("PULUMI_STACK");
const stackConfig = readFileSync(resolve(PROJECT_ROOT, `Pulumi.${stack}.yaml`), "utf-8");
const repositoryName = /^\s*media-audio:mediaLambdaRepositoryName:\s*(\S+)\s*$/m.exec(stackConfig)?.[1];
assert(repositoryName, `media-audio:mediaLambdaRepositoryName is not set in Pulumi.${stack}.yaml`);

const buildHandlerImages = initBuildHandlerImages({ spawn: spawnSync, logger: Logger.from(consoleLogger) });

buildHandlerImages({
  projectRoot: PROJECT_ROOT,
  repositoryName,
  handlers: [{ name: "prepare-transcription", entryPoint: "src/runtime/prepare-transcription.main.ts" }],
  buildArgs: { FFMPEG_IMAGE_REF },
  tagsFile: ".lib/media-audio-image-tags.json",
  tagOnly: process.argv.includes("--tag-only"),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
