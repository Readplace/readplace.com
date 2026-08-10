import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Builder, type WebDriver } from "selenium-webdriver";
import { Options, Driver, ServiceBuilder } from "selenium-webdriver/firefox";
import {
	waitForSaveAllUi,
	SAVE_ALL_SUITE_FAILSAFE_MS,
	PERF_TAB_HOST,
	startTabPageServer,
	closeOtherTabs,
	openPerfTabs,
	retargetPerfTabs,
	waitForPerfTabsReady,
	assertTabCaptures,
	seedPendingBulkSave,
	readRenderedMark,
	perfTabUrls,
	runPerfSuite,
	logInToPopup,
	assertGeckodriverSupportsSystemAccess,
} from "browser-extension-core/e2e-actions";
import { SAVE_ALL_RENDERED_MARK } from "browser-extension-core";
import {
	assertWithinBudget,
	perfSetting,
	latencyReportPath,
	summarizeLatency,
} from "browser-extension-core/perf";
import { getEnv, requireEnv } from "@packages/require-env";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";

const BUDGET_MS = perfSetting("PERF_MEAN_SAVE_ALL_BUDGET_MS");
const TABS_PER_SAVE_ALL = perfSetting("PERF_TABS_PER_SAVE_ALL");
const WARMUP_SAVE_ALLS = perfSetting("PERF_WARMUP_SAVE_ALLS");
const GATED_SAVE_ALLS = perfSetting("PERF_GATED_SAVE_ALLS");

const ADDON_ID = "hutch-extension@hutch-app.com";
const ADDON_UUID = "d3b07384-d113-4ec6-a7b8-5f7e3b4c9a12";
const EXTENSION_DIR = path.resolve(__dirname, "../../../dist-extension-compiled");
const POPUP_URL = `moz-extension://${ADDON_UUID}/popup/popup.template.html`;

const TEST_USER = {
	email: "save-all-perf-e2e-test@example.com",
	password: "testpassword123",
};
const TEST_PORT = Number(requireEnv("E2E_PORT"));
const READY_NONCE = randomUUID();
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

async function readBulkSummary(driver: WebDriver): Promise<string> {
	const raw = await driver.executeScript(
		'const el = document.querySelector("[data-test-save-all-summary]");' +
			"return el === null ? null : el.textContent;",
	);
	assert.equal(
		typeof raw,
		"string",
		"the bulk save view must carry a summary line once it has painted",
	);
	return String(raw);
}

/**
 * One sample: re-point every perf tab at a URL no save has seen, arm the flag
 * the background sets before it opens the popup, then open the popup and read
 * back the moment it painted the bulk outcome. The sample spans the popup's own
 * boot, enumerating the window, capturing every tab, and every chunked request.
 */
async function measureSaveAll(
	driver: WebDriver,
	input: {
		tabIds: number[];
		origin: string;
		runId: string;
		label: string;
		sample: number;
	},
): Promise<number> {
	const urls = perfTabUrls({
		origin: input.origin,
		runId: input.runId,
		label: input.label,
		sample: input.sample,
		count: input.tabIds.length,
	});
	await retargetPerfTabs(driver, { tabIds: input.tabIds, urls });
	await waitForPerfTabsReady(driver, { urls });
	await seedPendingBulkSave(driver);

	await driver.get(`${POPUP_URL}?sample=${input.label}-${input.sample}`);

	const rendered = await waitForSaveAllUi(
		driver,
		() => readRenderedMark(driver, SAVE_ALL_RENDERED_MARK),
		`the popup never painted a bulk outcome for ${input.label} sample ${input.sample}`,
	);

	assert.ok(rendered, "the bulk outcome probe resolved without a mark");
	assert.equal(
		rendered.marks,
		1,
		`a sample must be measured against a freshly navigated popup, saw ${rendered.marks} marks`,
	);
	assert.ok(
		Number.isFinite(rendered.elapsedMs) && rendered.elapsedMs > 0,
		`the bulk outcome reported an unusable timestamp: ${rendered.elapsedMs}`,
	);

	/** The window holds the perf tabs plus the popup's own tab, which is not an
	 * http(s) page and so is the one client-side skip. Asserting the counts is
	 * what proves the timing came from saving every tab rather than from a flow
	 * that found nothing to save. */
	assert.equal(
		await readBulkSummary(driver),
		`Saved ${input.tabIds.length} · Skipped 1`,
		"the bulk save must have saved every perf tab",
	);
	return rendered.elapsedMs;
}

