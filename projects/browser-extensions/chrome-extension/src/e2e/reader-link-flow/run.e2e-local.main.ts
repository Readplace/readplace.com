import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Builder, By } from "selenium-webdriver";
import { Options, ServiceBuilder, type Driver as ChromeDriver } from "selenium-webdriver/chrome";
import { FlowRunner, ExtensionStateHandler } from "browser-extension-core/e2e";
import {
	waitForServer,
	SUITE_FAILSAFE_MS,
	createSeleniumElementQueries,
	createSeleniumNavigation,
	createLoginActions,
	createSaveLinkActions,
	assertReaderLinkOpensPrivateReader,
	type SaveLinkProgress,
	waitForUi,
} from "browser-extension-core/e2e-actions";

const EXTENSION_DIR = path.resolve(__dirname, "../../../dist-extension-compiled");
const CFT_PATH_FILE = path.resolve(__dirname, "../../../.cache/chrome/binary-path");
const CFT_DRIVER_PATH_FILE = path.resolve(__dirname, "../../../.cache/chrome/driver-path");

const TEST_EMAIL = "reader-link-e2e-test@example.com";
const TEST_PASSWORD = "testpassword123";
assert(process.env.E2E_PORT, "E2E_PORT is required");
const TEST_PORT = Number(process.env.E2E_PORT);
const SERVER_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

const TEST_LINK_URL = "https://example.com/reader-link-article";
const TEST_LINK_TITLE = "Reader Link Article";

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
	// Spawn via the standard Nx interface so the extension never reaches across
	// the workspace for hutch's compiled output path. `pnpm nx run hutch:e2e-server`
	// resolves the project, runs its dependsOn (install-deps + compile if stale),
	// and execs the e2e-server script.
	//
	// NX_DAEMON=false: the daemon forks targets as its own children, outside the
	// pnpm/nx process group, so a process-group kill in stopTestServer would leave
	// the e2e-server orphaned and hang test-phase-runner forever waiting for it.
	// detached:true puts pnpm/nx/node into their own process group for clean kill.
	const child = spawn("pnpm", ["nx", "run", "hutch:e2e-server"], {
		env: {
			...process.env,
			E2E_PORT: String(TEST_PORT),
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		// fd 1 carries node --test's serialized reporter protocol back to the runner;
		// a grandchild writing raw bytes there corrupts the stream ("Unable to
		// deserialize cloned data"). Route the server's output to fd 2, which the
		// runner treats as plain diagnostics, so its logs stay visible safely.
		stdio: ["ignore", 2, 2],
		detached: true,
	});
	child.on("error", () => {}); // waitForServer will throw on its own timeout

	await waitForServer(`http://127.0.0.1:${TEST_PORT}/`);

	const userRes = await fetch(`${SERVER_ORIGIN}/e2e/users`, {
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
			// Negative pid signals the entire process group, so the descendants
			// (nx → node e2e-server) exit alongside the pnpm wrapper.
			process.kill(-pid, signal);
		} catch {
			child.kill(signal);
		}
	};
	await new Promise<void>((resolve) => {
		const cleanExit = () => resolve();
		child.once("exit", cleanExit);
		killGroup("SIGTERM");
		// Belt-and-suspenders: if anything in the chain (nx, pnpm, the script)
		// blocks SIGTERM, force-kill after 5s and resolve so the test runner can
		// exit instead of hanging the whole test-phase-runner pipeline.
		setTimeout(() => {
			killGroup("SIGKILL");
			child.off("exit", cleanExit);
			resolve();
		}, 5_000).unref();
	});
}

async function discoverExtensionId(driver: ChromeDriver): Promise<string> {
	// Service worker may take time to register in headless mode
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

// CI resource contention (parallel NX tasks) crashes Chrome or causes Selenium
// element-location timeouts intermittently. Retry the full test for both cases.
const MAX_ATTEMPTS = 3;
test("saved-article link in the popup opens the private reader, not the public view", async () => {
	const server = await startTestServer();
	armSuiteFailsafe(server);
	try {
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				await runTest();
				return;
			} catch (err) {
				const isRetryable = err instanceof Error && (
					err.message.includes("ECONNREFUSED") ||
					err.message.includes("Chrome instance exited") ||
					err.name === "TimeoutError"
				);
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

	// Chrome 137+ removed --load-extension in branded Google Chrome.
	// Use Chrome for Testing which still supports it.
	options.setChromeBinaryPath(
		fs.readFileSync(CFT_PATH_FILE, "utf8").trim(),
	);

	const serviceBuilder = new ServiceBuilder(
		fs.readFileSync(CFT_DRIVER_PATH_FILE, "utf8").trim(),
	);

	const driver = (await new Builder()
		.forBrowser("chrome")
		.setChromeOptions(options)
		.setChromeService(serviceBuilder)
		.build()) as ChromeDriver;

	try {
		const extensionId = await discoverExtensionId(driver);
		const POPUP_URL = `chrome-extension://${extensionId}/popup/popup.template.html`;

		await driver.get(POPUP_URL);

		await waitForUi(driver, async () => {
			try {
				const el = await driver.findElement(By.id("login-view"));
				const hidden = await el.getAttribute("hidden");
				return hidden === null;
			} catch {
				return false;
			}
		});

		const popupWindowHandle = await driver.getWindowHandle();

		const saveLinkProgress: SaveLinkProgress = { linkSaved: false, listVerified: false, extraLinkSaved: false };

		const loginActions = createLoginActions({
			testEmail: TEST_EMAIL,
			testPassword: TEST_PASSWORD,
			popupWindowHandle,
		});

		const saveLinkActions = createSaveLinkActions({
			capturesBeforeSaving: true,
			popupUrl: POPUP_URL,
			testUrl: TEST_LINK_URL,
			testTitle: TEST_LINK_TITLE,
			popupWindowHandle,
			progress: saveLinkProgress,
		});

		const allActions = new Map([...loginActions, ...saveLinkActions]);

		// Stop once a saved article with a reader link is in the list — that is the
		// precondition the reader-link assertion needs, and the list-load that gets
		// us there has already fired the fire-and-forget session-cookie mint.
		const stateHandler = new ExtensionStateHandler(
			driver,
			async () => saveLinkProgress.listVerified,
			allActions,
			createSeleniumElementQueries(),
		);

		const flowRunner = new FlowRunner(
			driver,
			stateHandler,
			createSeleniumNavigation(),
		);
		const result = await flowRunner.run(POPUP_URL, {
			maxSteps: 35,
		});

		assert.equal(result.success, true, `Login+save flow failed: ${result.error}`);
		assert.equal(saveLinkProgress.listVerified, true, "a saved link with a reader URL must be present in the list");

		await driver.switchTo().window(popupWindowHandle);
		await assertReaderLinkOpensPrivateReader(driver, { serverOrigin: SERVER_ORIGIN });
	} finally {
		await driver.quit();
	}
}
