import assert from "node:assert";
import { execSync as defaultExecSync } from "node:child_process";
import type { ExecSyncOptions } from "node:child_process";
import { globSync as defaultGlobSync } from "node:fs";

function getEnv(name: string): string | undefined {
	return process.env[name];
}

function parentEnv(): NodeJS.ProcessEnv {
	return process.env;
}

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
type ShouldInstallBrowserSystemDepsFn = () => boolean;
type SleepFn = (ms: number) => void;

export interface TestPhaseRunnerDeps {
	execSync: ExecSyncFn;
	globSync: GlobSyncFn;
	log: LogFn;
	shouldSkipE2E: ShouldSkipE2EFn;
	shouldInstallBrowserSystemDeps: ShouldInstallBrowserSystemDepsFn;
	sleep: SleepFn;
}

function resolveJestPhase(phase: JestPhase): ResolvedJestPhase {
	const parts = [
		"node_modules/.bin/jest",
		`--testMatch="${phase.testMatch}"`,
		`--testTimeout=${phase.timeout}`,
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

function resolvePlaywrightPhase(
	phase: PlaywrightPhase,
	installBrowserSystemDeps: boolean,
): ResolvedPlaywrightPhase {
	const browsers = phase.browsers.join(" ");
	const withDeps = installBrowserSystemDeps ? " --with-deps" : "";
	return {
		type: "playwright",
		name: phase.name,
		browserInstallCommand: `node_modules/.bin/playwright install${withDeps} ${browsers}`,
		testCommand: `node_modules/.bin/playwright test --config ${phase.config}`,
		env: phase.env ?? {},
		e2e: phase.e2e === true,
	};
}

// `playwright install --with-deps` shells out to apt-get, whose dpkg frontend
// lock is held for the entire duration of any other apt process on the runner
// (the image's unattended-upgrades, or a sibling project installing its own
// browsers under a parallel nx target). An immediate retry just races the same
// still-held lock, so wait between attempts to let it clear. Four attempts with
// a 10s wait absorbs ~30s of contention — long enough to outlast a sibling
// browser install, short enough to still fail loudly on a genuinely stuck apt.
export const BROWSER_INSTALL_MAX_ATTEMPTS = 4;
export const BROWSER_INSTALL_RETRY_DELAY_MS = 10_000;

export const defaultDeps: TestPhaseRunnerDeps = {
	execSync: defaultExecSync as ExecSyncFn,
	globSync: defaultGlobSync,
	log: console.log,
	shouldSkipE2E: () => getEnv("CLAUDE_CODE_REMOTE") === "true",
	shouldInstallBrowserSystemDeps: () => getEnv("RUNNER_ENVIRONMENT") === "github-hosted",
	sleep: (ms: number) => {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	},
};

export function initTestPhaseRunner(deps: TestPhaseRunnerDeps) {
	function runCommand(displayName: string, command: string, options: { cwd: string; extraEnv?: Record<string, string> }) {
		deps.log(`\n=== ${displayName} ===\n`);
		deps.execSync(command, {
			cwd: options.cwd,
			stdio: "inherit",
			env: { ...parentEnv(), ...options.extraEnv },
		});
	}

	function runCommandPhase(
		displayName: string,
		command: string,
		options: { cwd: string; extraEnv?: Record<string, string>; e2e: boolean },
	) {
		try {
			runCommand(displayName, command, options);
		} catch (error) {
			// Browser-extension E2E phases drive selenium/geckodriver, which
			// intermittently fails on transient navigation stalls. One clean retry
			// extends the `retries: 1` policy the Playwright phases already have to
			// these node-test phases, which otherwise have no flakiness cushion.
			if (!options.e2e) throw error;
			deps.log(`\n=== ${displayName} - retrying once after failure (e2e) ===\n`);
			runCommand(displayName, command, options);
		}
	}

	function installBrowsers(
		displayName: string,
		phase: ResolvedPlaywrightPhase,
		options: { cwd: string; stdio: ExecSyncOptions["stdio"] },
		attempt = 1,
	): void {
		try {
			deps.execSync(phase.browserInstallCommand, { cwd: options.cwd, stdio: options.stdio });
		} catch (error) {
			if (attempt >= BROWSER_INSTALL_MAX_ATTEMPTS) throw error;
			deps.log(
				`\n=== ${displayName} - browser install failed (attempt ${attempt}/${BROWSER_INSTALL_MAX_ATTEMPTS}), retrying after ${BROWSER_INSTALL_RETRY_DELAY_MS}ms ===\n`,
			);
			deps.sleep(BROWSER_INSTALL_RETRY_DELAY_MS);
			installBrowsers(displayName, phase, options, attempt + 1);
		}
	}

	function runPlaywrightPhase(displayName: string, phase: ResolvedPlaywrightPhase, projectRoot: string) {
		deps.log(`\n=== ${displayName} ===\n`);

		const isCI = getEnv("CI") === "true";
		if (isCI) {
			deps.log("Installing browsers (output suppressed in CI; errors still shown)...");
		}
		const installStdio: ExecSyncOptions["stdio"] = isCI ? ["inherit", "ignore", "inherit"] : "inherit";
		installBrowsers(displayName, phase, { cwd: projectRoot, stdio: installStdio });

		deps.execSync(phase.testCommand, {
			cwd: projectRoot,
			stdio: "inherit",
			env: { ...parentEnv(), ...phase.env },
		});
	}

	return {
		createTestPlan(input: { config: TestRunConfig; projectRoot: string }): TestPlan {
			assert(input.config.projectName, "projectName is required");
			assert(input.config.phases.length > 0, "At least one test phase is required");

			const resolvedPhases = input.config.phases.map((phase): ResolvedPhase => {
				if (phase.type === "jest") return resolveJestPhase(phase);
				if (phase.type === "node-test") return resolveNodeTestPhase(phase, deps.globSync);
				if (phase.type === "script") return resolveScriptPhase(phase);
				return resolvePlaywrightPhase(phase, deps.shouldInstallBrowserSystemDeps());
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

						runCommandPhase(displayName, phase.command, {
							cwd: input.projectRoot,
							extraEnv: "env" in phase ? phase.env : undefined,
							e2e: phase.e2e,
						});
					}

					deps.log(`\n=== ${input.config.projectName} - All tests completed successfully ===\n`);
				},
			};
		},
	};
}
