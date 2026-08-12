import { initVisualBaselines, packagingPath } from "./visual-baselines";

type Invocation = { command: string; args: string[]; env?: NodeJS.ProcessEnv };

function harness(overrides: { platform?: string; status?: string; failDockerPull?: boolean } = {}) {
	const invocations: Invocation[] = [];
	const logs: string[] = [];
	const deps = {
		run: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
			if (overrides.failDockerPull && command === "docker" && args[0] === "pull") {
				throw new Error("docker daemon unreachable");
			}
			invocations.push({ command, args, env: options?.env });
		},
		capture: (command: string, args: string[]) => {
			invocations.push({ command, args });
			return overrides.status ?? "";
		},
		globSync: (pattern: string) =>
			pattern.includes("*-visual") ? ["src/e2e/popup-visual.e2e-local.ts"] : [],
		platform: overrides.platform ?? "darwin",
		log: (message: string) => logs.push(message),
	};
	return { deps, invocations, logs };
}

const planInput = {
	projectRoot: "/repo/projects/browser-extensions/firefox-extension",
	workspaceRoot: "/repo",
	projectLabel: "Firefox Extension",
	playwrightConfig: "playwright.config.local-dev.ts",
	browser: "firefox",
	specPatterns: ["src/e2e/**/*-visual.e2e-local.ts"],
	playwrightVersion: "1.60.0",
	buildEnv: { HUTCH_SERVER_URL: "http://127.0.0.1:3000" },
	captureEnv: { HEADLESS: "true" },
};

describe("createBaselinePlan", () => {
	it("pins the container to the exact pinned Playwright version", () => {
		const { deps } = harness();
		const plan = initVisualBaselines(deps).createBaselinePlan(planInput);

		expect(plan.image).toBe("mcr.microsoft.com/playwright:v1.60.0-noble");
	});

	it("rewrites every baseline rather than only the ones that fail comparison", () => {
		const { deps } = harness();
		const plan = initVisualBaselines(deps).createBaselinePlan(planInput);

		expect(plan.playwrightCommand).toEqual([
			"node_modules/.bin/playwright",
			"test",
			"--config",
			"playwright.config.local-dev.ts",
			"--update-snapshots=all",
			"src/e2e/popup-visual.e2e-local.ts",
		]);
	});

	it("bind-mounts the workspace and sources .envrc before running in the container", () => {
		const { deps } = harness();
		const plan = initVisualBaselines(deps).createBaselinePlan(planInput);

		expect(plan.dockerRunArgs).toContain("--ipc=host");
		expect(plan.dockerRunArgs).toContain("/repo:/repo");
		expect(plan.dockerRunArgs[plan.dockerRunArgs.length - 1]).toBe(
			'cd "/repo" && . ./.envrc && cd "/repo/projects/browser-extensions/firefox-extension" && exec node_modules/.bin/playwright test --config playwright.config.local-dev.ts --update-snapshots=all src/e2e/popup-visual.e2e-local.ts',
		);
	});

	it("refuses to run anywhere the darwin baselines cannot be captured", () => {
		const { deps } = harness({ platform: "linux" });

		expect(() => initVisualBaselines(deps).createBaselinePlan(planInput)).toThrow(
			/only be captured on macOS/,
		);
	});

	it("refuses a floating Playwright version, which would drift from the container", () => {
		const { deps } = harness();

		expect(() =>
			initVisualBaselines(deps).createBaselinePlan({ ...planInput, playwrightVersion: "^1.60.0" }),
		).toThrow(/pinned to an exact version/);
		expect(() =>
			initVisualBaselines(deps).createBaselinePlan({ ...planInput, playwrightVersion: undefined }),
		).toThrow(/pinned to an exact version/);
	});

	it("refuses a pattern that matches no spec, so a rename cannot silently capture nothing", () => {
		const { deps } = harness();

		expect(() =>
			initVisualBaselines(deps).createBaselinePlan({ ...planInput, specPatterns: ["src/e2e/none.ts"] }),
		).toThrow(/no visual specs matched src\/e2e\/none\.ts/);
	});
});

