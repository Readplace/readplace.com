import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { globSync } from "node:fs";
import { getFreePort } from "./get-free-port";
import { containerisedCommand, playwrightImage } from "./playwright-renderer";
import { defaultDeps } from "./run-test-phases";

const PLAYWRIGHT_CONFIG = "playwright.config.local-dev.ts";

export interface UpdateVisualBaselinesDeps {
	run: (input: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }) => void;
	capture: (input: { command: string; args: string[]; cwd: string }) => string;
	globSync: (pattern: string, options: { cwd: string }) => string[];
	getFreePort: () => Promise<number>;
	rendersNatively: () => boolean;
	shouldInstallBrowsers: () => boolean;
	parentEnv: () => NodeJS.ProcessEnv;
	log: (message: string) => void;
}

export const defaultUpdateVisualBaselinesDeps: UpdateVisualBaselinesDeps = {
	run: ({ command, args, cwd, env }) => {
		execFileSync(command, args, { cwd, env, stdio: "inherit" });
	},
	capture: ({ command, args, cwd }) => execFileSync(command, args, { cwd, encoding: "utf8" }),
	globSync: (pattern, options) => globSync(pattern, options),
	getFreePort,
	rendersNatively: defaultDeps.rendersNatively,
	shouldInstallBrowsers: defaultDeps.shouldInstallBrowsers,
	parentEnv: () => process.env,
	log: console.log,
};

export function initUpdateVisualBaselines(deps: UpdateVisualBaselinesDeps) {
	return async (input: {
		projectRoot: string;
		workspaceRoot: string;
		projectLabel: string;
		specPatterns: readonly string[];
		playwrightVersion: string | undefined;
		argvSpecs: readonly string[];
	}): Promise<void> => {
		const { projectRoot } = input;
		const specs = input.argvSpecs.length > 0 ? [...input.argvSpecs] : visualSpecs();
		const image = playwrightImage(input.playwrightVersion);
		deps.log(`\n=== ${input.projectLabel} - Regenerating visual baselines for ${specs.join(", ")} ===\n`);

		const env = { ...deps.parentEnv(), HEADLESS: "true", E2E_PORT: String(await deps.getFreePort()) };
		const playwrightCommand = ["node_modules/.bin/playwright", "test", "--config", PLAYWRIGHT_CONFIG, "--update-snapshots=all", ...specs].join(" ");
		if (deps.rendersNatively()) {
			if (deps.shouldInstallBrowsers()) {
				deps.run({ command: "node_modules/.bin/playwright", args: ["install", "chromium"], cwd: projectRoot, env });
			}
			deps.run({ command: "bash", args: ["-c", playwrightCommand], cwd: projectRoot, env });
		} else {
			pullImage(image, env);
			const renderer = { image, workspaceRoot: input.workspaceRoot, forwardEnv: ["HEADLESS", "E2E_PORT"] };
			deps.run({ command: "bash", args: ["-c", containerisedCommand(playwrightCommand, renderer, projectRoot)], cwd: projectRoot, env });
		}

		const status = deps
			.capture({ command: "git", args: ["status", "--porcelain", "--", ...specs.map((spec) => `${spec}-snapshots`)], cwd: projectRoot })
			.trim();
		deps.log(
			status
				? `\nBaselines changed — review the diff before committing:\n${status}\n`
				: "\nBaselines are byte-identical to the committed ones.\n",
		);

		function visualSpecs(): string[] {
			return input.specPatterns
				.flatMap((pattern) => {
					const matches = deps.globSync(pattern, { cwd: projectRoot });
					assert(matches.length > 0, `no visual specs matched ${pattern}`);
					return matches;
				})
				.sort();
		}

		function pullImage(image: string, env: NodeJS.ProcessEnv): void {
			try {
				deps.run({ command: "docker", args: ["pull", image], cwd: projectRoot, env });
			} catch (cause) {
				throw new Error(
					`Cannot reach Docker to pull ${image}, which is the renderer the baselines are captured and verified in. Start Docker (see devbox.json) and re-run.`,
					{ cause },
				);
			}
		}
	};
}
