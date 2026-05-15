import type { ExecSyncOptions } from "node:child_process";
import { defaultDeps, initTestPhaseRunner } from "./run-test-phases";
import type { ResolvedPhase, TestPhaseRunnerDeps } from "./run-test-phases";

function createInMemoryDeps(overrides: Partial<TestPhaseRunnerDeps> = {}) {
	const executedCommands: Array<{ command: string; cwd?: string | URL; env?: NodeJS.ProcessEnv }> = [];

	const deps: TestPhaseRunnerDeps = {
		execSync: (command: string, options: ExecSyncOptions) => {
			executedCommands.push({ command, cwd: options.cwd, env: options.env });
			return Buffer.from("");
		},
		globSync: (pattern: string) => {
			if (pattern.includes("empty")) return [];
			return ["dist/e2e/test1.test.js", "dist/e2e/test2.test.js"];
		},
		log: () => {},
		shouldSkipE2E: () => false,
		...overrides,
	};

	return { deps, executedCommands };
}

function createRunner(deps: TestPhaseRunnerDeps = defaultDeps) {
	return initTestPhaseRunner(deps);
}

describe("createTestPlan", () => {
	const projectRoot = "/projects/test-project";

	it("throws when projectName is empty", () => {
		const runner = createRunner();
		expect(() =>
			runner.createTestPlan({
				config: { projectName: "", phases: [{ type: "jest", name: "unit tests", testMatch: "**/*.test.js", timeout: 10000 }] },
				projectRoot,
			}),
		).toThrow("projectName");
	});

	it("throws when phases array is empty", () => {
		const runner = createRunner();
		expect(() =>
			runner.createTestPlan({
				config: { projectName: "Test", phases: [] },
				projectRoot,
			}),
		).toThrow("At least one test phase");
	});
});

describe("jest phase resolution", () => {
	const projectRoot = "/projects/test-project";

	it("resolves jest command with testMatch and timeout", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "jest", name: "unit tests", testMatch: "**/dist/**/*.test.js", timeout: 10000 }],
			},
			projectRoot,
		});

		expect(plan.phases[0]).toEqual({
			type: "jest",
			name: "unit tests",
			command: 'node_modules/.bin/jest --testMatch="**/dist/**/*.test.js" --testTimeout=10000 --maxWorkers=6',
			skip: false,
			e2e: false,
		});
	});

	it("includes testPathIgnorePatterns when specified", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [
					{
						type: "jest",
						name: "unit tests",
						testMatch: "**/dist/**/*.test.js",
						timeout: 10000,
						testPathIgnorePatterns: "dist/e2e",
					},
				],
			},
			projectRoot,
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "jest" }>;
		expect(phase.command).toContain('--testPathIgnorePatterns="dist/e2e"');
	});

	it("includes passWithNoTests flag when set", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [
					{
						type: "jest",
						name: "unit tests",
						testMatch: "**/dist/**/*.test.js",
						timeout: 10000,
						passWithNoTests: true,
					},
				],
			},
			projectRoot,
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "jest" }>;
		expect(phase.command).toContain("--passWithNoTests");
	});

	it("uses different timeout for integration tests", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "jest", name: "integration tests", testMatch: "**/dist/**/*.integration.js", timeout: 30000 }],
			},
			projectRoot,
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "jest" }>;
		expect(phase.command).toContain("--testTimeout=30000");
	});
});

describe("node-test phase resolution", () => {
	it("resolves files from glob pattern", () => {
		const { deps } = createInMemoryDeps();
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "node-test", name: "E2E unit tests", glob: "dist/e2e/**/*.test.js" }],
			},
			projectRoot: "/projects/test",
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "node-test" }>;
		expect(phase.files).toEqual(["dist/e2e/test1.test.js", "dist/e2e/test2.test.js"]);
		expect(phase.command).toBe("node --test dist/e2e/test1.test.js dist/e2e/test2.test.js");
		expect(phase.skip).toBe(false);
	});

	it("marks phase as skip when glob matches no files", () => {
		const { deps } = createInMemoryDeps();
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "node-test", name: "E2E unit tests", glob: "empty/**/*.test.js" }],
			},
			projectRoot: "/projects/test",
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "node-test" }>;
		expect(phase.skip).toBe(true);
		expect(phase.files).toEqual([]);
	});

	it("uses explicit files when provided", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "node-test", name: "E2E tests", files: ["dist/e2e/login-flow/run.e2e-local.js"] }],
			},
			projectRoot: "/projects/test",
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "node-test" }>;
		expect(phase.command).toBe("node --test dist/e2e/login-flow/run.e2e-local.js");
	});

	it("preserves env vars", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "node-test", name: "E2E tests", files: ["test.js"], env: { HEADLESS: "true" } }],
			},
			projectRoot: "/projects/test",
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "node-test" }>;
		expect(phase.env).toEqual({ HEADLESS: "true" });
	});
});

