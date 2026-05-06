import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
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

async function startTestServer(): Promise<http.Server> {
	const { createTestApp } = await import("@packages/app/test-app");
	const { createDefaultTestAppFixture } = await import("@packages/test-fixtures");

	const origin = `http://127.0.0.1:${TEST_PORT}`;
	const { app, auth } = createTestApp(createDefaultTestAppFixture(origin));
	await auth.createUser({ email: TEST_EMAIL, password: TEST_PASSWORD });

	return new Promise((resolve) => {
		const server = app.listen(TEST_PORT, "127.0.0.1", () => {
			resolve(server);
		});
	});
}

test("should complete OAuth login flow, save links, and paginate the list", async () => {
	const server = await startTestServer();

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
		server.close();
	}
});
