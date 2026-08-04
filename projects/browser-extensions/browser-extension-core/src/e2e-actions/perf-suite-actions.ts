import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import type { WebDriver } from "selenium-webdriver";
import {
	FlowRunner,
	ExtensionStateHandler,
	type SuccessDetector,
} from "../e2e";
import { MAX_MEASURE_ATTEMPTS, measureUntilVerdict } from "../perf/budget-verdict";
import { createLoginActions } from "./login-actions";
import {
	createSeleniumElementQueries,
	createSeleniumNavigation,
} from "./selenium-adapter";
import { waitForUi, waitForServer } from "./wait-budget";

export type PerfTestUser = { email: string; password: string };

/** Hard deadline for a suite that stopped making progress. A test cancelled by
 * `--test-timeout` skips its teardown, and the orphaned server child then holds
 * the process open forever; this kills the whole process group and exits. */
function armSuiteFailsafe(input: {
	server: ChildProcess;
	failsafeMs: number;
}): void {
	const reapServerGroup = () => {
		if (input.server.pid === undefined || input.server.exitCode !== null) return;
		try {
			process.kill(-input.server.pid, "SIGKILL");
		} catch {
			input.server.kill("SIGKILL");
		}
	};
	process.on("exit", reapServerGroup);
	setTimeout(() => {
		console.error(
			`suite failsafe: still running after ${input.failsafeMs}ms, force-exiting`,
		);
		reapServerGroup();
		process.exit(1);
	}, input.failsafeMs).unref();
}

/** `hutch:perf-server` accepts a save the way production does — state reads and
 * a published event — where `hutch:e2e-server` crawls and parses the article
 * inside the request, which would make a perf suite a measurement of the
 * crawler. The ready URL is built by the caller, which owns the probe nonce. */
async function startPerfServer(input: {
	port: number;
	readyUrl: string;
	serverEnv: Record<string, string>;
	user: PerfTestUser;
}): Promise<ChildProcess> {
	const child = spawn("pnpm", ["nx", "run", "hutch:perf-server"], {
		env: {
			...process.env,
			...input.serverEnv,
			E2E_PORT: String(input.port),
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		stdio: ["ignore", 2, 2],
		detached: true,
	});
	child.on("error", () => {});
	await waitForServer(input.readyUrl);
	const userRes = await fetch(`http://127.0.0.1:${input.port}/e2e/users`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input.user),
	});
	assert.equal(
		userRes.status,
		201,
		`POST /e2e/users returned ${userRes.status} (expected 201)`,
	);
	return child;
}

async function stopPerfServer(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.pid === undefined) return;
	const pid = child.pid;
	const killGroup = (signal: NodeJS.Signals) => {
		try {
			process.kill(-pid, signal);
		} catch {
			child.kill(signal);
		}
	};
	await new Promise<void>((resolve) => {
		const cleanExit = () => resolve();
		child.once("exit", cleanExit);
		killGroup("SIGTERM");
		setTimeout(() => {
			killGroup("SIGKILL");
			child.off("exit", cleanExit);
			resolve();
		}, 5_000).unref();
	});
}

export async function runPerfSuite(input: {
	server: {
		port: number;
		readyUrl: string;
		serverEnv: Record<string, string>;
		user: PerfTestUser;
	};
	failsafeMs: number;
	diagnostic: (message: string) => void;
	measure: () => Promise<void>;
}): Promise<void> {
	const server = await startPerfServer(input.server);
	armSuiteFailsafe({ server, failsafeMs: input.failsafeMs });
	try {
		await measureUntilVerdict({
			maxAttempts: MAX_MEASURE_ATTEMPTS,
			diagnostic: input.diagnostic,
			measure: input.measure,
		});
	} finally {
		await stopPerfServer(server);
	}
}

/** An unpacked extension's id is assigned at load time, so it can only be read
 * back from the running browser. `sendAndGetDevToolsCommand` is absent from the
 * published Chrome driver types, which is what confines the assertion here. */
export async function discoverChromeExtensionId(
	driver: WebDriver,
): Promise<string> {
	const extensionId = await waitForUi(
		driver,
		async () => {
			const targets = (await (driver as unknown as {
				sendAndGetDevToolsCommand(
					cmd: string,
					params: Record<string, unknown>,
				): Promise<unknown>;
			}).sendAndGetDevToolsCommand("Target.getTargets", {})) as {
				targetInfos: Array<{ type: string; url: string }>;
			};

			const swTarget = targets.targetInfos.find(
				(t) =>
					t.type === "service_worker" && t.url.startsWith("chrome-extension://"),
			);
			if (!swTarget) return null;

			const match = swTarget.url.match(/chrome-extension:\/\/([a-z]+)\//);
			assert.ok(match, "Could not extract extension ID from service worker URL");
			return match[1];
		},
		"Could not find extension service worker target",
	);
	assert.ok(
		extensionId,
		"extension service worker discovery resolved without an id",
	);
	return extensionId;
}

/** Drives the popup's own login flow and leaves the driver back on the popup. */
export async function logInToPopup(input: {
	driver: WebDriver;
	popupUrl: string;
	user: PerfTestUser;
}): Promise<string> {
	const elementQueries = createSeleniumElementQueries();

	await input.driver.get(input.popupUrl);
	await waitForUi(input.driver, () =>
		elementQueries.findVisibleViewById(input.driver, "login-view"),
	);

	const popupWindowHandle = await input.driver.getWindowHandle();
	const loginActions = createLoginActions({
		testEmail: input.user.email,
		testPassword: input.user.password,
		popupWindowHandle,
	});

	const isLoggedIntoPopup: SuccessDetector<WebDriver> = async (d) =>
		(await elementQueries.findVisibleViewById(d, "list-view")) ||
		(await elementQueries.findVisibleViewById(d, "saved-view"));

	const stateHandler = new ExtensionStateHandler(
		input.driver,
		isLoggedIntoPopup,
		loginActions,
		elementQueries,
	);
	const flowRunner = new FlowRunner(
		input.driver,
		stateHandler,
		createSeleniumNavigation(),
	);
	const result = await flowRunner.run(input.popupUrl, { maxSteps: 25 });
	assert.equal(result.success, true, `Login flow failed: ${result.error}`);
	await input.driver.switchTo().window(popupWindowHandle);
	return popupWindowHandle;
}
