import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Builder, type WebDriver } from "selenium-webdriver";
import { Options, ServiceBuilder } from "selenium-webdriver/chrome";
import { getEnv, requireEnv } from "@packages/require-env";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";
import { obtainAccessToken } from "browser-extension-core/e2e";
import { runPerfSuite, SUITE_FAILSAFE_MS } from "browser-extension-core/e2e-actions";
import { perfArtifactDirectory, perfSetting, summarizeLatency } from "browser-extension-core/perf";

const EXTENSION_DIR = realpathSync(path.resolve(__dirname, "../../../dist-extension-compiled"));
const EXTENSION_ID = createHash("sha256").update(EXTENSION_DIR).digest("hex").slice(0, 32)
	.replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
const PROJECT_DIR = path.resolve(__dirname, "../../..");
const TEST_PORT = Number(requireEnv("E2E_PORT"));
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
const READY_NONCE = randomUUID();
const TEST_USER = { email: "popup-open-perf@example.com", password: "testpassword123" };
const BUDGET_MS = perfSetting("PERF_POPUP_OPEN_BUDGET_MS");
const SAMPLES = perfSetting("PERF_POPUP_OPEN_SAMPLES");
const HOLD_MS = perfSetting("PERF_POPUP_RUNTIME_HOLD_MS");

type Tokens = { accessToken: string; refreshToken: string };
type Target = { targetId: string; type: string; url: string };
type CdpEvent = { method: string; sessionId?: string; params: Record<string, unknown> };
type Evaluation<T> = { result: { value: T }; exceptionDetails?: unknown };

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

async function connect(driver: WebDriver) {
	const options = (await driver.getCapabilities()).get("goog:chromeOptions") as { debuggerAddress: string };
	const response = await fetch(`http://${options.debuggerAddress}/json/version`);
	const endpoint = await response.json() as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(endpoint.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let nextId = 0;
	const pending = new Map<number, ReturnType<typeof deferred<unknown>>>();
	const listeners = new Set<(event: CdpEvent) => void>();
	socket.addEventListener("message", event => {
		const message = JSON.parse(String(event.data)) as CdpEvent & { id?: number; result?: unknown; error?: unknown };
		if (message.id !== undefined) {
			const call = pending.get(message.id);
			assert(call, `Unknown DevTools response ${message.id}`);
			pending.delete(message.id);
			if (message.error) call.reject(new Error(JSON.stringify(message.error)));
			else call.resolve(message.result);
		} else {
			for (const listener of listeners) listener(message);
		}
	});
	return {
		async send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
			const id = ++nextId;
			const result = deferred<unknown>();
			pending.set(id, result);
			socket.send(JSON.stringify({ id, method, params, sessionId }));
			return await result.promise.catch(error => { throw new Error(`${method}: ${String(error)}`, { cause: error }); }) as T;
		},
		listen(listener: (event: CdpEvent) => void) { listeners.add(listener); },
		close() { socket.close(); },
	};
}

type DevTools = Awaited<ReturnType<typeof connect>>;

async function evaluate<T>(cdp: DevTools, input: { sessionId: string; expression: string }): Promise<T> {
	const result = await cdp.send<Evaluation<T>>("Runtime.evaluate", {
		expression: input.expression, awaitPromise: true, returnByValue: true,
	}, input.sessionId);
	assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
	return result.result.value;
}

