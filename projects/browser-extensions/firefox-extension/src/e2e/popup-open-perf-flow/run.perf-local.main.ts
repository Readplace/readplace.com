import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
	READY_NONCE_ENV,
	readyProbePath,
} from "@packages/e2e-harness/ready-probe";
import { getEnv, requireEnv } from "@packages/require-env";
import { obtainAccessToken } from "browser-extension-core/e2e";
import {
	assertGeckodriverSupportsSystemAccess,
	createFirefoxBrowser,
	runPerfSuite,
	SUITE_FAILSAFE_MS,
} from "browser-extension-core/e2e-actions";
import {
	perfArtifactDirectory,
	perfSetting,
	summarizeLatency,
} from "browser-extension-core/perf";
import { Builder } from "selenium-webdriver";
import { Context, Driver } from "selenium-webdriver/firefox";

const EXTENSION_DIR = path.resolve(
	__dirname,
	"../../../dist-extension-compiled",
);
const ADDON_ID = "hutch-extension@hutch-app.com";
const ADDON_UUID = "d3b07384-d113-4ec6-a7b8-5f7e3b4c9a12";
const EXTENSION_ORIGIN = `moz-extension://${ADDON_UUID}`;
const POPUP_URL = `${EXTENSION_ORIGIN}/popup/popup.template.html`;
const BACKGROUND_URL = `${EXTENSION_ORIGIN}/_generated_background_page.html`;
const TEST_PORT = Number(requireEnv("E2E_PORT"));
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
const READY_NONCE = randomUUID();
const TEST_USER = {
	email: "popup-open-perf@example.com",
	password: "testpassword123",
};
const BUDGET_MS = perfSetting("PERF_POPUP_OPEN_BUDGET_MS");
const SAMPLES = perfSetting("PERF_POPUP_OPEN_SAMPLES");
const HOLD_MS = perfSetting("PERF_POPUP_RUNTIME_HOLD_MS");

type Tokens = { accessToken: string; refreshToken: string };
type SkeletonDimensions = {
	width: number;
	height: number;
	iconWidth: number;
	iconHeight: number;
	bars: { width: number; height: number }[];
};
type PopupState = {
	visible: boolean;
	shellVisible: boolean;
	skeletonVisible: boolean;
	skeletonDimensions?: SkeletonDimensions;
	terminalView?: string;
	documentLoadMs: number;
	applicationLoadStartedAt?: number;
	runtimeLoadStartedAt?: number;
};
type Probe = {
	firstPaintAt?: number;
	firstPaintState?: PopupState;
	heldAssets: string[];
	state?: PopupState;
	panelVisible: boolean;
	error?: string;
};
type Sample = {
	browserVersion: string;
	firstPaintMs: number;
	applicationLoadStartedMs?: number;
	runtimeLoadStartedMs?: number;
	firstPaintShellVisible: boolean;
	firstPaintSkeletonVisible: boolean;
	firstPaintSkeletonDimensions?: SkeletonDimensions;
	documentLoadMs: number;
	skeletonVisible?: boolean;
	skeletonDimensions?: SkeletonDimensions;
	heldAssets: string[];
	openedWhileApplicationAssetsHeld?: boolean;
	paintedWhileApplicationAssetsHeld?: boolean;
	screenshot?: string;
	terminalView: string;
};

function assertSkeletonDimensions(
	dimensions: SkeletonDimensions | undefined,
): void {
	assert(dimensions);
	assert.equal(dimensions.width, 350);
	assert(dimensions.height > 100);
	assert.equal(dimensions.iconWidth, 48);
	assert.equal(dimensions.iconHeight, 48);
	assert.equal(dimensions.bars.length, 4);
	assert(dimensions.bars.every((bar) => bar.width > 0 && bar.height > 0));
}

async function until<T>(
	read: () => Promise<T | undefined>,
	description: string,
): Promise<T> {
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
		serverUrl: ORIGIN,
		...TEST_USER,
		fetchFn: async (...args) => {
			const response = await fetch(...args);
			if (String(args[0]).endsWith("/oauth/token") && response.ok) {
				const body = (await response.clone().json()) as Record<string, unknown>;
				assert(typeof body.access_token === "string");
				assert(typeof body.refresh_token === "string");
				tokens = {
					accessToken: body.access_token,
					refreshToken: body.refresh_token,
				};
			}
			return response;
		},
	});
	assert(
		tokens,
		"Real OAuth login must issue both tokens before Firefox starts",
	);
	return tokens;
}

