import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Builder } from "selenium-webdriver";
import {
	Options,
	ServiceBuilder,
	type Driver as ChromeDriver,
} from "selenium-webdriver/chrome";
import {
	runCaptureScenarios,
	waitForUi,
	waitForServer,
	SUITE_FAILSAFE_MS,
} from "browser-extension-core/e2e-actions";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";
import { getFreePort } from "@packages/test-phase-runner";

const EXTENSION_DIR = path.resolve(__dirname, "../../../dist-extension-compiled");
const CFT_PATH_FILE = path.resolve(__dirname, "../../../.cache/chrome/binary-path");
const CFT_DRIVER_PATH_FILE = path.resolve(__dirname, "../../../.cache/chrome/driver-path");

const TEST_EMAIL = "tab-switch-e2e-test@example.com";
const TEST_PASSWORD = "testpassword123";
assert(process.env.E2E_PORT, "E2E_PORT is required");
const TEST_PORT = Number(process.env.E2E_PORT);
const READY_NONCE = randomUUID();
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

const RUN_ID = randomUUID().replace(/-/g, "");

// The suite must always end: a test cancelled by --test-timeout skips its
// teardown, and the orphaned e2e-server child then holds this process open
// forever (observed hanging a 20x soak for 12+ minutes against a 90s test
// timeout). Reap the server group on any exit, and hard-exit past the
// failsafe deadline. unref() keeps the timer itself from holding the loop.
function armSuiteFailsafe(server: ChildProcess): void {
	const reapServerGroup = () => {
		if (server.pid === undefined || server.exitCode !== null) return;
		try {
			process.kill(-server.pid, "SIGKILL");
		} catch {
			server.kill("SIGKILL");
		}
	};
	process.on("exit", reapServerGroup);
	setTimeout(() => {
		console.error(`suite failsafe: still running after ${SUITE_FAILSAFE_MS}ms, force-exiting`);
		reapServerGroup();
		process.exit(1);
	}, SUITE_FAILSAFE_MS).unref();
}

async function startTestServer(): Promise<ChildProcess> {
	// NX_DAEMON=false and detached:true so the server runs in its own process
	// group and teardown can kill the whole group instead of orphaning it.
	const child = spawn("pnpm", ["nx", "run", "hutch:e2e-server"], {
		env: {
			...process.env,
			E2E_PORT: String(TEST_PORT),
			[READY_NONCE_ENV]: READY_NONCE,
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		stdio: "inherit",
		detached: true,
	});
	child.on("error", () => {}); // waitForServer will throw on its own timeout
	await waitForServer(`http://127.0.0.1:${TEST_PORT}${readyProbePath(READY_NONCE)}`);
	const userRes = await fetch(`${ORIGIN}/e2e/users`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
	});
	assert.equal(
		userRes.status,
		201,
		`POST /e2e/users returned ${userRes.status} (expected 201)`,
	);
	return child;
}

async function stopTestServer(child: ChildProcess): Promise<void> {
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

async function discoverExtensionId(driver: ChromeDriver): Promise<string> {
	const extensionId = await waitForUi(
		driver,
		async () => {
			const targets = (await (driver as unknown as {
				sendAndGetDevToolsCommand(cmd: string, params: Record<string, unknown>): Promise<unknown>;
			}).sendAndGetDevToolsCommand(
				"Target.getTargets",
				{},
			)) as { targetInfos: Array<{ type: string; url: string }> };

			const swTarget = targets.targetInfos.find(
				(t) =>
					t.type === "service_worker" &&
					t.url.startsWith("chrome-extension://"),
			);
			if (!swTarget) return null;

			const match = swTarget.url.match(/chrome-extension:\/\/([a-z]+)\//);
			assert.ok(match, "Could not extract extension ID from service worker URL");
			return match[1];
		},
		"Could not find extension service worker target",
	);
	assert.ok(extensionId, "extension service worker discovery resolved without an id");
	return extensionId;
}

const MAX_ATTEMPTS = 3;
test("saves the invoking tab, image and PDF tabs, then signs out when the refresh token is forgotten", async () => {
	const server = await startTestServer();
	armSuiteFailsafe(server);
	try {
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				await runTest();
				return;
			} catch (err) {
				const isRetryable =
					err instanceof Error &&
					(err.message.includes("ECONNREFUSED") ||
						err.message.includes("Chrome instance exited") ||
						err.name === "TimeoutError");
				if (!isRetryable || attempt === MAX_ATTEMPTS) throw err;
			}
		}
	} finally {
		await stopTestServer(server);
	}
});

async function runTest() {
	const options = new Options();
	if (process.env.HEADLESS !== "false") {
		options.addArguments("--headless=new");
	}
	options.addArguments(`--load-extension=${EXTENSION_DIR}`);
	options.addArguments("--disable-search-engine-choice-screen");
	options.addArguments("--no-sandbox"); // CI container has no user namespace; without this Chrome exits immediately
	options.addArguments("--disable-dev-shm-usage"); // CI runners have a small /dev/shm partition; without this Chrome crashes with ECONNREFUSED
	options.addArguments("--disable-gpu"); // CI runners have no GPU drivers; the GPU process crashes intermittently in headless mode

	options.setChromeBinaryPath(fs.readFileSync(CFT_PATH_FILE, "utf8").trim());
	const serviceBuilder = new ServiceBuilder(
		fs.readFileSync(CFT_DRIVER_PATH_FILE, "utf8").trim(),
	);
	serviceBuilder.setPort(await getFreePort());

	const driver = (await new Builder()
		.forBrowser("chrome")
		.setChromeOptions(options)
		.setChromeService(serviceBuilder)
		.build()) as ChromeDriver;

	try {
		const extensionId = await discoverExtensionId(driver);
		const popupUrl = `chrome-extension://${extensionId}/popup/popup.template.html`;

		await runCaptureScenarios({
			driver,
			namespace: "chrome",
			popupUrl,
			serverOrigin: ORIGIN,
			testEmail: TEST_EMAIL,
			testPassword: TEST_PASSWORD,
			runId: RUN_ID,
		});
	} finally {
		await driver.quit();
	}
}
