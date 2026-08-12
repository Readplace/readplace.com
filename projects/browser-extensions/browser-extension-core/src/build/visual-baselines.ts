import assert from "node:assert";
import { join } from "node:path";

const PLAYWRIGHT_BIN = "node_modules/.bin/playwright";

interface VisualBaselinesDeps {
	run: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => void;
	capture: (command: string, args: string[]) => string;
	globSync: (pattern: string, options: { cwd: string }) => string[];
	platform: string;
	log: (message: string) => void;
}

interface BaselinePlanInput {
	projectRoot: string;
	workspaceRoot: string;
	projectLabel: string;
	playwrightConfig: string;
	browser: string;
	specPatterns: readonly string[];
	playwrightVersion: string | undefined;
	buildEnv: NodeJS.ProcessEnv;
	/** Baselines must be recorded under the same headless renderer the gate
	 * verifies them with — a headed capture is a whole pixel taller, so every
	 * comparison then fails on image size before any diff threshold applies. */
	captureEnv: NodeJS.ProcessEnv;
}

/** Rewrites every baseline, not just the ones that fail comparison: a diff under
 * the harness's pixel-ratio tolerance passes without updating, which would leave
 * a committed baseline that no longer shows what ships. */
function playwrightCommand(input: { playwrightConfig: string; specs: readonly string[] }): string[] {
	return [
		PLAYWRIGHT_BIN,
		"test",
		"--config",
		input.playwrightConfig,
		"--update-snapshots=all",
		...input.specs,
	];
}

function dockerRunArgs(input: {
	workspaceRoot: string;
	projectRoot: string;
	image: string;
	command: readonly string[];
}): string[] {
	const insideContainer = [
		`cd "${input.workspaceRoot}"`,
		". ./.envrc",
		`cd "${input.projectRoot}"`,
		`exec ${input.command.join(" ")}`,
	].join(" && ");
	return [
		"run",
		"--rm",
		"--ipc=host",
		"--platform",
		"linux/amd64",
		"--volume",
		`${input.workspaceRoot}:${input.workspaceRoot}`,
		"--workdir",
		input.projectRoot,
		"--env",
		"HEADLESS=true",
		input.image,
		"bash",
		"-c",
		insideContainer,
	];
}

export function initVisualBaselines(deps: VisualBaselinesDeps) {
	return {
		createBaselinePlan(input: BaselinePlanInput) {
			assert.equal(
				deps.platform,
				"darwin",
				"the -darwin baselines can only be captured on macOS; on any other host this run would refresh linux alone and leave darwin stale",
			);
			assert(
				input.playwrightVersion && /^\d+\.\d+\.\d+$/.test(input.playwrightVersion),
				`@playwright/test must be pinned to an exact version so the container matches the host renderer, got "${input.playwrightVersion}"`,
			);

			const specs = input.specPatterns
				.flatMap((pattern) => {
					const matches = deps.globSync(pattern, { cwd: input.projectRoot });
					assert(matches.length > 0, `no visual specs matched ${pattern}`);
					return matches;
				})
				.sort();

			const image = `mcr.microsoft.com/playwright:v${input.playwrightVersion}-noble`;
			const command = playwrightCommand({ playwrightConfig: input.playwrightConfig, specs });

			return {
				specs,
				image,
				playwrightCommand: command,
				dockerRunArgs: dockerRunArgs({
					workspaceRoot: input.workspaceRoot,
					projectRoot: input.projectRoot,
					image,
					command,
				}),

				/** Docker is the only place the -linux baselines can be captured, so a
				 * failure to reach it aborts before the darwin pass rather than leaving
				 * the two platforms out of step. */
				pullImage(): void {
					try {
						deps.run("docker", ["pull", "--platform", "linux/amd64", image]);
					} catch (cause) {
						throw new Error(
							`Cannot reach Docker to pull ${image}, which is the only place the -linux baselines can be captured. Refusing to refresh darwin alone and leave the two platforms out of step — start Docker (see devbox.json) and re-run.`,
							{ cause },
						);
					}
				},

				captureDarwin(): void {
					deps.run("node", ["scripts/build-extension.js"], { env: input.buildEnv });
					deps.run(PLAYWRIGHT_BIN, ["install", input.browser]);
					const [bin, ...args] = command;
					deps.run(bin, args, { env: input.captureEnv });
				},

				/** The darwin pass already packaged the popup into the bind-mounted
				 * workspace, and those assets carry no platform-specific bytes — so the
				 * container captures the same package rather than rebuilding it without
				 * the packaging toolchain. */
				captureLinux(): void {
					deps.run("docker", dockerRunArgs({
						workspaceRoot: input.workspaceRoot,
						projectRoot: input.projectRoot,
						image,
						command,
					}));
				},

				reportBaselines(): void {
					const status = deps
						.capture("git", [
							"status",
							"--porcelain",
							"--",
							...specs.map((spec) => `${spec}-snapshots`),
						])
						.trim();
					deps.log(
						status
							? `\nBaselines changed — commit every platform together:\n${status}\n`
							: "\nBaselines are byte-identical to the committed ones.\n",
					);
				},

				run(): void {
					deps.log(
						`\n=== ${input.projectLabel} - Regenerating visual baselines for ${specs.join(", ")} ===\n`,
					);
					this.pullImage();
					deps.log(`\n=== ${input.projectLabel} - Capturing ${input.browser}-darwin baselines ===\n`);
					this.captureDarwin();
					deps.log(
						`\n=== ${input.projectLabel} - Capturing ${input.browser}-linux baselines in ${image} ===\n`,
					);
					this.captureLinux();
					this.reportBaselines();
				},
			};
		},
	};
}

/** The packaging step shells out to binaries this project installs, which only a
 * package-manager-launched script would have on its PATH. */
export function packagingPath(input: {
	projectRoot: string;
	workspaceRoot: string;
	currentPath: string | undefined;
}): string {
	return [
		join(input.projectRoot, "node_modules", ".bin"),
		join(input.workspaceRoot, "node_modules", ".bin"),
		input.currentPath ?? "",
	].join(":");
}
