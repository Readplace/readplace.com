import assert from "node:assert/strict";
import { By } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { Logger, consoleLogger } from "@packages/logger";
import { z } from "zod";
import { ExtensionStateHandler, FlowRunner, obtainAccessToken, type SuccessDetector } from "../e2e";
import { initSirenReadingList } from "../reading-list/siren-reading-list";
import { createLoginActions } from "./login-actions";
import { createSeleniumElementQueries, createSeleniumNavigation } from "./selenium-adapter";
import { waitForUi } from "./wait-budget";

type ExtensionNamespace = "chrome" | "browser";

interface CaptureScenariosConfig {
	driver: WebDriver;
	namespace: ExtensionNamespace;
	popupUrl: string;
	serverOrigin: string;
	testEmail: string;
	testPassword: string;
	runId: string;
}

const SavedReplySchema = z.object({ ok: z.literal(true), value: z.object({ ok: z.literal(true) }) });

type ReceivedSaveContent = { url?: string; mediaType?: string; contentBytes?: number; contentBase64?: string; status: number };

async function isViewVisible(driver: WebDriver, id: string): Promise<boolean> {
	try {
		const view = await driver.findElement(By.id(id));
		return (await view.getAttribute("hidden")) === null;
	} catch {
		return false;
	}
}

async function waitForView(driver: WebDriver, id: string, message: string): Promise<void> {
	await waitForUi(driver, () => isViewVisible(driver, id), message);
}

async function logIn(config: CaptureScenariosConfig): Promise<string> {
	const { driver, popupUrl } = config;
	const elementQueries = createSeleniumElementQueries();

	await driver.get(popupUrl);
	await waitForView(driver, "login-view", "the popup never showed the login view before signing in");

	const popupWindowHandle = await driver.getWindowHandle();
	const loginActions = createLoginActions({
		testEmail: config.testEmail,
		testPassword: config.testPassword,
		popupWindowHandle,
	});

	const isLoggedIntoPopup: SuccessDetector<WebDriver> = async (d) =>
		(await elementQueries.findVisibleViewById(d, "list-view")) ||
		(await elementQueries.findVisibleViewById(d, "saved-view"));

	const stateHandler = new ExtensionStateHandler(driver, isLoggedIntoPopup, loginActions, elementQueries);
	const flowRunner = new FlowRunner(driver, stateHandler, createSeleniumNavigation());
	const result = await flowRunner.run(popupUrl, { maxSteps: 25 });
	assert.equal(result.success, true, `Login flow failed: ${result.error}`);
	await driver.switchTo().window(popupWindowHandle);
	return popupWindowHandle;
}

async function openPageInNewTab(driver: WebDriver, url: string): Promise<void> {
	await driver.switchTo().newWindow("tab");
	await driver.get(url);
}

async function resolveTabId(config: CaptureScenariosConfig, url: string): Promise<number> {
	const raw = await config.driver.executeAsyncScript(
		"const [namespace, url] = arguments; const done = arguments[arguments.length - 1];" +
			"globalThis[namespace].tabs.query({}).then((tabs) => { const t = tabs.find((x) => x.url === url); done(t ? t.id : -1); });",
		config.namespace,
		url,
	);
	const tabId = Number(raw);
	assert.ok(
		Number.isInteger(tabId) && tabId >= 0,
		`Could not resolve extension tab id for ${url} (got ${String(raw)})`,
	);
	return tabId;
}

async function activateTab(config: CaptureScenariosConfig, tabId: number): Promise<void> {
	const activeTabId = await config.driver.executeAsyncScript(
		"const [namespace, tabId] = arguments; const done = arguments[arguments.length - 1];" +
			"const api = globalThis[namespace];" +
			"api.tabs.update(tabId, { active: true })" +
			".then(() => api.tabs.query({ active: true, currentWindow: true }))" +
			".then(([active]) => done(active ? active.id : -1));",
		config.namespace,
		tabId,
	);
	assert.equal(activeTabId, tabId, `tab ${tabId} did not become the active tab before the save`);
}

async function injectSaveCurrentTab(
	config: CaptureScenariosConfig,
	params: { url: string; title: string; tabId: number },
): Promise<void> {
	await config.driver.executeScript(
		"const [namespace, url, title, tabId] = arguments;" +
			"globalThis[namespace].runtime.sendMessage({ type: 'save-current-tab', url, title, tabId });",
		config.namespace,
		params.url,
		params.title,
		params.tabId,
	);
}

async function assertSavedTitleCarries(
	config: CaptureScenariosConfig,
	markers: { saved: string; other: string },
): Promise<void> {
	const accessToken = await obtainAccessToken({
		serverUrl: config.serverOrigin,
		email: config.testEmail,
		password: config.testPassword,
	});
	const { getItems } = initSirenReadingList({
		serverUrl: config.serverOrigin,
		getAccessToken: async () => accessToken,
		fetchFn: (...args) => fetch(...args),
		refreshTokens: async () => ({ ok: false, reason: "no-refresh-token" }),
		onUnauthorized: async () => {
			throw new Error("Unauthorized while walking the saved readlist");
		},
		logger: Logger.from(consoleLogger),
		onAdvertisedActions: () => {},
	});

	const deadline = Date.now() + 60_000;
	let lastTitle = "<no item yet>";
	while (Date.now() < deadline) {
		const { items } = await getItems();
		const saved = items.find((item) => item.url.includes(markers.saved));
		if (saved) {
			lastTitle = saved.title;
			assert.ok(
				!saved.title.includes(markers.other),
				`Saved item for the invoking tab carried the other tab's content — title: "${saved.title}"`,
			);
			if (saved.title.includes(markers.saved)) return;
		}
		await new Promise((r) => setTimeout(r, 1_000));
	}

	throw new Error(
		`Timed out after 60s waiting for the saved title to contain "${markers.saved}". Last observed title: "${lastTitle}"`,
	);
}

