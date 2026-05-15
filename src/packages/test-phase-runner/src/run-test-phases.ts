import assert from "node:assert";
import { execSync as defaultExecSync } from "node:child_process";
import type { ExecSyncOptions } from "node:child_process";
import { globSync as defaultGlobSync } from "node:fs";

interface JestPhase {
	type: "jest";
	name: string;
	testMatch: string;
	timeout: number;
	testPathIgnorePatterns?: string;
	passWithNoTests?: boolean;
	e2e?: boolean;
}

interface NodeTestPhase {
	type: "node-test";
	name: string;
	glob?: string;
	files?: string[];
	timeout?: number;
	env?: Record<string, string>;
	e2e?: boolean;
}

interface ScriptPhase {
	type: "script";
	name: string;
	command: string;
	env?: Record<string, string>;
	e2e?: boolean;
}

interface PlaywrightPhase {
	type: "playwright";
	name: string;
	config: string;
	browsers: string[];
	env?: Record<string, string>;
	e2e?: boolean;
}

export type TestPhase = JestPhase | NodeTestPhase | ScriptPhase | PlaywrightPhase;

export interface TestRunConfig {
	projectName: string;
	phases: TestPhase[];
}

interface ResolvedJestPhase {
	type: "jest";
	name: string;
	command: string;
	skip: false;
	e2e: boolean;
}

interface ResolvedNodeTestPhase {
	type: "node-test";
	name: string;
	command: string;
	env: Record<string, string>;
	files: string[];
	skip: boolean;
	e2e: boolean;
}

interface ResolvedScriptPhase {
	type: "script";
	name: string;
	command: string;
	env: Record<string, string>;
	e2e: boolean;
}

interface ResolvedPlaywrightPhase {
	type: "playwright";
	name: string;
	browserInstallCommand: string;
	testCommand: string;
	env: Record<string, string>;
	e2e: boolean;
}

export type ResolvedPhase =
	| ResolvedJestPhase
	| ResolvedNodeTestPhase
	| ResolvedScriptPhase
	| ResolvedPlaywrightPhase;

export interface TestPlan {
	projectName: string;
	phases: ResolvedPhase[];
	runAllPhases(): Promise<void>;
}

type ExecSyncFn = (command: string, options: ExecSyncOptions) => Buffer | string;
type GlobSyncFn = (pattern: string) => string[];
type LogFn = (message: string) => void;
type ShouldSkipE2EFn = () => boolean;

export interface TestPhaseRunnerDeps {
	execSync: ExecSyncFn;
	globSync: GlobSyncFn;
	log: LogFn;
	shouldSkipE2E: ShouldSkipE2EFn;
}

export const MAX_WORKERS = process.env.CI === "true" ? 4 : 1;

function resolveJestPhase(phase: JestPhase): ResolvedJestPhase {
	const parts = [
		"node_modules/.bin/jest",
		`--testMatch="${phase.testMatch}"`,
		`--testTimeout=${phase.timeout}`,
		`--maxWorkers=${MAX_WORKERS}`,
	];
	if (phase.testPathIgnorePatterns) {
		parts.push(`--testPathIgnorePatterns="${phase.testPathIgnorePatterns}"`);
	}
	if (phase.passWithNoTests) {
		parts.push("--passWithNoTests");
	}
	return { type: "jest", name: phase.name, command: parts.join(" "), skip: false, e2e: phase.e2e === true };
}

function resolveNodeTestPhase(phase: NodeTestPhase, globSync: GlobSyncFn): ResolvedNodeTestPhase {
	let files: string[];
	if (phase.glob) {
		files = globSync(phase.glob);
	} else {
		files = phase.files ?? [];
	}
	const skip = files.length === 0;
	const timeoutFlag = phase.timeout ? ` --test-timeout=${phase.timeout}` : "";
	const command = skip ? "" : `node --test${timeoutFlag} ${files.join(" ")}`;
	return { type: "node-test", name: phase.name, command, env: phase.env ?? {}, files, skip, e2e: phase.e2e === true };
}

function resolveScriptPhase(phase: ScriptPhase): ResolvedScriptPhase {
	return { type: "script", name: phase.name, command: phase.command, env: phase.env ?? {}, e2e: phase.e2e === true };
}

function resolvePlaywrightPhase(phase: PlaywrightPhase): ResolvedPlaywrightPhase {
	const browsers = phase.browsers.join(" ");
	return {
		type: "playwright",
		name: phase.name,
		browserInstallCommand: `node_modules/.bin/playwright install --with-deps ${browsers}`,
		testCommand: `node_modules/.bin/playwright test --config ${phase.config}`,
		env: phase.env ?? {},
		e2e: phase.e2e === true,
	};
}

export const defaultDeps: TestPhaseRunnerDeps = {
	execSync: defaultExecSync as ExecSyncFn,
	globSync: defaultGlobSync,
	log: console.log,
	shouldSkipE2E: () => process.env.CLAUDE_CODE_REMOTE === "true",
};

export function initTestPhaseRunner(deps: TestPhaseRunnerDeps) {
	function runCommand(displayName: string, command: string, options: { cwd: string; extraEnv?: Record<string, string> }) {
		deps.log(`\n=== ${displayName} ===\n`);
		deps.execSync(command, {
			cwd: options.cwd,
			stdio: "inherit",
			env: { ...process.env, ...options.extraEnv },
		});
	}

	function runPlaywrightPhase(displayName: string, phase: ResolvedPlaywrightPhase, projectRoot: string) {
		deps.log(`\n=== ${displayName} ===\n`);

		const isCI = process.env.CI === "true";
		if (isCI) {
			deps.log("Installing browsers (output suppressed in CI; errors still shown)...");
		}
		deps.execSync(phase.browserInstallCommand, {
			cwd: projectRoot,
			stdio: isCI ? ["inherit", "ignore", "inherit"] : "inherit",
		});

		deps.execSync(phase.testCommand, {
			cwd: projectRoot,
			stdio: "inherit",
			env: { ...process.env, ...phase.env },
		});
	}

	return {
		createTestPlan(input: { config: TestRunConfig; projectRoot: string }): TestPlan {
			assert(input.config.projectName, "projectName is required");
			assert(input.config.phases.length > 0, "At least one test phase is required");

			const resolvedPhases = input.config.phases.map((phase): ResolvedPhase => {
				switch (phase.type) {
					case "jest":
						return resolveJestPhase(phase);
					case "node-test":
						return resolveNodeTestPhase(phase, deps.globSync);
					case "script":
						return resolveScriptPhase(phase);
					case "playwright":
						return resolvePlaywrightPhase(phase);
					default: {
						const _exhaustive: never = phase;
						return _exhaustive;
					}
				}
			});

			return {
				projectName: input.config.projectName,
				phases: resolvedPhases,
				async runAllPhases() {
					const skipE2E = deps.shouldSkipE2E();
					for (const phase of resolvedPhases) {
						const displayName = `${input.config.projectName} - ${phase.name}`;

						if (phase.e2e && skipE2E) {
							deps.log(`\n=== ${displayName} - skipped (CLAUDE_CODE_REMOTE) ===\n`);
							continue;
						}

						if (phase.type === "node-test" && phase.skip) {
							continue;
						}

						if (phase.type === "playwright") {
							runPlaywrightPhase(displayName, phase, input.projectRoot);
							continue;
						}

						runCommand(displayName, phase.command, {
							cwd: input.projectRoot,
							extraEnv: "env" in phase ? phase.env : undefined,
						});
					}

					deps.log(`\n=== ${input.config.projectName} - All tests completed successfully ===\n`);
				},
			};
		},
	};
}
