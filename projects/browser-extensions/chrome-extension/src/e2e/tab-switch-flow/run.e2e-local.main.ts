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
import type { WebDriver } from "selenium-webdriver";
import {
	FlowRunner,
	ExtensionStateHandler,
	obtainAccessToken,
	type SuccessDetector,
} from "browser-extension-core/e2e";
import {
	createSeleniumElementQueries,
	createSeleniumNavigation,
	createLoginActions,
	waitForUi,
	waitForServer,
	SUITE_FAILSAFE_MS,
} from "browser-extension-core/e2e-actions";
import { initSirenReadingList } from "browser-extension-core";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";

const EXTENSION_DIR = path.resolve(__dirname, "../../../dist-extension-compiled");
const CFT_PATH_FILE = path.resolve(__dirname, "../../../.cache/chrome/binary-path");
const CFT_DRIVER_PATH_FILE = path.resolve(__dirname, "../../../.cache/chrome/driver-path");

const TEST_EMAIL = "tab-switch-e2e-test@example.com";
const TEST_PASSWORD = "testpassword123";
assert(process.env.E2E_PORT, "E2E_PORT is required");
const TEST_PORT = Number(process.env.E2E_PORT);
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

// Per-run-unique labels keep concurrent CI runs from colliding on the same
// saved row, and make the saved title an unambiguous A-vs-B discriminator:
// the /e2e/fixtures/links-page/:label fixture renders <title>Test newsletter
// {label}</title>, so the saved article's extracted title carries the marker
// of whichever page's HTML was actually captured.
const RUN_ID = randomUUID().replace(/-/g, "");
const MARKER_A = `tabswitcha${RUN_ID}`;
const MARKER_B = `tabswitchb${RUN_ID}`;
const PAGE_A = `${ORIGIN}/e2e/fixtures/links-page/${MARKER_A}`;
const PAGE_B = `${ORIGIN}/e2e/fixtures/links-page/${MARKER_B}`;

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
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		stdio: "inherit",
		detached: true,
	});
	child.on("error", () => {}); // waitForServer will throw on its own timeout
	await waitForServer(`http://127.0.0.1:${TEST_PORT}/`);
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

async function logIn(driver: WebDriver, popupUrl: string): Promise<string> {
	const elementQueries = createSeleniumElementQueries();

	await driver.get(popupUrl);
	await waitForUi(
		driver,
		() => elementQueries.findVisibleViewById(driver, "login-view"),
	);

	const popupWindowHandle = await driver.getWindowHandle();
	const loginActions = createLoginActions({
		testEmail: TEST_EMAIL,
		testPassword: TEST_PASSWORD,
		popupWindowHandle,
	});

	// Login completes when the popup returns to a logged-in view. The OAuth dance
	// passes through the server's own /login and /oauth/authorize pages (where the
	// extension views don't exist), so keying on a popup-only view avoids a false
	// "complete" mid-flow.
	const isLoggedIntoPopup: SuccessDetector<WebDriver> = async (d) =>
		(await elementQueries.findVisibleViewById(d, "list-view")) ||
		(await elementQueries.findVisibleViewById(d, "saved-view"));

	const stateHandler = new ExtensionStateHandler(
		driver,
		isLoggedIntoPopup,
		loginActions,
		elementQueries,
	);
	const flowRunner = new FlowRunner(
		driver,
		stateHandler,
		createSeleniumNavigation(),
	);
	const result = await flowRunner.run(popupUrl, { maxSteps: 25 });
	assert.equal(result.success, true, `Login flow failed: ${result.error}`);
	await driver.switchTo().window(popupWindowHandle);
	return popupWindowHandle;
}

/**
 * Opens `url` in a fresh tab and returns its window handle. The content script
 * (manifest content_scripts, <all_urls>, document_start) is injected on load,
 * so the page can answer `capture-html` once `driver.get` resolves.
 */
async function openPageInNewTab(driver: WebDriver, url: string): Promise<string> {
	await driver.switchTo().newWindow("tab");
	await driver.get(url);
	return driver.getWindowHandle();
}

/**
 * Resolves the extension's tab id for an already-open page, by querying from an
 * extension page context (the popup) where `chrome.tabs` is available. Selenium
 * has no notion of extension tab ids — only window handles — so the popup is the
 * bridge that maps a url back to the id the background needs.
 */
