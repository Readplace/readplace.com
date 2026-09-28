import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Builder, type WebDriver } from "selenium-webdriver";
import { Driver } from "selenium-webdriver/firefox";
import {
	waitForUi,
	SUITE_FAILSAFE_MS,
	readRenderedMark,
	runPerfSuite,
	logInToPopup,
	assertGeckodriverSupportsSystemAccess,
	createFirefoxBrowser,
} from "browser-extension-core/e2e-actions";
import { SAVE_RENDERED_MARK, POPUP_FIRST_FRAME_MARK } from "browser-extension-core";
import {
	assertWithinBudget,
	perfSetting,
	latencyReportPath,
	summarizeLatency,
} from "browser-extension-core/perf";
import { getEnv, requireEnv } from "@packages/require-env";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";

const BUDGET_MS = perfSetting("PERF_MEAN_SAVE_BUDGET_MS");

const ADDON_ID = "hutch-extension@hutch-app.com";
const ADDON_UUID = "d3b07384-d113-4ec6-a7b8-5f7e3b4c9a12";
const EXTENSION_DIR = path.resolve(__dirname, "../../../dist-extension-compiled");
const POPUP_URL = `moz-extension://${ADDON_UUID}/popup/popup.template.html`;

const TEST_USER = {
	email: "save-perf-e2e-test@example.com",
	password: "testpassword123",
};
const TEST_PORT = Number(requireEnv("E2E_PORT"));
const READY_NONCE = randomUUID();
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

/** Warm-ups are measured and reported but never gated: the first saves after a
 * browser launch carry extension start-up, the token mint the login just did,
 * and an entry point no ETag has been issued for yet. The cold request shape is
 * what regresses, and the simulated-network suite gates that deterministically. */
const WARMUP_SAVES = perfSetting("PERF_WARMUP_SAVES");
const GATED_SAVES = perfSetting("PERF_GATED_SAVES");

async function readMark(
	driver: WebDriver,
	input: { mark: string; url: string; label: string },
): Promise<number> {
	const rendered = await waitForUi(
		driver,
		() => readRenderedMark(driver, input.mark),
		`the popup never marked its ${input.label} for ${input.url}`,
	);

	assert.ok(rendered, `the ${input.label} probe resolved without a mark for ${input.url}`);
	assert.equal(
		rendered.marks,
		1,
		`a sample must be measured against a freshly navigated popup, saw ${rendered.marks} ${input.label} marks for ${input.url}`,
	);
	assert.ok(
		Number.isFinite(rendered.elapsedMs) && rendered.elapsedMs > 0,
		`the ${input.label} reported an unusable timestamp for ${input.url}: ${rendered.elapsedMs}`,
	);
	return rendered.elapsedMs;
}

/**
 * One sample: open the popup on a link it has never seen, and read back the
 * moment its first frame painted and the moment it painted the saved view. Both
 * ends of each measurement are taken in-page — `performance.timeOrigin` is this
 * document's navigation start, and each mark is set the instant its frame is on
 * screen — so a sample carries the popup's own boot, the message to the
 * background, the save, and the render, with none of the WebDriver round trips
 * the harness spends observing it.
 */
async function measureSave(
	driver: WebDriver,
	target: { url: string; title: string },
): Promise<{ savedMs: number; firstFrameMs: number }> {
	const query = `url=${encodeURIComponent(target.url)}&title=${encodeURIComponent(target.title)}`;
	await driver.get(`${POPUP_URL}?${query}`);

	const savedMs = await readMark(driver, {
		mark: SAVE_RENDERED_MARK,
		url: target.url,
		label: "saved view",
	});
	const firstFrameMs = await readMark(driver, {
		mark: POPUP_FIRST_FRAME_MARK,
		url: target.url,
		label: "first frame",
	});
	return { savedMs, firstFrameMs };
}

async function measureSaves(
	driver: WebDriver,
	input: { runId: string; count: number; label: string },
): Promise<{ savedMs: number; firstFrameMs: number }[]> {
	const samples: { savedMs: number; firstFrameMs: number }[] = [];
	for (let sample = 0; sample < input.count; sample += 1) {
		samples.push(
			await measureSave(driver, {
				url: `https://example.com/perf/${input.runId}/${input.label}/${sample}`,
				title: `Save perf ${input.label} ${sample}`,
			}),
		);
	}
	return samples;
}