async function launch(profile: string): Promise<Driver> {
	const { options, service } = createFirefoxBrowser({
		ci: getEnv("CI") === "true",
	});
	options.addArguments("-profile", profile);
	if (getEnv("HEADLESS") !== "false") options.addArguments("--headless");
	options.setPreference(
		"extensions.webextensions.uuids",
		JSON.stringify({ [ADDON_ID]: ADDON_UUID }),
	);
	assertGeckodriverSupportsSystemAccess();
	const driver = await new Builder()
		.forBrowser("firefox")
		.setFirefoxOptions(options)
		.setFirefoxService(service)
		.build();
	assert(driver instanceof Driver);
	await driver.installAddon(EXTENSION_DIR, true);
	return driver;
}

async function prepareProfile(driver: Driver, tokens?: Tokens): Promise<void> {
	await driver.get(ORIGIN);
	await driver.setContext(Context.CHROME);
	const frame = `(() => {
		if (content.document.documentURI !== ${JSON.stringify(BACKGROUND_URL)}) return;
		Promise.resolve().then(async () => {
			const storage = content.wrappedJSObject.browser.storage.local;
			await storage.clear();
			await storage.set(${JSON.stringify(tokens ? { hutch_oauth_tokens: tokens } : {})});
			const saved = await storage.get('hutch_oauth_tokens');
			sendAsyncMessage('Readplace:Prepared', { authenticated: Boolean(saved.hutch_oauth_tokens) });
		}).catch(error => sendAsyncMessage('Readplace:Prepared', { error: String(error) }));
	})();`;
	await driver.executeScript(
		`
		window.__readplacePrepared = undefined;
		Services.mm.addMessageListener('Readplace:Prepared', message => { window.__readplacePrepared = message.data; });
		Services.mm.loadFrameScript(arguments[0], true);
		const { CustomizableUI } = ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs');
		CustomizableUI.addWidgetToArea('hutch-extension_hutch-app_com-browser-action', CustomizableUI.AREA_NAVBAR);
	`,
		`data:application/javascript,${encodeURIComponent(frame)}`,
	);
	const prepared = await until(
		async () =>
			(await driver.executeScript<{
				authenticated?: boolean;
				error?: string;
			} | null>("return window.__readplacePrepared;")) ?? undefined,
		"background storage preparation without opening the popup",
	);
	assert.equal(prepared.error, undefined);
	assert.equal(prepared.authenticated, Boolean(tokens));
}

function popupFrameScript(holdApplicationAssets: boolean): string {
	return `(() => {
		const popupUrl = ${JSON.stringify(POPUP_URL)};
		const report = data => sendAsyncMessage('Readplace:Popup', data);
		let hold = ${holdApplicationAssets};
		const pending = [];
		const inspect = () => {
			if (content.document.documentURI !== popupUrl) return;
			const document = content.document;
			const view = document.querySelector('#saving-view');
			const icon = document.querySelector('.saving-view__icon');
			const bars = Array.from(document.querySelectorAll('.saving-view__bar'));
			const placeholders = icon ? [icon, ...bars] : bars;
			const visible = document.visibilityState === 'visible';
			const skeletonVisible = Boolean(visible && view && !view.hidden && placeholders.length === 5 && placeholders.every(element => {
				const rect = element.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= content.innerWidth || rect.top >= content.innerHeight) return false;
				for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
					const style = content.getComputedStyle(ancestor);
					if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
				}
				const background = content.getComputedStyle(element).backgroundColor;
				return background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)';
			}));
			let skeletonDimensions;
			if (view && icon) {
				const rect = view.getBoundingClientRect();
				const iconRect = icon.getBoundingClientRect();
				skeletonDimensions = { width: rect.width, height: rect.height, iconWidth: iconRect.width, iconHeight: iconRect.height, bars: bars.map(bar => { const { width, height } = bar.getBoundingClientRect(); return { width, height }; }) };
			}
			const terminalView = ['login-view', 'list-view'].find(id => { const element = document.getElementById(id); return element && !element.hidden; });
			const applicationLoadStarted = content.performance.getEntriesByName('popup-first-frame')[0];
			const runtimeLoadStarted = content.performance.getEntriesByName('popup-runtime-load-started')[0];
			return { visible, shellVisible: document.body?.classList.contains('popup-shell') ?? false, skeletonVisible, skeletonDimensions, terminalView, documentLoadMs: content.performance.getEntriesByType('navigation')[0]?.loadEventEnd ?? 0, applicationLoadStartedAt: applicationLoadStarted === undefined ? undefined : content.performance.timeOrigin + applicationLoadStarted.startTime, runtimeLoadStartedAt: runtimeLoadStarted === undefined ? undefined : content.performance.timeOrigin + runtimeLoadStarted.startTime };
		};
		const listener = {
			QueryInterface: ChromeUtils.generateQI(['nsIWebProgressListener', 'nsISupportsWeakReference']),
			onStateChange(progress, request, flags) {
				if (!hold || !(flags & Ci.nsIWebProgressListener.STATE_START) || !request || !request.name.startsWith(${JSON.stringify(EXTENSION_ORIGIN)})) return;
				if (request.name === popupUrl || request.name === ${JSON.stringify(`${EXTENSION_ORIGIN}/popup/popup-entry.browser.js`)}) return;
				if (content.document.documentURI !== popupUrl) return;
				try {
					request.suspend();
					pending.push(request);
					report({ type: 'held', asset: new URL(request.name).pathname });
				} catch (error) { report({ type: 'error', error: String(error) }); }
			}
		};
		const progress = docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebProgress);
		progress.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_STATE_REQUEST);
		addMessageListener('Readplace:Release', () => {
			hold = false;
			progress.removeProgressListener(listener);
			for (const request of pending) request.resume();
			pending.length = 0;
		});
		addMessageListener('Readplace:Inspect', () => { const state = inspect(); if (state) report({ type: 'state', state }); });
		addEventListener('MozAfterPaint', event => {
			if (content.document.documentURI !== popupUrl || event.clientRects.length === 0) return;
			const state = inspect();
			report({ type: 'paint', firstPaintAt: content.performance.timeOrigin + event.paintTimeStamp, state });
		}, true);
	})();`;
}