describe("plan execution", () => {
	it("names Docker as the only place the linux baselines can come from when it is unreachable", () => {
		const { deps } = harness({ failDockerPull: true });
		const plan = initVisualBaselines(deps).createBaselinePlan(planInput);

		expect(() => plan.pullImage()).toThrow(/Cannot reach Docker/);
	});

	it("installs the same engine the suite runs before capturing on darwin", () => {
		const { deps, invocations } = harness();
		initVisualBaselines(deps).createBaselinePlan(planInput).captureDarwin();

		expect(invocations.map((call) => [call.command, ...call.args].join(" "))).toEqual([
			"node scripts/build-extension.js",
			"node_modules/.bin/playwright install firefox",
			"node_modules/.bin/playwright test --config playwright.config.local-dev.ts --update-snapshots=all src/e2e/popup-visual.e2e-local.ts",
		]);
		expect(invocations[0].env).toEqual({ HUTCH_SERVER_URL: "http://127.0.0.1:3000" });
	});

	it("records under the same headless renderer the gate verifies with", () => {
		const { deps, invocations } = harness();
		initVisualBaselines(deps).createBaselinePlan(planInput).captureDarwin();

		const capture = invocations.find((call) => call.args.includes("--update-snapshots=all"));
		expect(capture?.env).toEqual({ HEADLESS: "true" });
	});

	it("reports which baselines moved so every platform is committed together", () => {
		const { deps, logs } = harness({ status: "?? src/e2e/x.ts-snapshots/a.png" });
		initVisualBaselines(deps).createBaselinePlan(planInput).reportBaselines();

		expect(logs).toEqual([
			"\nBaselines changed — commit every platform together:\n?? src/e2e/x.ts-snapshots/a.png\n",
		]);
	});

	it("says so when a rerun reproduced the committed bytes exactly", () => {
		const { deps, logs } = harness();
		initVisualBaselines(deps).createBaselinePlan(planInput).reportBaselines();

		expect(logs).toEqual(["\nBaselines are byte-identical to the committed ones.\n"]);
	});

	it("captures darwin before linux, so the container reuses the package darwin built", () => {
		const { deps, invocations } = harness();
		initVisualBaselines(deps).createBaselinePlan(planInput).run();

		const commands = invocations.map((call) => `${call.command} ${call.args[0]}`);
		expect(commands).toEqual([
			"docker pull",
			"node scripts/build-extension.js",
			"node_modules/.bin/playwright install",
			"node_modules/.bin/playwright test",
			"docker run",
			"git status",
		]);
	});

	it("labels every phase with the project so parallel runs stay readable", () => {
		const { deps, logs } = harness();
		initVisualBaselines(deps).createBaselinePlan(planInput).run();

		expect(logs[0]).toContain("Firefox Extension - Regenerating visual baselines");
		expect(logs[1]).toContain("Firefox Extension - Capturing firefox-darwin baselines");
		expect(logs[2]).toContain("Firefox Extension - Capturing firefox-linux baselines");
	});
});

describe("packagingPath", () => {
	it("puts both node_modules/.bin directories ahead of the inherited PATH", () => {
		expect(
			packagingPath({ projectRoot: "/repo/p", workspaceRoot: "/repo", currentPath: "/usr/bin" }),
		).toBe("/repo/p/node_modules/.bin:/repo/node_modules/.bin:/usr/bin");
	});

	it("still resolves the project's own binaries when the host PATH is unset", () => {
		expect(
			packagingPath({ projectRoot: "/repo/p", workspaceRoot: "/repo", currentPath: undefined }),
		).toBe("/repo/p/node_modules/.bin:/repo/node_modules/.bin:");
	});
});
