import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger, noopLogger } from "@packages/logger";
import { initBuildHandlerImages, type Spawn } from "./build-handler-images";
import { computeImageTag } from "./compute-image-tag";

type Answer = {
	status: number | null;
	stdout: string | null;
	stderr: string | null;
};

const REPOSITORY_URL =
	"123.dkr.ecr.ap-southeast-2.amazonaws.com/hutch-ocr-lambda";
const ok = (stdout: string | null): Answer => ({
	status: 0,
	stdout,
	stderr: "",
});

function fakeSpawn(answer: (command: string, args: string[]) => Answer) {
	const calls: {
		command: string;
		args: string[];
		input?: string;
		cwd?: string;
	}[] = [];
	const spawn: Spawn = (command, args, options) => {
		calls.push({ command, args, input: options.input, cwd: options.cwd });
		return answer(command, args);
	};
	return { spawn, calls };
}

function awsAnswers(
	overrides: (command: string, args: string[]) => Answer | undefined,
) {
	return (command: string, args: string[]): Answer => {
		const overridden = overrides(command, args);
		if (overridden) return overridden;
		if (args[1] === "describe-repositories") return ok(`${REPOSITORY_URL}\n`);
		if (command === "git") return ok("abc123def456\n");
		if (args[1] === "get-login-password") return ok("secret");
		if (command === "docker") return { status: 0, stdout: null, stderr: null };
		return ok("");
	};
}