async function installProbe(
	driver: Driver,
	holdApplicationAssets: boolean,
): Promise<void> {
	await driver.setContext(Context.CHROME);
	const frameUrl = `data:application/javascript,${encodeURIComponent(popupFrameScript(holdApplicationAssets))}`;
	await driver.executeScript(
		`
		window.__readplacePopup = { heldAssets: [], panelVisible: false };
		window.__readplaceFrameUrl = arguments[0];
		window.__readplacePanelShowingAt = undefined;
		document.addEventListener('popupshowing', event => {
			if (event.target.id === 'customizationui-widget-panel') window.__readplacePanelShowingAt = performance.timeOrigin + performance.now();
		}, true);
		Services.mm.addMessageListener('Readplace:Popup', message => {
			const data = message.data;
			const probe = window.__readplacePopup;
			if (data.type === 'error') probe.error = data.error;
			if (data.type === 'held') probe.heldAssets.push(data.asset);
			if (data.state) probe.state = data.state;
			const panel = message.target?.closest?.('panel');
			if (!panel || panel.id !== 'customizationui-widget-panel') return;
			const rect = panel.getBoundingClientRect();
			const style = getComputedStyle(panel);
			probe.panelVisible = ['showing', 'open'].includes(panel.state) && rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && Number(style.opacity) > 0;
			if (data.type === 'paint' && data.state.visible && probe.panelVisible && data.firstPaintAt >= window.__readplacePanelShowingAt && probe.firstPaintAt === undefined) {
				probe.firstPaintAt = data.firstPaintAt;
				probe.firstPaintState = data.state;
			}
		});
		Services.mm.loadFrameScript(arguments[0], true);
	`,
		frameUrl,
	);
}

async function readProbe(driver: Driver): Promise<Probe> {
	const probe = await driver.executeScript<Probe>(
		"Services.mm.broadcastAsyncMessage('Readplace:Inspect'); return window.__readplacePopup;",
	);
	assert.equal(probe.error, undefined, probe.error);
	return probe;
}