describe("script phase resolution", () => {
	it("preserves command and env", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [
					{
						type: "script",
						name: "Building extension",
						command: "node scripts/build-extension.js",
						env: { HUTCH_SERVER_URL: "http://127.0.0.1:3000" },
					},
				],
			},
			projectRoot: "/projects/test",
		});

		expect(plan.phases[0]).toEqual({
			type: "script",
			name: "Building extension",
			command: "node scripts/build-extension.js",
			env: { HUTCH_SERVER_URL: "http://127.0.0.1:3000" },
			e2e: false,
		});
	});
});

describe("playwright phase resolution", () => {
	it("resolves browser install command", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "Readplace",
				phases: [
					{
						type: "playwright",
						name: "E2E tests",
						config: "playwright.config.local-dev.ts",
						browsers: ["chromium"],
					},
				],
			},
			projectRoot: "/projects/hutch",
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "playwright" }>;
		expect(phase.browserInstallCommand).toBe("node_modules/.bin/playwright install --with-deps chromium");
	});

	it("resolves test command with config", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "Readplace",
				phases: [
					{
						type: "playwright",
						name: "E2E tests",
						config: "playwright.config.local-dev.ts",
						browsers: ["chromium"],
					},
				],
			},
			projectRoot: "/projects/hutch",
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "playwright" }>;
		expect(phase.testCommand).toBe("node_modules/.bin/playwright test --config playwright.config.local-dev.ts");
	});

	it("supports multiple browsers", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "Readplace",
				phases: [
					{
						type: "playwright",
						name: "E2E tests",
						config: "playwright.config.local-dev.ts",
						browsers: ["chromium", "firefox"],
					},
				],
			},
			projectRoot: "/projects/hutch",
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "playwright" }>;
		expect(phase.browserInstallCommand).toBe("node_modules/.bin/playwright install --with-deps chromium firefox");
	});

	it("preserves env vars for the test command", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "Readplace",
				phases: [
					{
						type: "playwright",
						name: "E2E tests",
						config: "playwright.config.local-dev.ts",
						browsers: ["chromium"],
						env: { HEADLESS: "true", E2E_PORT: "12345" },
					},
				],
			},
			projectRoot: "/projects/hutch",
		});

		const phase = plan.phases[0] as Extract<ResolvedPhase, { type: "playwright" }>;
		expect(phase.env).toEqual({ HEADLESS: "true", E2E_PORT: "12345" });
	});
});

describe("runAllPhases execution", () => {
	it("executes jest phase with correct cwd", async () => {
		const { deps, executedCommands } = createInMemoryDeps();
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "jest", name: "unit tests", testMatch: "**/dist/**/*.test.js", timeout: 10000 }],
			},
			projectRoot: "/projects/test",
		});

		await plan.runAllPhases();

		expect(executedCommands[0].command).toContain("jest");
		expect(executedCommands[0].cwd).toBe("/projects/test");
	});

	it("skips node-test phase when no files match glob", async () => {
		const { deps, executedCommands } = createInMemoryDeps();
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "node-test", name: "E2E unit tests", glob: "empty/**/*.test.js" }],
			},
			projectRoot: "/projects/test",
		});

		await plan.runAllPhases();

		expect(executedCommands).toHaveLength(0);
	});

	it("executes node-test phase with env vars", async () => {
		const { deps, executedCommands } = createInMemoryDeps();
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [{ type: "node-test", name: "E2E tests", files: ["test.e2e.js"], env: { HEADLESS: "true" } }],
			},
			projectRoot: "/projects/test",
		});

		await plan.runAllPhases();

		expect(executedCommands[0].env).toEqual(expect.objectContaining({ HEADLESS: "true" }));
	});

	it("executes script phase with env vars", async () => {
		const { deps, executedCommands } = createInMemoryDeps();
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [
					{
						type: "script",
						name: "Build extension",
						command: "node scripts/build-extension.js",
						env: { HUTCH_SERVER_URL: "http://localhost:3000" },
					},
				],
			},
			projectRoot: "/projects/test",
		});

		await plan.runAllPhases();

		expect(executedCommands[0].command).toBe("node scripts/build-extension.js");
		expect(executedCommands[0].env).toEqual(expect.objectContaining({ HUTCH_SERVER_URL: "http://localhost:3000" }));
	});

	it("executes playwright phase: installs browsers then runs test command", async () => {
		const { deps, executedCommands } = createInMemoryDeps();
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "Readplace",
				phases: [
					{
						type: "playwright",
						name: "E2E tests",
						config: "playwright.config.local-dev.ts",
						browsers: ["chromium"],
						env: { HEADLESS: "true", E2E_PORT: "12345" },
					},
				],
			},
			projectRoot: "/projects/hutch",
		});

		await plan.runAllPhases();

		expect(executedCommands).toHaveLength(2);
		expect(executedCommands[0].command).toContain("playwright install");
		expect(executedCommands[0].cwd).toBe("/projects/hutch");
		expect(executedCommands[1].command).toContain("playwright test");
		expect(executedCommands[1].cwd).toBe("/projects/hutch");
		expect(executedCommands[1].env).toEqual(expect.objectContaining({ HEADLESS: "true", E2E_PORT: "12345" }));
	});

	it("executes multiple phases in order", async () => {
		const { deps, executedCommands } = createInMemoryDeps();
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "Readplace",
				phases: [
					{ type: "jest", name: "unit tests", testMatch: "**/dist/**/*.test.js", timeout: 10000 },
					{ type: "jest", name: "integration tests", testMatch: "**/dist/**/*.integration.js", timeout: 30000, passWithNoTests: true },
				],
			},
			projectRoot: "/projects/hutch",
		});

		await plan.runAllPhases();

		expect(executedCommands[0].command).toContain("*.test.js");
		expect(executedCommands[1].command).toContain("*.integration.js");
	});
});