async function until<T>(read: () => Promise<T | undefined>, description: string): Promise<T> {
	const deadline = performance.now() + 15_000;
	while (performance.now() < deadline) {
		const result = await read();
		if (result !== undefined) return result;
		await delay(10);
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function obtainTokens(): Promise<Tokens> {
	let tokens: Tokens | undefined;
	await obtainAccessToken({
		serverUrl: ORIGIN, ...TEST_USER,
		fetchFn: async (...args) => {
			const response = await fetch(...args);
			if (String(args[0]).endsWith("/oauth/token") && response.ok) {
				const body = await response.clone().json() as Record<string, unknown>;
				assert(typeof body.access_token === "string");
				assert(typeof body.refresh_token === "string");
				tokens = { accessToken: body.access_token, refreshToken: body.refresh_token };
			}
			return response;
		},
	});
	assert(tokens, "Real OAuth login must issue both tokens before Chrome starts");
	return tokens;
}

async function launch(profile: string): Promise<WebDriver> {
	const options = new Options();
	if (getEnv("HEADLESS") !== "false") options.addArguments("--headless=new");
	options.addArguments("--enable-unsafe-extension-debugging", "--disable-search-engine-choice-screen", "--no-sandbox", "--disable-dev-shm-usage", `--user-data-dir=${profile}`);
	options.addArguments(`--load-extension=${EXTENSION_DIR}`);
	if (getEnv("PERF_GPU") !== "true") options.addArguments("--disable-gpu");
	options.setChromeBinaryPath(readFileSync(path.join(PROJECT_DIR, ".cache/chrome/binary-path"), "utf8").trim());
	const service = new ServiceBuilder(readFileSync(path.join(PROJECT_DIR, ".cache/chrome/driver-path"), "utf8").trim());
	return await new Builder().forBrowser("chrome").setChromeOptions(options).setChromeService(service).build();
}

type SkeletonDimensions = { width: number; height: number; iconWidth: number; iconHeight: number; bars: { width: number; height: number }[] };

type Sample = {
	firstPaintMs: number;
	applicationLoadStartedMs?: number;
	documentLoadMs: number;
	skeletonVisible?: boolean;
	skeletonDimensions?: SkeletonDimensions;
	heldAssets?: string[];
	openedWhileApplicationAssetsHeld?: boolean;
	paintedWhileApplicationAssetsHeld?: boolean;
	screenshot?: string;
	terminalView: string;
};

async function attachWorker(connection: DevTools): Promise<string> {
	const worker = await until(async () => {
		const targets = await connection.send<{ targetInfos: Target[] }>("Target.getTargets");
		return targets.targetInfos.find(target => target.type === "service_worker" && target.url.startsWith(`chrome-extension://${EXTENSION_ID}/`));
	}, "the extension worker");
	const { sessionId } = await connection.send<{ sessionId: string }>("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
	await until(async () => await evaluate<string>(connection, { sessionId, expression: "typeof chrome" }) === "object" ? true : undefined, "the extension worker API");
	return sessionId;
}

async function measure(input: { tokens?: Tokens; holdApplicationAssets: boolean }): Promise<Sample> {
	const profile = mkdtempSync(path.join(tmpdir(), "readplace-popup-perf-"));
	mkdirSync(path.join(profile, "Default"));
	writeFileSync(path.join(profile, "Default/Preferences"), JSON.stringify({ extensions: { pinned_extensions: [EXTENSION_ID] } }));
	let driver: WebDriver | undefined;
	let cdp: DevTools | undefined;
	try {
		driver = await launch(profile);
		cdp = await connect(driver);
		const preparationWorker = await attachWorker(cdp);
		const settings = await evaluate<{ isOnToolbar: boolean }>(cdp, { sessionId: preparationWorker, expression: "chrome.action.getUserSettings()" });
		assert(settings.isOnToolbar, "Native popup measurements require a pinned toolbar action");
		await evaluate(cdp, { sessionId: preparationWorker, expression: `chrome.storage.local.set(${JSON.stringify(input.tokens ? { hutch_oauth_tokens: input.tokens } : {})})` });
		cdp.close();
		await driver.quit();
		driver = await launch(profile);
		const connection = await connect(driver);
		cdp = connection;
		let popupSessionId: string | undefined;
		let applicationAssetRequested = false;
		const heldRequests: { requestId: string; sessionId: string }[] = [];
		const heldAssets: string[] = [];
		let holdRequests = input.holdApplicationAssets;
		const failed = deferred<never>();
		const attachments = async (event: CdpEvent) => {
			if (event.method === "Target.attachedToTarget") {
				const { sessionId, targetInfo } = event.params as { sessionId: string; targetInfo: Target };
				if (targetInfo.type === "other") {
					if (input.holdApplicationAssets) {
						await connection.send("Fetch.enable", { patterns: [{ urlPattern: `chrome-extension://${EXTENSION_ID}/*`, requestStage: "Request" }] }, sessionId);
					}
					popupSessionId = sessionId;
				}
				await connection.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
			}
			if (event.method === "Fetch.requestPaused") {
				assert(event.sessionId);
				const { requestId, request } = event.params as { requestId: string; request: { url: string } };
				const asset = new URL(request.url).pathname;
				if (!holdRequests || asset === "/popup/popup.template.html" || asset === "/popup/popup-entry.browser.js") {
					await connection.send("Fetch.continueRequest", { requestId }, event.sessionId);
				} else {
					heldRequests.push({ requestId, sessionId: event.sessionId });
					heldAssets.push(asset);
					applicationAssetRequested = true;
				}
			}
		};
		connection.listen(event => { attachments(event).catch(failed.reject); });
		await driver.get(ORIGIN);
		const { tab, page } = await until(async () => {
			const { targetInfos } = await connection.send<{ targetInfos: Target[] }>("Target.getTargets", { filter: [{ type: "tab" }, { type: "page" }, { exclude: true }] });
			const tab = targetInfos.find(target => target.type === "tab" && target.url.startsWith(ORIGIN));
			const page = targetInfos.find(target => target.type === "page" && target.url.startsWith(ORIGIN));
			return tab && page ? { tab, page } : undefined;
		}, "the active browser tab and page timing targets");
		const { sessionId: pageSession } = await connection.send<{ sessionId: string }>("Target.attachToTarget", { targetId: page.targetId, flatten: true });
		await connection.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: input.holdApplicationAssets, flatten: true, filter: [{ type: "other", exclude: false }, { exclude: true }] });
		const requestedAt = await evaluate<number>(connection, { sessionId: pageSession, expression: "performance.timeOrigin + performance.now()" });
		await connection.send("Extensions.triggerAction", { id: EXTENSION_ID, targetId: tab.targetId });
		const popupSession = await Promise.race([until(async () => popupSessionId, "the native popup target"), failed.promise]);
		const readPopupPaint = () => evaluate<{ visible: boolean; firstPaintAt?: number }>(connection, { sessionId: popupSession, expression: "(() => { const paint = performance.getEntriesByType('paint').find(entry => entry.name === 'first-paint'); return { visible: document.visibilityState === 'visible', firstPaintAt: paint === undefined ? undefined : performance.timeOrigin + paint.startTime }; })()" });

		let firstPaintAt: number | undefined;
		let openedWhileApplicationAssetsHeld: boolean | undefined;
		let paintedWhileApplicationAssetsHeld: boolean | undefined;
		let skeletonVisible: boolean | undefined;
		let skeletonDimensions: SkeletonDimensions | undefined;
		let screenshot: string | undefined;
		if (input.holdApplicationAssets) {
			await Promise.race([until(async () => applicationAssetRequested ? true : undefined, "a popup application asset request"), failed.promise]);
			const deadline = performance.now() + HOLD_MS;
			openedWhileApplicationAssetsHeld = false;
			paintedWhileApplicationAssetsHeld = false;
			do {
				const state = await Promise.race([readPopupPaint(), failed.promise]);
				openedWhileApplicationAssetsHeld = state.visible;
				if (state.visible && state.firstPaintAt !== undefined) {
					firstPaintAt = state.firstPaintAt;
					paintedWhileApplicationAssetsHeld = true;
					break;
				}
				await delay(10);
			} while (performance.now() < deadline);

			skeletonVisible = await evaluate<boolean>(connection, { sessionId: popupSession, expression: `(() => {
				const view = document.querySelector('#saving-view');
				const placeholders = Array.from(document.querySelectorAll('.saving-view__icon, .saving-view__bar'));
				return Boolean(document.visibilityState === 'visible' && view && !view.hidden && placeholders.length === 5 && placeholders.every(element => {
					const rect = element.getBoundingClientRect();
					if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
					for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
						const style = getComputedStyle(ancestor);
						if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
					}
					const background = getComputedStyle(element).backgroundColor;
					return background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)';
				}));
			})()` });
			skeletonDimensions = await evaluate<SkeletonDimensions>(connection, { sessionId: popupSession, expression: "(() => { const view = document.querySelector('#saving-view').getBoundingClientRect(); const icon = document.querySelector('.saving-view__icon').getBoundingClientRect(); const bars = Array.from(document.querySelectorAll('.saving-view__bar'), bar => { const { width, height } = bar.getBoundingClientRect(); return { width, height }; }); return { width: view.width, height: view.height, iconWidth: icon.width, iconHeight: icon.height, bars }; })()" });
			if (paintedWhileApplicationAssetsHeld) {
				const capture = await connection.send<{ data: string }>("Page.captureScreenshot", {}, popupSession);
				const directory = perfArtifactDirectory({ root: getEnv("CI_ARTIFACT_ROOT"), runId: getEnv("GITHUB_RUN_ID") });
				mkdirSync(directory, { recursive: true });
				screenshot = path.join(directory, `chrome-popup-skeleton-${input.tokens ? "signed-in" : "signed-out"}.png`);
				writeFileSync(screenshot, Buffer.from(capture.data, "base64"));
			}
			holdRequests = false;
			await Promise.all(heldRequests.map(request => connection.send("Fetch.continueRequest", { requestId: request.requestId }, request.sessionId)));
		}
		firstPaintAt ??= await Promise.race([until(async () => {
			const state = await readPopupPaint();
			return state.visible ? state.firstPaintAt : undefined;
		}, "the browser's first visible popup paint"), failed.promise]);
		const firstPaintMs = firstPaintAt - requestedAt;
		assert(firstPaintMs >= 0, "The popup's first paint must follow the request to open it");
		const terminalView = input.tokens ? "list-view" : "login-view";
		await until(async () => await evaluate<boolean>(connection, { sessionId: popupSession, expression: `(() => { const view = document.getElementById(${JSON.stringify(terminalView)}); return Boolean(view && !view.hidden); })()` }) ? true : undefined, terminalView);
		const documentLoadMs = await evaluate<number>(connection, { sessionId: popupSession, expression: "performance.getEntriesByType('navigation')[0].loadEventEnd" });
		const applicationLoadStartedAt = await evaluate<number | undefined>(connection, { sessionId: popupSession, expression: "(() => { const entry = performance.getEntriesByName('popup-first-frame')[0]; return entry === undefined ? undefined : performance.timeOrigin + entry.startTime; })()" });
		const applicationLoadStartedMs = applicationLoadStartedAt === undefined ? undefined : applicationLoadStartedAt - requestedAt;
		return { firstPaintMs, applicationLoadStartedMs, documentLoadMs, skeletonVisible, skeletonDimensions, heldAssets, openedWhileApplicationAssetsHeld, paintedWhileApplicationAssetsHeld, screenshot, terminalView };
	} finally {
		cdp?.close();
		await driver?.quit();
		rmSync(profile, { recursive: true, force: true });
	}
}

test("the first native popup paints feedback before its application assets load", async t => {
	const records: Record<string, { held?: Sample; cold: Sample[] }> = {};
	await runPerfSuite({
		server: { port: TEST_PORT, readyUrl: `${ORIGIN}${readyProbePath(READY_NONCE)}`, serverEnv: { [READY_NONCE_ENV]: READY_NONCE }, user: TEST_USER },
		failsafeMs: SUITE_FAILSAFE_MS,
		diagnostic: message => t.diagnostic(message),
		measure: async () => {
			for (const auth of ["signed-out", "signed-in"]) {
				const tokens = auth === "signed-in" ? await obtainTokens() : undefined;
				const record: { held?: Sample; cold: Sample[] } = { cold: [] };
				records[auth] = record;
				await t.test(`${auth}: stalled application styles and runtime leave the native skeleton visible`, async () => {
					record.held = await measure({ tokens, holdApplicationAssets: true });
					t.diagnostic(`${auth}: held application assets first paint ${Math.round(record.held.firstPaintMs)}ms`);
					assert(record.held.openedWhileApplicationAssetsHeld, `${auth}: Chrome kept the popup closed while application styles and runtime were held for ${HOLD_MS}ms`);
					assert(record.held.paintedWhileApplicationAssetsHeld, `${auth}: the browser must paint the popup before its application assets are available`);
					assert(record.held.skeletonVisible, `${auth}: the native popup must contain the skeleton before its application assets are available`);
					assert(record.held.skeletonDimensions);
					assert.equal(record.held.skeletonDimensions.width, 350);
					assert(record.held.skeletonDimensions.height > 100);
					assert.equal(record.held.skeletonDimensions.iconWidth, 48);
					assert.equal(record.held.skeletonDimensions.iconHeight, 48);
					assert.equal(record.held.skeletonDimensions.bars.length, 4);
					assert(record.held.skeletonDimensions.bars.every(bar => bar.width > 0 && bar.height > 0));
				});
				await t.test(`${auth}: every cold first paint fits the ${BUDGET_MS}ms visible feedback budget`, async () => {
					for (let sample = 0; sample < SAMPLES; sample++) record.cold.push(await measure({ tokens, holdApplicationAssets: false }));
					const stats = summarizeLatency(record.cold.map(sample => sample.firstPaintMs));
					t.diagnostic(`${auth}: first popup paint ${record.cold.map(sample => Math.round(sample.firstPaintMs)).join(", ")}ms; mean ${Math.round(stats.meanMs)}ms`);
					assert(record.cold.every(sample => sample.applicationLoadStartedMs !== undefined && sample.applicationLoadStartedMs >= sample.firstPaintMs), `${auth}: the browser must paint the skeleton before starting application loading`);
					assert(stats.maxMs < BUDGET_MS, `${auth}: slowest cold first popup paint took ${stats.maxMs.toFixed(1)}ms, exceeding the ${BUDGET_MS}ms visible feedback budget`);
				});
			}
		},
	});
	const directory = perfArtifactDirectory({ root: getEnv("CI_ARTIFACT_ROOT"), runId: getEnv("GITHUB_RUN_ID") });
	mkdirSync(directory, { recursive: true });
	writeFileSync(path.join(directory, "chrome-popup-open-latency.json"), JSON.stringify({ schema: "popup-open-latency/v5", trigger: "Extensions.triggerAction", startTimestamp: "active-tab-performance-before-command", budgetMetric: "firstPaintMs", budgetMs: BUDGET_MS, applicationAssetWaitDeadlineMs: HOLD_MS, samplesPerAuthState: SAMPLES, records }, null, "\t"));
});