async function measure(input: {
	tokens?: Tokens;
	holdApplicationAssets: boolean;
}): Promise<Sample> {
	const profile = mkdtempSync(
		path.join(tmpdir(), "readplace-firefox-popup-perf-"),
	);
	let driver: Driver | undefined;
	try {
		driver = await launch(profile);
		await prepareProfile(driver, input.tokens);
		await driver.quit();
		driver = undefined;
		driver = await launch(profile);
		await driver.get(ORIGIN);
		const measuredDriver = driver;
		const browserVersion = (await driver.getCapabilities()).get(
			"browserVersion",
		) as string;
		await installProbe(driver, input.holdApplicationAssets);
		const requestedAt = await driver.executeScript<number>(`
			if (document.querySelector('browser[webextension-view-type="popup"]')) throw new Error('The measured process must not preload the popup');
			const button = document.querySelector('.webextension-browser-action[data-extensionid="${ADDON_ID}"]');
			if (!button || button.getBoundingClientRect().width === 0) throw new Error('The native toolbar action must be pinned');
			const requestedAt = performance.timeOrigin + performance.now();
			button.click();
			return requestedAt;
		`);
		let probe: Probe;
		let openedWhileApplicationAssetsHeld: boolean | undefined;
		let paintedWhileApplicationAssetsHeld: boolean | undefined;
		let skeletonVisible: boolean | undefined;
		let skeletonDimensions: SkeletonDimensions | undefined;
		let screenshot: string | undefined;
		if (input.holdApplicationAssets) {
			await until(async () => {
				const value = await readProbe(measuredDriver);
				return value.heldAssets.length ? value : undefined;
			}, "a popup application asset request");
			const deadline = performance.now() + HOLD_MS;
			do {
				probe = await readProbe(measuredDriver);
				if (
					probe.firstPaintAt !== undefined &&
					probe.panelVisible &&
					probe.state?.skeletonVisible
				)
					break;
				await delay(10);
			} while (performance.now() < deadline);
			openedWhileApplicationAssetsHeld = probe.panelVisible;
			paintedWhileApplicationAssetsHeld = probe.firstPaintAt !== undefined;
			skeletonVisible = probe.state?.skeletonVisible ?? false;
			skeletonDimensions = probe.state?.skeletonDimensions;
			if (paintedWhileApplicationAssetsHeld && skeletonVisible) {
				const capture = await driver.executeAsyncScript<string>(`
					const done = arguments[arguments.length - 1];
					const browser = Array.from(document.querySelectorAll('browser')).find(browser => browser.currentURI?.spec === ${JSON.stringify(POPUP_URL)});
					browser.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white').then(bitmap => {
						const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
						canvas.width = bitmap.width; canvas.height = bitmap.height;
						canvas.getContext('2d').drawImage(bitmap, 0, 0);
						done(canvas.toDataURL('image/png').split(',')[1]);
					});
				`);
				const directory = perfArtifactDirectory({
					root: getEnv("CI_ARTIFACT_ROOT"),
					runId: getEnv("GITHUB_RUN_ID"),
				});
				mkdirSync(directory, { recursive: true });
				screenshot = path.join(
					directory,
					`firefox-popup-skeleton-${input.tokens ? "signed-in" : "signed-out"}.png`,
				);
				writeFileSync(screenshot, Buffer.from(capture, "base64"));
			}
			await driver.executeScript(
				"Services.mm.removeDelayedFrameScript(window.__readplaceFrameUrl); Services.mm.broadcastAsyncMessage('Readplace:Release');",
			);
		}
		probe = await until(async () => {
			const value = await readProbe(measuredDriver);
			return value.firstPaintAt !== undefined ? value : undefined;
		}, "the native popup's first visible compositor paint");
		assert(probe.firstPaintAt !== undefined);
		const firstPaintMs = probe.firstPaintAt - requestedAt;
		assert(
			firstPaintMs >= 0,
			"The popup's first paint must follow the toolbar click",
		);
		const terminalView = input.tokens ? "list-view" : "login-view";
		const settled = await until(async () => {
			const value = await readProbe(measuredDriver);
			return value.state?.terminalView === terminalView ? value : undefined;
		}, terminalView);
		assert(settled.state);
		return {
			browserVersion,
			firstPaintMs,
			applicationLoadStartedMs:
				settled.state.applicationLoadStartedAt === undefined
					? undefined
					: settled.state.applicationLoadStartedAt - requestedAt,
			runtimeLoadStartedMs:
				settled.state.runtimeLoadStartedAt === undefined
					? undefined
					: settled.state.runtimeLoadStartedAt - requestedAt,
			firstPaintShellVisible: probe.firstPaintState?.shellVisible ?? false,
			firstPaintSkeletonVisible:
				probe.firstPaintState?.skeletonVisible ?? false,
			firstPaintSkeletonDimensions: probe.firstPaintState?.skeletonDimensions,
			documentLoadMs: settled.state.documentLoadMs,
			skeletonVisible,
			skeletonDimensions,
			heldAssets: probe.heldAssets,
			openedWhileApplicationAssetsHeld,
			paintedWhileApplicationAssetsHeld,
			screenshot,
			terminalView,
		};
	} finally {
		try {
			await driver?.quit();
		} finally {
			rmSync(profile, { recursive: true, force: true });
		}
	}
}