async function saveTabSwitch(config: CaptureScenariosConfig, popupWindowHandle: string): Promise<void> {
	const { driver, serverOrigin, runId } = config;
	const markerA = `tabswitcha${runId}`;
	const markerB = `tabswitchb${runId}`;
	const pageA = `${serverOrigin}/e2e/fixtures/links-page/${markerA}`;
	const pageB = `${serverOrigin}/e2e/fixtures/links-page/${markerB}`;

	await openPageInNewTab(driver, pageA);
	await openPageInNewTab(driver, pageB);

	await driver.switchTo().window(popupWindowHandle);
	const tabIdA = await resolveTabId(config, pageA);
	const tabIdB = await resolveTabId(config, pageB);
	await activateTab(config, tabIdB);
	await injectSaveCurrentTab(config, { url: pageA, title: "pending-tab-switch-capture", tabId: tabIdA });

	const received = await waitForReceivedSaveContent(config, pageA);
	const uploaded = Buffer.from(received.contentBase64 ?? "", "base64").toString("utf8");
	assert.ok(
		uploaded.includes(markerA),
		`the upload for the invoking tab did not carry its page: ${JSON.stringify({ url: received.url, mediaType: received.mediaType, status: received.status, uploaded: uploaded.slice(0, 300) })}`,
	);

	await assertSavedTitleCarries(config, { saved: markerA, other: markerB });
}

async function waitForReceivedSaveContent(config: CaptureScenariosConfig, url: string): Promise<ReceivedSaveContent> {
	const received = await waitForUi(
		config.driver,
		async () => {
			const response = await fetch(
				`${config.serverOrigin}/e2e/received-save-content?url=${encodeURIComponent(url)}`,
			);
			assert.equal(response.status, 200, `GET /e2e/received-save-content returned ${response.status}`);
			const uploads: ReceivedSaveContent[] = await response.json();
			return uploads.at(-1) ?? null;
		},
		`the server recorded no save-content upload for ${url}`,
	);
	assert.ok(received, `the server recorded no save-content upload for ${url}`);
	return received;
}

async function saveMediaTab(
	config: CaptureScenariosConfig,
	params: { popupWindowHandle: string; url: string; contentType: string },
): Promise<ReceivedSaveContent> {
	const { driver } = config;
	await openPageInNewTab(driver, params.url);
	const documentContentType = await driver.executeScript("return document.contentType;");
	assert.equal(
		documentContentType,
		params.contentType,
		`the browser did not open ${params.url} as ${params.contentType}`,
	);

	await driver.switchTo().window(params.popupWindowHandle);
	const tabId = await resolveTabId(config, params.url);
	const reply = await driver.executeAsyncScript(
		"const [namespace, url, tabId] = arguments; const done = arguments[arguments.length - 1];" +
			"globalThis[namespace].runtime.sendMessage({ type: 'save-current-tab', url, title: url, tabId }).then(done);",
		config.namespace,
		params.url,
		tabId,
	);
	assert.ok(
		SavedReplySchema.safeParse(reply).success,
		`the background did not save ${params.url}: ${JSON.stringify(reply)}`,
	);
	return waitForReceivedSaveContent(config, params.url);
}

async function saveImageTab(config: CaptureScenariosConfig, popupWindowHandle: string): Promise<void> {
	const imageUrl = `${config.serverOrigin}/e2e/fixtures/image/capture${config.runId}.png`;
	const received = await saveMediaTab(config, { popupWindowHandle, url: imageUrl, contentType: "image/png" });
	assert.equal(received.mediaType, "image/png", `the image tab was not uploaded as image/png: ${JSON.stringify(received)}`);
	assert.equal(received.status, 201, `the server did not answer the image upload with 201: ${JSON.stringify(received)}`);
}

async function savePdfTab(config: CaptureScenariosConfig, popupWindowHandle: string): Promise<void> {
	const pdfUrl = `${config.serverOrigin}/e2e/fixtures/sample.pdf`;
	const fixture = await fetch(pdfUrl);
	const fixtureBytes = (await fixture.arrayBuffer()).byteLength;
	const received = await saveMediaTab(config, { popupWindowHandle, url: pdfUrl, contentType: "application/pdf" });
	assert.equal(received.mediaType, "application/pdf", `the PDF tab was not uploaded as application/pdf: ${JSON.stringify(received)}`);
	assert.equal(received.status, 201, `the server did not accept the PDF upload: ${JSON.stringify(received)}`);
	assert.equal(received.contentBytes, fixtureBytes, `the uploaded PDF is not the fixture's bytes: ${JSON.stringify(received)}`);
}

async function forceSignOut(config: CaptureScenariosConfig): Promise<void> {
	const response = await fetch(`${config.serverOrigin}/e2e/expire-access-tokens`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: config.testEmail, forget: true }),
	});
	assert.equal(response.status, 200, `POST /e2e/expire-access-tokens returned ${response.status}`);
	await config.driver.get(config.popupUrl);
	await waitForView(config.driver, "login-view", "the popup never returned to the login view after the refresh token was forgotten");
}

export async function runCaptureScenarios(config: CaptureScenariosConfig): Promise<void> {
	const popupWindowHandle = await logIn(config);
	await saveTabSwitch(config, popupWindowHandle);
	await saveImageTab(config, popupWindowHandle);
	await savePdfTab(config, popupWindowHandle);
	await config.driver.switchTo().window(popupWindowHandle);
	await forceSignOut(config);
}