function writeReport(input: {
	warmupMs: number[];
	samplesMs: number[];
	firstFrameWarmupMs: number[];
	firstFrameSamplesMs: number[];
}): string {
	const reportPath = latencyReportPath({
		root: getEnv("CI_ARTIFACT_ROOT"),
		runId: getEnv("GITHUB_RUN_ID"),
		suite: "firefox",
	});
	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	fs.writeFileSync(
		reportPath,
		JSON.stringify(
			{
				schema: "save-latency/v1",
				browser: "firefox",
				budgetMs: BUDGET_MS,
				warmupMs: input.warmupMs,
				samplesMs: input.samplesMs,
				stats: summarizeLatency(input.samplesMs),
				firstFrameWarmupMs: input.firstFrameWarmupMs,
				firstFrameSamplesMs: input.firstFrameSamplesMs,
				firstFrameStats: summarizeLatency(input.firstFrameSamplesMs),
			},
			null,
			"\t",
		),
	);
	return reportPath;
}

test(`a save paints the saved view in under ${BUDGET_MS}ms on average`, async (t) => {
	await runPerfSuite({
		server: {
			port: TEST_PORT,
			readyUrl: `${ORIGIN}${readyProbePath(READY_NONCE)}`,
			serverEnv: { [READY_NONCE_ENV]: READY_NONCE },
			user: TEST_USER,
		},
		failsafeMs: SUITE_FAILSAFE_MS,
		diagnostic: (message) => t.diagnostic(message),
		measure: () => runTest(t),
	});
});

async function runTest(t: { diagnostic: (message: string) => void }) {
	const { options, service } = createFirefoxBrowser({ ci: getEnv("CI") === "true" });
	if (getEnv("HEADLESS") !== "false") {
		options.addArguments("--headless");
	}
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

	try {
		assert(driver instanceof Driver, "firefox builder must produce a firefox Driver");
		await driver.installAddon(EXTENSION_DIR, true);

		const runId = randomUUID().replace(/-/g, "");
		await logInToPopup({ driver, popupUrl: POPUP_URL, user: TEST_USER });

		const warmup = await measureSaves(driver, {
			runId,
			count: WARMUP_SAVES,
			label: "warmup",
		});
		const samples = await measureSaves(driver, {
			runId,
			count: GATED_SAVES,
			label: "sample",
		});

		const warmupMs = warmup.map((sample) => sample.savedMs);
		const samplesMs = samples.map((sample) => sample.savedMs);
		const firstFrameWarmupMs = warmup.map((sample) => sample.firstFrameMs);
		const firstFrameSamplesMs = samples.map((sample) => sample.firstFrameMs);

		const reportPath = writeReport({
			warmupMs,
			samplesMs,
			firstFrameWarmupMs,
			firstFrameSamplesMs,
		});
		const stats = summarizeLatency(samplesMs);
		const firstFrameStats = summarizeLatency(firstFrameSamplesMs);
		t.diagnostic(
			`warm-ups: saved ${warmupMs.map(Math.round).join("ms, ")}ms; ` +
				`first frame ${firstFrameWarmupMs.map(Math.round).join("ms, ")}ms`,
		);
		t.diagnostic(
			`saved view: mean ${Math.round(stats.meanMs)}ms, p50 ${Math.round(stats.p50Ms)}ms, ` +
				`p95 ${Math.round(stats.p95Ms)}ms, slowest ${Math.round(stats.maxMs)}ms over ${stats.count} saves`,
		);
		t.diagnostic(
			`first frame: mean ${Math.round(firstFrameStats.meanMs)}ms, p50 ${Math.round(firstFrameStats.p50Ms)}ms, ` +
				`p95 ${Math.round(firstFrameStats.p95Ms)}ms, slowest ${Math.round(firstFrameStats.maxMs)}ms over ${firstFrameStats.count} opens`,
		);
		t.diagnostic(`report: ${reportPath}`);

		assertWithinBudget({
			what: "a save",
			meanMs: stats.meanMs,
			budgetMs: BUDGET_MS,
		});
	} finally {
		await driver.quit();
	}
}
