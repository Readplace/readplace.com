import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@packages/logger";
import { build } from "esbuild";
import { computeImageTag } from "./compute-image-tag";
import { copyAssetFiles } from "./copy-asset-files";

type SpawnOptions = {
	stdio: ["ignore" | "pipe", "pipe" | "inherit", "pipe" | "inherit"];
	encoding: "utf-8";
	input?: string;
	cwd?: string;
};

type SpawnResult = {
	status: number | null;
	stdout: string | null;
	stderr: string | null;
};

export type Spawn = (
	command: string,
	args: string[],
	options: SpawnOptions,
) => SpawnResult;

export type HandlerImage = {
	name: string;
	entryPoint: string;
	assets?: readonly { from: string; to: string }[];
};

export type BuildHandlerImages = (config: {
	projectRoot: string;
	repositoryName: string;
	handlers: readonly HandlerImage[];
	buildArgs: Readonly<Record<string, string>>;
	tagsFile: string;
	tagOnly: boolean;
}) => Promise<Record<string, string>>;

const PIPED: SpawnOptions = {
	stdio: ["ignore", "pipe", "pipe"],
	encoding: "utf-8",
};

export function initBuildHandlerImages(io: {
	spawn: Spawn;
	logger: Logger;
}): BuildHandlerImages {
	const { spawn, logger } = io;

	function run(
		command: string,
		args: string[],
		options: SpawnOptions = PIPED,
	): string {
		const result = spawn(command, args, options);
		const stdout = (result.stdout ?? "").trim();
		if (result.status !== 0) {
			const stderr = (result.stderr ?? "").trim();
			throw new Error(
				`${command} ${args.join(" ")} failed (exit ${result.status}): ${stderr || stdout}`,
			);
		}
		return stdout;
	}

	function imageTagExists(repositoryName: string, tag: string): boolean {
		// Non-throwing existence probe. describe-images exits non-zero
		// (ImageNotFoundException) when the tag is absent; any failure at all —
		// missing tag or a transient API error — resolves to "not present" so the
		// caller falls back to building. Uncertainty must never skip a build.
		let digest: string;
		try {
			digest = run("aws", [
				"ecr",
				"describe-images",
				"--repository-name",
				repositoryName,
				"--image-ids",
				`imageTag=${tag}`,
				"--query",
				"imageDetails[0].imageDigest",
				"--output",
				"text",
			]);
		} catch {
			return false;
		}
		return digest !== "" && digest !== "None";
	}

	function retagForensic(args: {
		repositoryName: string;
		contentTag: string;
		forensicTag: string;
	}): void {
		// Keep the invariant that every deployed commit's image carries its gitsha
		// tag even when the content build was skipped: copy the existing manifest
		// onto the forensic tag with no rebuild. Best-effort — the tag is
		// forensic-only (Pulumi never references it), and put-image also rejects a
		// tag that already exists (a redeploy of the same commit), so a failure here
		// must never fail the deploy.
		try {
			const manifest = run("aws", [
				"ecr",
				"batch-get-image",
				"--repository-name",
				args.repositoryName,
				"--image-ids",
				`imageTag=${args.contentTag}`,
				"--query",
				"images[0].imageManifest",
				"--output",
				"text",
			]);
			run("aws", [
				"ecr",
				"put-image",
				"--repository-name",
				args.repositoryName,
				"--image-tag",
				args.forensicTag,
				"--image-manifest",
				manifest,
			]);
		} catch (err) {
			logger.warn(
				`[build-image] forensic retag ${args.forensicTag} skipped: ${String(err)}`,
			);
		}
	}

	function resolveRepositoryUrl(repositoryName: string): string {
		const stdout = run("aws", [
			"ecr",
			"describe-repositories",
			"--repository-names",
			repositoryName,
			"--query",
			"repositories[0].repositoryUri",
			"--output",
			"text",
		]);
		if (!stdout) {
			throw new Error(
				`ECR repository '${repositoryName}' not found in target region. Deploy the platform stack first.`,
			);
		}
		return stdout;
	}

	function loginToEcr(repositoryUrl: string): void {
		const registry = repositoryUrl.split("/")[0];
		const password = run("aws", ["ecr", "get-login-password"]);
		run(
			"docker",
			["login", "--username", "AWS", "--password-stdin", registry],
			{
				stdio: ["pipe", "pipe", "pipe"],
				encoding: "utf-8",
				input: password,
			},
		);
	}

	async function bundleHandler(
		projectRoot: string,
		handler: HandlerImage,
	): Promise<void> {
		const outputDir = resolve(projectRoot, ".lib", handler.name);
		mkdirSync(outputDir, { recursive: true });
		await build({
			entryPoints: [resolve(projectRoot, handler.entryPoint)],
			bundle: true,
			sourcemap: true,
			platform: "node",
			format: "cjs",
			minify: true,
			outfile: `${outputDir}/index.js`,
			target: ["node22"],
			loader: { ".ts": "ts" },
		});
		copyAssetFiles({ src: resolve(projectRoot, "src"), dest: outputDir });
		for (const asset of handler.assets ?? []) {
			cpSync(resolve(projectRoot, asset.from), resolve(outputDir, asset.to), {
				recursive: true,
				dereference: true,
			});
		}
	}

	function buildAndPushImage(args: {
		projectRoot: string;
		handler: HandlerImage;
		repositoryUrl: string;
		tag: string;
		gitSha: string;
		buildArgs: Readonly<Record<string, string>>;
	}): string {
		const imageUri = `${args.repositoryUrl}:${args.tag}`;
		// A second tag on the same image, carrying the commit SHA purely for
		// forensics (image → commit). Pulumi references only `imageUri` (the content
		// tag), so this never affects the drift decision.
		const forensicUri = `${args.repositoryUrl}:gitsha-${args.gitSha}-${args.handler.name}`;
		logger.info(`[build-image] building ${imageUri} (+${forensicUri})`);
		run(
			"docker",
			[
				"buildx",
				"build",
				"--platform",
				"linux/amd64",
				// Lambda rejects the SLSA provenance attestation manifest buildx adds by default
				// with InvalidParameterValueException ("image manifest ... not supported").
				"--provenance=false",
				"--build-arg",
				`HANDLER_DIR=.lib/${args.handler.name}`,
				...Object.entries(args.buildArgs).flatMap(([key, value]) => [
					"--build-arg",
					`${key}=${value}`,
				]),
				"--tag",
				imageUri,
				"--tag",
				forensicUri,
				"--file",
				"Dockerfile",
				"--push",
				".",
			],
			{
				stdio: ["ignore", "inherit", "inherit"],
				encoding: "utf-8",
				cwd: args.projectRoot,
			},
		);
		return imageUri;
	}

	return async (config) => {
		const { projectRoot, repositoryName, handlers, buildArgs, tagOnly } =
			config;
		const repositoryUrl = resolveRepositoryUrl(repositoryName);
		// The forensic gitsha tag and the ECR login are only needed for an actual
		// build+push; --tag-only skips both (no docker involved).
		const gitSha = tagOnly
			? null
			: run("git", ["rev-parse", "--short=12", "HEAD"]);
		logger.info(
			`[build-image] ${tagOnly ? "tag-only " : ""}git=${gitSha ?? "-"} repo=${repositoryUrl}`,
		);

		logger.info(
			`[build-image] bundling ${handlers.length} handlers in parallel`,
		);
		await Promise.all(
			handlers.map((handler) => bundleHandler(projectRoot, handler)),
		);

		const dockerfileContents = readFileSync(resolve(projectRoot, "Dockerfile"));

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

		const tags: Record<string, string> = {};
		for (const handler of handlers) {
			const tag = computeImageTag({
				handlerName: handler.name,
				handlerOutputDir: resolve(projectRoot, ".lib", handler.name),
				dockerfileContents,
				buildArgs,
			});
			const imageUri = `${repositoryUrl}:${tag}`;
			if (gitSha === null) {
				tags[handler.name] = imageUri;
				continue;
			}
			// Content-addressed: if the tag is already in ECR the image is byte-for-byte
			// what a rebuild would produce, so reuse it and skip the build+push — still
			// stamping the forensic gitsha tag so the commit stays traceable.
			if (imageTagExists(repositoryName, tag)) {
				logger.info(
					`[build-image] reuse ${imageUri} — already in ECR, skipping build`,
				);
				retagForensic({
					repositoryName,
					contentTag: tag,
					forensicTag: `gitsha-${gitSha}-${handler.name}`,
				});
				tags[handler.name] = imageUri;
				continue;
			}
			ensureLogin();
			tags[handler.name] = buildAndPushImage({
				projectRoot,
				handler,
				repositoryUrl,
				tag,
				gitSha,
				buildArgs,
			});
		}

		const tagsFile = resolve(projectRoot, config.tagsFile);
		mkdirSync(dirname(tagsFile), { recursive: true });
		writeFileSync(tagsFile, `${JSON.stringify(tags, null, 2)}\n`);
		logger.info(`[build-image] wrote ${tagsFile}`);
		return tags;
	};
}