test("the first native popup paints its shell before loading the full application runtime", async (t) => {
	const records: Record<string, { held?: Sample; cold: Sample[] }> = {};
	await runPerfSuite({
		server: {
			port: TEST_PORT,
			readyUrl: `${ORIGIN}${readyProbePath(READY_NONCE)}`,
			serverEnv: { [READY_NONCE_ENV]: READY_NONCE },
			user: TEST_USER,
		},
		failsafeMs: SUITE_FAILSAFE_MS,
		diagnostic: (message) => t.diagnostic(message),
		measure: async () => {
			for (const auth of ["signed-out", "signed-in"]) {
				const tokens = auth === "signed-in" ? await obtainTokens() : undefined;
				const record: { held?: Sample; cold: Sample[] } = { cold: [] };
				records[auth] = record;
				await t.test(
					`${auth}: stalled application styles and runtime leave the native skeleton visible`,
					async () => {
						record.held = await measure({
							tokens,
							holdApplicationAssets: true,
						});
						t.diagnostic(
							`${auth}: held application assets first paint ${Math.round(record.held.firstPaintMs)}ms`,
						);
						assert(
							record.held.openedWhileApplicationAssetsHeld,
							`${auth}: Firefox kept the popup closed while application styles and runtime were held for ${HOLD_MS}ms`,
						);
						assert(
							record.held.paintedWhileApplicationAssetsHeld,
							`${auth}: the browser must paint the popup before its application assets are available`,
						);
						assert(
							record.held.skeletonVisible,
							`${auth}: the native popup must contain the skeleton before its application assets are available`,
						);
						assertSkeletonDimensions(record.held.skeletonDimensions);
						assert(
							record.held.firstPaintShellVisible,
							`${auth}: the first visible compositor paint must contain the initial popup shell while application assets are held`,
						);
						assert(
							record.held.firstPaintSkeletonVisible,
							`${auth}: the first visible compositor paint must contain the skeleton while application assets are held`,
						);
						assertSkeletonDimensions(record.held.firstPaintSkeletonDimensions);
					},
				);
				await t.test(
					`${auth}: every cold first paint fits the ${BUDGET_MS}ms visible feedback budget`,
					async () => {
						for (let sample = 0; sample < SAMPLES; sample++)
							record.cold.push(
								await measure({ tokens, holdApplicationAssets: false }),
							);
						const stats = summarizeLatency(
							record.cold.map((sample) => sample.firstPaintMs),
						);
						t.diagnostic(
							`${auth}: first popup paint ${record.cold.map((sample) => Math.round(sample.firstPaintMs)).join(", ")}ms; mean ${Math.round(stats.meanMs)}ms`,
						);
						assert(
							record.cold.every((sample) => sample.firstPaintShellVisible),
							`${auth}: the first visible compositor paint must contain the initial popup shell`,
						);
						assert(
							record.cold.every((sample) => sample.firstPaintSkeletonVisible),
							`${auth}: the first visible compositor paint must contain the skeleton`,
						);
						for (const sample of record.cold)
							assertSkeletonDimensions(sample.firstPaintSkeletonDimensions);
						assert(
							record.cold.every(
								(sample) =>
									sample.runtimeLoadStartedMs !== undefined &&
									sample.runtimeLoadStartedMs >= sample.firstPaintMs,
							),
							`${auth}: the browser must paint the skeleton before loading the full application runtime`,
						);
						assert(
							stats.maxMs < BUDGET_MS,
							`${auth}: slowest cold first popup paint took ${stats.maxMs.toFixed(1)}ms, exceeding the ${BUDGET_MS}ms visible feedback budget`,
						);
					},
				);
			}
		},
	});
	const directory = perfArtifactDirectory({
		root: getEnv("CI_ARTIFACT_ROOT"),
		runId: getEnv("GITHUB_RUN_ID"),
	});
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		path.join(directory, "firefox-popup-open-latency.json"),
		JSON.stringify(
			{
				schema: "popup-open-latency/firefox-v3",
				browser: "firefox",
				trigger: "native-toolbar-button.click",
				paintSignal: "MozAfterPaint.paintTimeStamp",
				startTimestamp: "browser-chrome-performance-before-click",
				budgetMetric: "firstPaintMs",
				budgetMs: BUDGET_MS,
				applicationAssetWaitDeadlineMs: HOLD_MS,
				samplesPerAuthState: SAMPLES,
				records,
			},
			null,
			"\t",
		),
	);
});
