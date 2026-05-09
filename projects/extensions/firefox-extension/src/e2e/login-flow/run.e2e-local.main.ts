import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { Builder, By } from "selenium-webdriver";
import { Options } from "selenium-webdriver/firefox";
import { FlowRunner, ExtensionStateHandler } from "browser-extension-core/e2e";
import {
	createSeleniumElementQueries,
	createSeleniumNavigation,
	createLoginActions,
	createSaveLinkActions,
	createPaginationActions,
	createFilterActions,
	createLogoutActions,
	type PaginationProgress,
	type SaveLinkProgress,
	type FilterProgress,
	type LogoutProgress,
} from "browser-extension-core/e2e-actions";

const ADDON_ID = "hutch-extension@hutch-app.com";
const ADDON_UUID = "d3b07384-d113-4ec6-a7b8-5f7e3b4c9a12";
const EXTENSION_DIR = path.resolve(__dirname, "../../../dist-extension-compiled");
const POPUP_URL = `moz-extension://${ADDON_UUID}/popup/popup.template.html`;

const TEST_EMAIL = "e2e-test@example.com";
const TEST_PASSWORD = "testpassword123";
assert(process.env.E2E_PORT, "E2E_PORT is required");
const TEST_PORT = Number(process.env.E2E_PORT);

const TEST_LINK_URL = "https://example.com/test-article";
const TEST_LINK_TITLE = "Test Article";

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw new Error(`e2e server did not start on port ${port} within ${timeoutMs}ms`);
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
		stdio: "inherit",
		detached: true,
	});
	child.on("error", () => {}); // waitForServer will throw on its own timeout

	// 30s — covers `pnpm nx` startup + cache check + node bootstrap.
	await waitForServer(TEST_PORT, 30_000);

	const userRes = await fetch(`http://127.0.0.1:${TEST_PORT}/e2e/users`, {
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

test("should complete OAuth login flow, save links, and paginate the list", async () => {
	const server = await startTestServer();
	try {
		const options = new Options();
		if (process.env.HEADLESS !== "false") {
			options.addArguments("--headless");
		}
		options.setPreference(
			"extensions.webextensions.uuids",
			JSON.stringify({ [ADDON_ID]: ADDON_UUID }),
		);

		const driver = await new Builder()
			.forBrowser("firefox")
			.setFirefoxOptions(options)
			.build();

		try {
			await (
				driver as unknown as {
					installAddon: (
						path: string,
						temporary: boolean,
					) => Promise<void>;
				}
			).installAddon(EXTENSION_DIR, true);

			await driver.get(POPUP_URL);

			await driver.wait(async () => {
				try {
					const el = await driver.findElement(By.id("login-view"));
					const hidden = await el.getAttribute("hidden");
					return hidden === null;
				} catch {
					return false;
				}
			}, 10000);

			const popupWindowHandle = await driver.getWindowHandle();

			const saveLinkProgress: SaveLinkProgress = { linkSaved: false, listVerified: false, extraLinkSaved: false };
			const paginationProgress: PaginationProgress = {
				paginationLinksAdded: false,
				verifiedPage1: false,
				navigatedToPage2: false,
				verifiedPage2: false,
				navigatedBackToPage1: false,
				verifiedBackOnPage1: false,
			};
			const filterProgress: FilterProgress = {
				filteredWithMatch: false,
				filteredNoMatch: false,
				filterCleared: false,
			};
			const logoutProgress: LogoutProgress = {
				loggedOut: false,
			};

			const loginActions = createLoginActions({
				testEmail: TEST_EMAIL,
				testPassword: TEST_PASSWORD,
				popupWindowHandle,
			});

			const saveLinkActions = createSaveLinkActions({
				popupUrl: POPUP_URL,
				testUrl: TEST_LINK_URL,
				testTitle: TEST_LINK_TITLE,
				popupWindowHandle,
				progress: saveLinkProgress,
			});

			const paginationActions = createPaginationActions({
				popupUrl: POPUP_URL,
				saveLinkProgress,
				progress: paginationProgress,
			});

			const filterActions = createFilterActions({
				paginationVerified: paginationProgress,
				progress: filterProgress,
			});

			const logoutActions = createLogoutActions({
				filterProgress,
				progress: logoutProgress,
			});

			const allActions = new Map([...loginActions, ...saveLinkActions, ...paginationActions, ...filterActions, ...logoutActions]);

			const stateHandler = new ExtensionStateHandler(
				driver,
				async () => logoutProgress.loggedOut,
				allActions,
				createSeleniumElementQueries(),
			);

			const flowRunner = new FlowRunner(
				driver,
				stateHandler,
				createSeleniumNavigation(),
			);
			const result = await flowRunner.run(POPUP_URL, {
				maxSteps: 55,
			});

			assert.equal(result.success, true, `Flow failed: ${result.error}`);
			assert.equal(saveLinkProgress.linkSaved, true, "Link should have been saved");
			assert.equal(saveLinkProgress.listVerified, true, "Link should have been verified in list");
			assert.equal(paginationProgress.verifiedBackOnPage1, true, "Pagination should have been verified");
			assert.equal(filterProgress.filterCleared, true, "Filter should have been tested");
			assert.equal(logoutProgress.loggedOut, true, "Logout should have been completed");
		} finally {
			await driver.quit();
		}
	} finally {
		await stopTestServer(server);
	}
});