describe("e2e phase skipping", () => {
	it("skips phases marked e2e when shouldSkipE2E returns true", async () => {
		const { deps, executedCommands } = createInMemoryDeps({ shouldSkipE2E: () => true });
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [
					{ type: "jest", name: "unit tests", testMatch: "**/dist/**/*.test.js", timeout: 10000 },
					{ type: "node-test", name: "E2E unit tests", files: ["test.e2e.js"], e2e: true },
					{ type: "script", name: "Build for E2E", command: "node build.js", e2e: true },
					{
						type: "playwright",
						name: "E2E tests",
						config: "playwright.config.ts",
						browsers: ["chromium"],
						e2e: true,
					},
				],
			},
			projectRoot: "/projects/test",
		});

		await plan.runAllPhases();

		expect(executedCommands).toHaveLength(1);
		expect(executedCommands[0].command).toContain("jest");
	});

	it("runs phases marked e2e when shouldSkipE2E returns false", async () => {
		const { deps, executedCommands } = createInMemoryDeps({ shouldSkipE2E: () => false });
		const runner = createRunner(deps);
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [
					{ type: "node-test", name: "E2E tests", files: ["test.e2e.js"], e2e: true },
				],
			},
			projectRoot: "/projects/test",
		});

		await plan.runAllPhases();

		expect(executedCommands).toHaveLength(1);
		expect(executedCommands[0].command).toBe("node --test test.e2e.js");
	});

	it("defaults to e2e: false on resolved phases when not specified", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [
					{ type: "jest", name: "unit tests", testMatch: "**/*.test.js", timeout: 10000 },
					{ type: "node-test", name: "E2E tests", files: ["test.e2e.js"] },
					{ type: "script", name: "Build", command: "node build.js" },
					{
						type: "playwright",
						name: "E2E tests",
						config: "playwright.config.ts",
						browsers: ["chromium"],
					},
				],
			},
			projectRoot: "/projects/test",
		});

		expect(plan.phases.map((p) => p.e2e)).toEqual([false, false, false, false]);
	});

	it("propagates e2e: true onto resolved phases", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "My Project",
				phases: [
					{ type: "jest", name: "e2e jest", testMatch: "**/e2e/*.test.js", timeout: 10000, e2e: true },
					{ type: "node-test", name: "e2e node", files: ["test.e2e.js"], e2e: true },
					{ type: "script", name: "build for e2e", command: "node build.js", e2e: true },
					{
						type: "playwright",
						name: "e2e playwright",
						config: "playwright.config.ts",
						browsers: ["chromium"],
						e2e: true,
					},
				],
			},
			projectRoot: "/projects/test",
		});

		expect(plan.phases.map((p) => p.e2e)).toEqual([true, true, true, true]);
	});
});

describe("defaultDeps.shouldSkipE2E", () => {
	const originalValue = process.env.CLAUDE_CODE_REMOTE;
	afterEach(() => {
		if (originalValue === undefined) {
			delete process.env.CLAUDE_CODE_REMOTE;
		} else {
			process.env.CLAUDE_CODE_REMOTE = originalValue;
		}
	});

	it("returns true when CLAUDE_CODE_REMOTE=true", () => {
		process.env.CLAUDE_CODE_REMOTE = "true";
		expect(defaultDeps.shouldSkipE2E()).toBe(true);
	});

	it("returns false when CLAUDE_CODE_REMOTE is unset", () => {
		delete process.env.CLAUDE_CODE_REMOTE;
		expect(defaultDeps.shouldSkipE2E()).toBe(false);
	});

	it("returns false when CLAUDE_CODE_REMOTE has a different value", () => {
		process.env.CLAUDE_CODE_REMOTE = "1";
		expect(defaultDeps.shouldSkipE2E()).toBe(false);
	});
});

describe("plan metadata", () => {
	it("exposes projectName", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "Browser Extension Core",
				phases: [{ type: "jest", name: "unit tests", testMatch: "**/*.test.js", timeout: 10000 }],
			},
			projectRoot: "/projects/test",
		});

		expect(plan.projectName).toBe("Browser Extension Core");
	});

	it("exposes all resolved phases", () => {
		const runner = createRunner();
		const plan = runner.createTestPlan({
			config: {
				projectName: "Test",
				phases: [
					{ type: "jest", name: "unit tests", testMatch: "**/*.test.js", timeout: 10000 },
					{ type: "script", name: "build", command: "node build.js" },
				],
			},
			projectRoot: "/projects/test",
		});

		expect(plan.phases).toHaveLength(2);
		expect(plan.phases[0].type).toBe("jest");
		expect(plan.phases[1].type).toBe("script");
	});
});