describe("initBuildHandlerImages", () => {
	let projectRoot: string;

	beforeEach(() => {
		projectRoot = mkdtempSync(join(tmpdir(), "build-handler-images-"));
		mkdirSync(join(projectRoot, "src", "runtime"), { recursive: true });
		writeFileSync(
			join(projectRoot, "src", "runtime", "a.main.ts"),
			"export const handler = (): number => 1;\n",
		);
		writeFileSync(
			join(projectRoot, "src", "runtime", "b.main.ts"),
			"export const handler = (): number => 2;\n",
		);
		writeFileSync(
			join(projectRoot, "src", "runtime", "prompt.md"),
			"Summarise this.",
		);
		mkdirSync(join(projectRoot, "vendor", "bin"), { recursive: true });
		writeFileSync(join(projectRoot, "vendor", "bin", "tool"), "binary");
		writeFileSync(
			join(projectRoot, "Dockerfile"),
			"FROM public.ecr.aws/lambda/nodejs:22\n",
		);
	});

	afterEach(() => {
		rmSync(projectRoot, { recursive: true, force: true });
	});

	const handlers = [
		{ name: "a", entryPoint: "src/runtime/a.main.ts" },
		{
			name: "b",
			entryPoint: "src/runtime/b.main.ts",
			assets: [{ from: "vendor/bin", to: "tool-bin" }],
		},
	];

	function config(tagOnly: boolean) {
		return {
			projectRoot,
			repositoryName: "hutch-ocr-lambda",
			handlers,
			buildArgs: { CURL_IMPERSONATE_VERSION: "1.0.0" },
			tagsFile: ".lib/ocr-image-tags.json",
			tagOnly,
		};
	}

	function expectedTag(name: string): string {
		return computeImageTag({
			handlerName: name,
			handlerOutputDir: join(projectRoot, ".lib", name),
			dockerfileContents: readFileSync(join(projectRoot, "Dockerfile")),
			buildArgs: { CURL_IMPERSONATE_VERSION: "1.0.0" },
		});
	}

	function readTagsFile(): unknown {
		return JSON.parse(
			readFileSync(join(projectRoot, ".lib", "ocr-image-tags.json"), "utf-8"),
		);
	}

	it("writes each handler's content tag to the tags file with no build or push when tagOnly", async () => {
		const { spawn, calls } = fakeSpawn(awsAnswers(() => undefined));

		const tags = await initBuildHandlerImages({
			spawn,
			logger: Logger.from(noopLogger),
		})(config(true));

		const expected = {
			a: `${REPOSITORY_URL}:${expectedTag("a")}`,
			b: `${REPOSITORY_URL}:${expectedTag("b")}`,
		};
		assert.deepEqual(tags, expected);
		assert.deepEqual(readTagsFile(), expected);
		assert.deepEqual(
			calls.map((call) => [call.command, call.args[1]]),
			[["aws", "describe-repositories"]],
		);
		assert.equal(
			readFileSync(
				join(projectRoot, ".lib", "a", "runtime", "prompt.md"),
				"utf-8",
			),
			"Summarise this.",
		);
		assert.equal(
			readFileSync(join(projectRoot, ".lib", "b", "tool-bin", "tool"), "utf-8"),
			"binary",
		);
	});

	it("reuses a tag already in ECR, builds the rest, and logs in to ECR once", async () => {
		const { spawn, calls } = fakeSpawn(
			awsAnswers((_command, args) => {
				if (args[1] !== "describe-images") return undefined;
				return args[5].endsWith("-a")
					? ok("sha256:abc\n")
					: { status: 254, stdout: "", stderr: "ImageNotFound" };
			}),
		);

		const tags = await initBuildHandlerImages({
			spawn,
			logger: Logger.from(noopLogger),
		})({
			...config(false),
			handlers: [
				...handlers,
				{ name: "c", entryPoint: "src/runtime/a.main.ts" },
			],
		});

		assert.deepEqual(tags, {
			a: `${REPOSITORY_URL}:${expectedTag("a")}`,
			b: `${REPOSITORY_URL}:${expectedTag("b")}`,
			c: `${REPOSITORY_URL}:${expectedTag("c")}`,
		});
		assert.deepEqual(
			calls.map((call) => [call.command, call.args[1]]),
			[
				["aws", "describe-repositories"],
				["git", "--short=12"],
				["aws", "describe-images"],
				["aws", "batch-get-image"],
				["aws", "put-image"],
				["aws", "describe-images"],
				["aws", "get-login-password"],
				["docker", "--username"],
				["docker", "build"],
				["aws", "describe-images"],
				["docker", "build"],
			],
		);
		const login = calls[7];
		assert.equal(login.input, "secret");
		assert.equal(login.args[4], "123.dkr.ecr.ap-southeast-2.amazonaws.com");
		const build = calls[8];
		assert.equal(build.cwd, projectRoot);
		assert.deepEqual(build.args, [
			"buildx",
			"build",
			"--platform",
			"linux/amd64",
			"--provenance=false",
			"--build-arg",
			"HANDLER_DIR=.lib/b",
			"--build-arg",
			"CURL_IMPERSONATE_VERSION=1.0.0",
			"--tag",
			`${REPOSITORY_URL}:${expectedTag("b")}`,
			"--tag",
			`${REPOSITORY_URL}:gitsha-abc123def456-b`,
			"--file",
			"Dockerfile",
			"--push",
			".",
		]);
		assert.deepEqual(calls[4].args.slice(-3), [
			"gitsha-abc123def456-a",
			"--image-manifest",
			"",
		]);
	});

	it("builds a handler whose ECR probe answers None", async () => {
		const { spawn, calls } = fakeSpawn(
			awsAnswers((_command, args) =>
				args[1] === "describe-images" ? ok("None\n") : undefined,
			),
		);

		await initBuildHandlerImages({
			spawn,
			logger: Logger.from(noopLogger),
		})({
			...config(false),
			handlers: [handlers[0]],
		});

		assert.equal(calls.filter((call) => call.args[1] === "build").length, 1);
	});

	it("warns and keeps the reused tag when the forensic retag fails", async () => {
		const warnings: unknown[] = [];
		const { spawn } = fakeSpawn(
			awsAnswers((_command, args) => {
				if (args[1] === "describe-images") return ok("sha256:abc");
				if (args[1] === "batch-get-image")
					return { status: 255, stdout: "throttled", stderr: "" };
				return undefined;
			}),
		);

		const tags = await initBuildHandlerImages({
			spawn,
			logger: Logger.from({
				...noopLogger,
				warn: (message: unknown) => warnings.push(message),
			}),
		})({ ...config(false), handlers: [handlers[0]] });

		assert.deepEqual(tags, { a: `${REPOSITORY_URL}:${expectedTag("a")}` });
		assert.deepEqual(warnings, [
			`[build-image] forensic retag gitsha-abc123def456-a skipped: Error: aws ecr batch-get-image --repository-name hutch-ocr-lambda --image-ids imageTag=${expectedTag("a")} --query images[0].imageManifest --output text failed (exit 255): throttled`,
		]);
	});

	it("rejects when the ECR repository is not found", async () => {
		const { spawn } = fakeSpawn(
			awsAnswers((_command, args) =>
				args[1] === "describe-repositories" ? ok("") : undefined,
			),
		);

		await assert.rejects(
			initBuildHandlerImages({ spawn, logger: Logger.from(noopLogger) })(
				config(true),
			),
			{
				message:
					"ECR repository 'hutch-ocr-lambda' not found in target region. Deploy the platform stack first.",
			},
		);
	});

	it("rejects with the command's stderr when describe-repositories fails", async () => {
		const { spawn } = fakeSpawn(
			awsAnswers((_command, args) =>
				args[1] === "describe-repositories"
					? { status: 254, stdout: "", stderr: "AccessDenied\n" }
					: undefined,
			),
		);

		await assert.rejects(
			initBuildHandlerImages({ spawn, logger: Logger.from(noopLogger) })(
				config(true),
			),
			{
				message:
					"aws ecr describe-repositories --repository-names hutch-ocr-lambda --query repositories[0].repositoryUri --output text failed (exit 254): AccessDenied",
			},
		);
	});

	it("rejects and writes no tags file when the docker build fails", async () => {
		const { spawn } = fakeSpawn(
			awsAnswers((command, args) => {
				if (args[1] === "describe-images")
					return { status: 254, stdout: "", stderr: "" };
				if (command === "docker" && args[0] === "buildx")
					return { status: 1, stdout: null, stderr: null };
				return undefined;
			}),
		);

		await assert.rejects(
			initBuildHandlerImages({ spawn, logger: Logger.from(noopLogger) })({
				...config(false),
				handlers: [handlers[0]],
			}),
			/^Error: docker buildx build .* failed \(exit 1\): $/,
		);
		assert.throws(() => readTagsFile(), { code: "ENOENT" });
	});
});
