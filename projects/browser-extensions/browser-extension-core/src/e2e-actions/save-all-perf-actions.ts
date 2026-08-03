import assert from "node:assert/strict";
import http from "node:http";
import type { WebDriver } from "selenium-webdriver";
import { waitForSaveAllUi } from "./wait-budget";

/** Perf tabs are served under a name, never under 127.0.0.1: `isAppUrl` counts
 * loopback among the app's own pages, so tabs served there are dropped before
 * the bulk request and a sample would measure a save of nothing. Each browser
 * is told to resolve this name to loopback itself. */
export const PERF_TAB_HOST = "perf.readplace.test";

export type TabPageServer = {
	origin: string;
	close: () => Promise<void>;
};

/** Serves the pages the perf tabs sit on. They are deliberately tiny: a bulk
 * save's cost is meant to come from how many tabs it carries, not from how much
 * any one of them weighs. */
export async function startTabPageServer(): Promise<TabPageServer> {
	const server = http.createServer((req, res) => {
		const title = `Perf tab ${(req.url ?? "/").replace(/[^\w/-]/g, "")}`;
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(
			`<!doctype html><html lang="en"><head><title>${title}</title></head>` +
				`<body><h1>${title}</h1><p>Readplace bulk save perf fixture.</p></body></html>`,
		);
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	assert.ok(
		address !== null && typeof address === "object",
		"the tab page server must report the TCP port it bound",
	);
	return {
		origin: `http://${PERF_TAB_HOST}:${address.port}`,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
	};
}

/** A sample's worth of URLs no save has seen before. Re-saving a URL takes the
 * server's refresh path, which measures something other than a first save. */
export function perfTabUrls(input: {
	origin: string;
	runId: string;
	label: string;
	sample: number;
	count: number;
}): string[] {
	return Array.from(
		{ length: input.count },
		(_unused, index) =>
			`${input.origin}/perf/${input.runId}/${input.label}-${input.sample}/${index}`,
	);
}

/** Runs `body` inside whatever extension page the driver is on, so the script
 * reaches the extension APIs the popup itself uses. `done` settles it. */
async function runInExtensionPage(
	driver: WebDriver,
	body: string,
	...args: unknown[]
): Promise<unknown> {
	return driver.executeAsyncScript(
		"const api = globalThis.browser || globalThis.chrome;" +
			"const done = arguments[arguments.length - 1];" +
			body,
		...args,
	);
}

/** Leaves the window holding only the page the driver is on. The login flow
 * ends with tabs of its own, and every extra tab lands in the bulk summary's
 * skipped count, which the samples assert on exactly. */
export async function closeOtherTabs(driver: WebDriver): Promise<void> {
	const remaining = await runInExtensionPage(
		driver,
		`api.tabs.query({ currentWindow: true }).then(function (tabs) {
			var others = tabs.filter(function (tab) { return !tab.active; });
			var active = tabs.length - others.length;
			return api.tabs.remove(others.map(function (tab) { return tab.id; }))
				.then(function () { return active; });
		}).then(done, function (err) { done(String(err)); });`,
	);
	assert.equal(
		remaining,
		1,
		`the perf window must be left holding only the popup tab, got ${String(remaining)}`,
	);
}

export async function openPerfTabs(
	driver: WebDriver,
	urls: string[],
): Promise<number[]> {
	const raw = await runInExtensionPage(
		driver,
		`var urls = arguments[0];
		Promise.all(urls.map(function (url) {
			return api.tabs.create({ url: url, active: false });
		})).then(function (tabs) {
			done(tabs.map(function (tab) { return tab.id; }));
		}, function (err) { done(String(err)); });`,
		urls,
	);
	assert.ok(Array.isArray(raw), `opening the perf tabs failed: ${String(raw)}`);
	assert.equal(raw.length, urls.length, "every perf tab must have been created");
	return raw.map(Number);
}

export async function retargetPerfTabs(
	driver: WebDriver,
	input: { tabIds: number[]; urls: string[] },
): Promise<void> {
	assert.equal(
		input.tabIds.length,
		input.urls.length,
		"every perf tab must be given exactly one fresh URL",
	);
	const failure = await runInExtensionPage(
		driver,
		`var tabIds = arguments[0];
		var urls = arguments[1];
		Promise.all(tabIds.map(function (tabId, index) {
			return api.tabs.update(tabId, { url: urls[index] });
		})).then(function () { done(null); }, function (err) { done(String(err)); });`,
		input.tabIds,
		input.urls,
	);
	assert.equal(
		failure,
		null,
		`re-navigating the perf tabs failed: ${String(failure)}`,
	);
}

async function countSettledOn(
	driver: WebDriver,
	urls: string[],
): Promise<number> {
	const raw = await runInExtensionPage(
		driver,
		`var wanted = Object.create(null);
		arguments[0].forEach(function (url) { wanted[url] = true; });
		api.tabs.query({ currentWindow: true }).then(function (tabs) {
			var settled = 0;
			tabs.forEach(function (tab) {
				if (tab.status !== "complete") return;
				if (typeof tab.url !== "string") return;
				if (wanted[tab.url] !== true) return;
				delete wanted[tab.url];
				settled += 1;
			});
			done(settled);
		}, function (err) { done(String(err)); });`,
		urls,
	);
	assert.equal(
		typeof raw,
		"number",
		`counting the settled perf tabs failed: ${String(raw)}`,
	);
	return Number(raw);
}

/** Waits for the exact URLs this sample asked for, never for a status or an
 * origin. `tabs.update` starts a navigation asynchronously, so a tab keeps
 * reporting the previous sample's URL as `complete` for a moment afterwards —
 * a check that accepted those would save URLs already saved and measure the
 * server's refresh path instead of a first save. */
export async function waitForPerfTabsReady(
	driver: WebDriver,
	input: { urls: string[] },
): Promise<void> {
	await waitForSaveAllUi(
		driver,
		async (d) => {
			const settled = await countSettledOn(d, input.urls);
			return settled === input.urls.length ? settled : null;
		},
		`the perf tabs never all settled on this sample's URLs (expected ${input.urls.length})`,
	);
}

/** Proves the content script answers a capture in this environment before any
 * sample is taken. Capture is on the critical path being measured, and it
 * degrades silently: an unreachable content script leaves every page URL-only,
 * which still saves, still summarises, and still reports a number — one that
 * describes a flow that captured nothing. */
export async function assertTabCaptures(
	driver: WebDriver,
	tabId: number,
): Promise<void> {
	const raw = await runInExtensionPage(
		driver,
		`api.tabs.sendMessage(arguments[0], { type: "capture-html" }).then(function (reply) {
			done(reply && typeof reply.rawHtml === "string" ? reply.rawHtml.length : -1);
		}, function (err) { done(String(err)); });`,
		tabId,
	);
	assert.equal(
		typeof raw,
		"number",
		`the perf tab did not answer a capture: ${String(raw)}`,
	);
	assert.ok(
		Number(raw) > 0,
		`the perf tab captured no DOM, so a sample would measure a URL-only save`,
	);
}

/** The production trigger: the background sets this flag before it opens the
 * popup, and the popup reads-and-removes it on boot to run the bulk flow. */
export async function seedPendingBulkSave(driver: WebDriver): Promise<void> {
	const failure = await runInExtensionPage(
		driver,
		`api.storage.session.set({ pendingBulkSave: true })
			.then(function () { done(null); }, function (err) { done(String(err)); });`,
	);
	assert.equal(
		failure,
		null,
		`seeding the pending bulk save failed: ${String(failure)}`,
	);
}

/** Reads a performance mark back off the page that set it. Both ends of a
 * sample are taken in-page — `performance.timeOrigin` is the popup document's
 * navigation start — so the number carries none of the WebDriver round trips
 * the harness spends observing it. */
export async function readRenderedMark(
	driver: WebDriver,
	markName: string,
): Promise<{ marks: number; elapsedMs: number } | null> {
	const raw = await driver.executeScript(
		`const entries = performance.getEntriesByName(${JSON.stringify(markName)});` +
			"return entries.length === 0 ? [] : [entries.length, entries[0].startTime];",
	);
	assert.ok(Array.isArray(raw), `the ${markName} probe must answer with an array`);
	if (raw.length === 0) return null;
	const [marks, elapsedMs] = raw.map(Number);
	return { marks, elapsedMs };
}