async function resolveTabId(driver: WebDriver, url: string): Promise<number> {
	const raw = await driver.executeAsyncScript(
		"const url = arguments[0]; const done = arguments[arguments.length - 1];" +
			"chrome.tabs.query({}, (tabs) => { const t = tabs.find((x) => x.url === url); done(t ? t.id : -1); });",
		url,
	);
	const tabId = Number(raw);
	assert.ok(
		Number.isInteger(tabId) && tabId >= 0,
		`Could not resolve extension tab id for ${url} (got ${String(raw)})`,
	);
	return tabId;
}

/**
 * Drives the real `save-current-tab` path with an explicit tabId — the same
 * message the popup sends from its active-tab branch — by dispatching it from
 * the popup's extension context. The browser-action popup can't be opened with
 * a web page active under Selenium, and a save triggered via `?url=` query
 * params deliberately carries no tabId, so neither existing harness path
 * exercises the tabId capture this regression guards.
 */
async function injectSaveCurrentTab(
	driver: WebDriver,
	params: { url: string; title: string; tabId: number },
): Promise<void> {
	await driver.executeScript(
		"const [url, title, tabId] = arguments;" +
			"chrome.runtime.sendMessage({ type: 'save-current-tab', url, title, tabId });",
		params.url,
		params.title,
		params.tabId,
	);
}

/**
 * Polls the saved queue (via an independent Siren walk, as pdf-save-scenario
 * does) for the item saved under PAGE_A's url and asserts its extracted title
 * carries A's marker and never B's. The title is derived server-side from the
 * captured HTML, so it is the observable proof of *which page's* content was
 * POSTed — the whole point of the fix.
 */
async function assertSavedContentIsPageA(): Promise<void> {
	const accessToken = await obtainAccessToken({
		serverUrl: ORIGIN,
		email: TEST_EMAIL,
		password: TEST_PASSWORD,
	});
	const { getAllItems } = initSirenReadingList({
		serverUrl: ORIGIN,
		getAccessToken: async () => accessToken,
		fetchFn: (...args) => fetch(...args),
		refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
		onUnauthorized: async () => {
			throw new Error("Unauthorized while walking the saved queue");
		},
		logger: HutchLogger.from(consoleLogger),
	});

	const deadline = Date.now() + 60_000;
	let lastTitle = "<no item yet>";
	while (Date.now() < deadline) {
		const items = await getAllItems();
		const saved = items.find((item) => item.url.includes(MARKER_A));
		if (saved) {
			lastTitle = saved.title;
			assert.ok(
				!saved.title.includes(MARKER_B),
				`Saved item for page A carried page B's content — title: "${saved.title}"`,
			);
			if (saved.title.includes(MARKER_A)) return;
		}
		await new Promise((r) => setTimeout(r, 1_000));
	}

	throw new Error(
		`Timed out after 60s waiting for page A's saved title to contain "${MARKER_A}". ` +
			`Last observed title: "${lastTitle}"`,
	);
}

const MAX_ATTEMPTS = 3;
test("save targets the invoking tab even after the active tab switches", async () => {
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

	const driver = (await new Builder()
		.forBrowser("chrome")
		.setChromeOptions(options)
		.setChromeService(serviceBuilder)
		.build()) as ChromeDriver;

	try {
		const extensionId = await discoverExtensionId(driver);
		const popupUrl = `chrome-extension://${extensionId}/popup/popup.template.html`;

		const popupWindowHandle = await logIn(driver, popupUrl);

		// Open both pages; B is opened last so it is the foreground tab, but the
		// save is invoked against A — exactly the situation the fix targets.
		await openPageInNewTab(driver, PAGE_A);
		const handleB = await openPageInNewTab(driver, PAGE_B);

		await driver.switchTo().window(popupWindowHandle);
		const tabIdA = await resolveTabId(driver, PAGE_A);
		await injectSaveCurrentTab(driver, {
			url: PAGE_A,
			title: "pending-tab-switch-capture",
			tabId: tabIdA,
		});

		// The user moves on: make B the active tab before the background's capture
		// resolves. The fix keys capture to tabIdA, so this must not change what is
		// saved; before the fix, capture followed the active tab and would grab B.
		await driver.switchTo().window(handleB);

		await assertSavedContentIsPageA();
	} finally {
		await driver.quit();
	}
}