async function measureSaveAlls(
	driver: WebDriver,
	input: {
		tabIds: number[];
		origin: string;
		runId: string;
		count: number;
		label: string;
	},
): Promise<number[]> {
	const samplesMs: number[] = [];
	for (let sample = 0; sample < input.count; sample += 1) {
		samplesMs.push(
			await measureSaveAll(driver, {
				tabIds: input.tabIds,
				origin: input.origin,
				runId: input.runId,
				label: input.label,
				sample,
			}),
		);
	}
	return samplesMs;
}

function writeReport(input: { warmupMs: number[]; samplesMs: number[] }): string {
	const reportPath = latencyReportPath({
		root: getEnv("CI_ARTIFACT_ROOT"),
		runId: getEnv("GITHUB_RUN_ID"),
		suite: "firefox-save-all",
	});
	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	fs.writeFileSync(
		reportPath,
		JSON.stringify(
			{
				schema: "save-all-latency/v1",
				browser: "firefox",
				budgetMs: BUDGET_MS,
				tabsPerSaveAll: TABS_PER_SAVE_ALL,
				warmupMs: input.warmupMs,
				samplesMs: input.samplesMs,
				stats: summarizeLatency(input.samplesMs),
			},
			null,
			"\t",
		),
	);
	return reportPath;
}

test(`saving ${TABS_PER_SAVE_ALL} tabs paints the outcome in under ${BUDGET_MS}ms on average`, async (t) => {
	await runPerfSuite({
		server: {
			port: TEST_PORT,
			readyUrl: `${ORIGIN}${readyProbePath(READY_NONCE)}`,
			serverEnv: { [READY_NONCE_ENV]: READY_NONCE },
			user: TEST_USER,
		},
		failsafeMs: SAVE_ALL_SUITE_FAILSAFE_MS,
		diagnostic: (message) => t.diagnostic(message),
		measure: () => runTest(t),
	});
});

async function runTest(t: { diagnostic: (message: string) => void }) {
	const tabServer = await startTabPageServer();
	try {
		const options = new Options();
		if (getEnv("HEADLESS") !== "false") {
			options.addArguments("--headless");
		}
		options.setPreference(
			"extensions.webextensions.uuids",
			JSON.stringify({ [ADDON_ID]: ADDON_UUID }),
		);
		/** Resolves the perf tab host to loopback in-process, the way Chrome's
		 * host-resolver-rules does, so the tabs are served locally under a name
		 * `isAppUrl` does not read as one of the app's own pages. */
		options.setPreference("network.dns.localDomains", PERF_TAB_HOST);

		assertGeckodriverSupportsSystemAccess();
		const driver = await new Builder()
			.forBrowser("firefox")
			.setFirefoxOptions(options)
			.setFirefoxService(new ServiceBuilder().addArguments("--allow-system-access")) // Firefox 153 refuses WebDriver navigation to moz-extension:// without it
			.build();

		try {
			assert(driver instanceof Driver, "firefox builder must produce a firefox Driver");
			await driver.installAddon(EXTENSION_DIR, true);

			const runId = randomUUID().replace(/-/g, "");
			await logInToPopup({ driver, popupUrl: POPUP_URL, user: TEST_USER });
			await closeOtherTabs(driver);
			const openUrls = perfTabUrls({
				origin: tabServer.origin,
				runId,
				label: "open",
				sample: 0,
				count: TABS_PER_SAVE_ALL,
			});
			const tabIds = await openPerfTabs(driver, openUrls);
			await waitForPerfTabsReady(driver, { urls: openUrls });
			await assertTabCaptures(driver, tabIds[0]);

			const warmupMs = await measureSaveAlls(driver, {
				tabIds,
				origin: tabServer.origin,
				runId,
				count: WARMUP_SAVE_ALLS,
				label: "warmup",
			});
			const samplesMs = await measureSaveAlls(driver, {
				tabIds,
				origin: tabServer.origin,
				runId,
				count: GATED_SAVE_ALLS,
				label: "sample",
			});

			const reportPath = writeReport({ warmupMs, samplesMs });
			const stats = summarizeLatency(samplesMs);
			t.diagnostic(`warm-ups: ${warmupMs.map(Math.round).join("ms, ")}ms`);
			t.diagnostic(
				`mean ${Math.round(stats.meanMs)}ms, p50 ${Math.round(stats.p50Ms)}ms, ` +
					`p95 ${Math.round(stats.p95Ms)}ms, slowest ${Math.round(stats.maxMs)}ms ` +
					`over ${stats.count} saves of ${TABS_PER_SAVE_ALL} tabs`,
			);
			t.diagnostic(`report: ${reportPath}`);

			assertWithinBudget({
				what: `saving ${TABS_PER_SAVE_ALL} tabs`,
				meanMs: stats.meanMs,
				budgetMs: BUDGET_MS,
			});
		} finally {
			await driver.quit();
		}
	} finally {
		await tabServer.close();
	}
}
