import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Builder, type WebDriver } from "selenium-webdriver";
import { Options, Driver } from "selenium-webdriver/firefox";
import {
	waitForUi,
	SUITE_FAILSAFE_MS,
	readRenderedMark,
	armSuiteFailsafe,
	startPerfServer,
	stopPerfServer,
	logInToPopup,
} from "browser-extension-core/e2e-actions";
import { SAVE_RENDERED_MARK } from "browser-extension-core";
import {
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

/**
 * One sample: open the popup on a link it has never seen, and read back the
 * moment it painted the saved view. Both ends of the measurement are taken
 * in-page — `performance.timeOrigin` is this document's navigation start, and
 * the mark is set the instant the saved view is shown — so a sample carries the
 * popup's own boot, the message to the background, the save, and the render,
 * with none of the WebDriver round trips the harness spends observing it.
 */
async function measureSave(
	driver: WebDriver,
	target: { url: string; title: string },
): Promise<number> {
	const query = `url=${encodeURIComponent(target.url)}&title=${encodeURIComponent(target.title)}`;
	await driver.get(`${POPUP_URL}?${query}`);

	const rendered = await waitForUi(
		driver,
		() => readRenderedMark(driver, SAVE_RENDERED_MARK),
		`the popup never painted a saved view for ${target.url}`,
	);

	assert.ok(rendered, `the saved-view probe resolved without a mark for ${target.url}`);
	assert.equal(
		rendered.marks,
		1,
		`a sample must be measured against a freshly navigated popup, saw ${rendered.marks} marks`,
	);
	assert.ok(
		Number.isFinite(rendered.elapsedMs) && rendered.elapsedMs > 0,
		`the saved view reported an unusable timestamp: ${rendered.elapsedMs}`,
	);
	return rendered.elapsedMs;
}

async function measureSaves(
	driver: WebDriver,
	input: { runId: string; count: number; label: string },
): Promise<number[]> {
	const samplesMs: number[] = [];
	for (let sample = 0; sample < input.count; sample += 1) {
		samplesMs.push(
			await measureSave(driver, {
				url: `https://example.com/perf/${input.runId}/${input.label}/${sample}`,
				title: `Save perf ${input.label} ${sample}`,
			}),
		);
	}
	return samplesMs;
}

function writeReport(input: { warmupMs: number[]; samplesMs: number[] }): string {
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
			},
			null,
			"\t",
		),
	);
	return reportPath;
}

const MAX_ATTEMPTS = 3;
test(`a save paints the saved view in under ${BUDGET_MS}ms on average`, async (t) => {
	const server: ChildProcess = await startPerfServer({
		port: TEST_PORT,
		readyUrl: `${ORIGIN}${readyProbePath(READY_NONCE)}`,
		serverEnv: { [READY_NONCE_ENV]: READY_NONCE },
		user: TEST_USER,
	});
	armSuiteFailsafe({ server, failsafeMs: SUITE_FAILSAFE_MS });
	try {
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				await runTest(t);
				return;
			} catch (err) {
				/** A missed budget is the result, never a flake: only a browser or
				 * server that failed to come up is worth another attempt. */
				const isRetryable =
					err instanceof Error &&
					err.name !== "AssertionError" &&
					(err.message.includes("ECONNREFUSED") || err.name === "TimeoutError");
				if (!isRetryable || attempt === MAX_ATTEMPTS) throw err;
			}
		}
	} finally {
		await stopPerfServer(server);
	}
});

async function runTest(t: { diagnostic: (message: string) => void }) {
	const options = new Options();
	if (getEnv("HEADLESS") !== "false") {
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
		assert(driver instanceof Driver, "firefox builder must produce a firefox Driver");
		await driver.installAddon(EXTENSION_DIR, true);

		const runId = randomUUID().replace(/-/g, "");
		await logInToPopup({ driver, popupUrl: POPUP_URL, user: TEST_USER });

		const warmupMs = await measureSaves(driver, {
			runId,
			count: WARMUP_SAVES,
			label: "warmup",
		});
		const samplesMs = await measureSaves(driver, {
			runId,
			count: GATED_SAVES,
			label: "sample",
		});

		const reportPath = writeReport({ warmupMs, samplesMs });
		const stats = summarizeLatency(samplesMs);
		t.diagnostic(`warm-ups: ${warmupMs.map(Math.round).join("ms, ")}ms`);
		t.diagnostic(
			`mean ${Math.round(stats.meanMs)}ms, p50 ${Math.round(stats.p50Ms)}ms, ` +
				`p95 ${Math.round(stats.p95Ms)}ms, slowest ${Math.round(stats.maxMs)}ms over ${stats.count} saves`,
		);
		t.diagnostic(`report: ${reportPath}`);

		assert.ok(
			stats.meanMs < BUDGET_MS,
			`a save took ${Math.round(stats.meanMs)}ms on average, over the ${BUDGET_MS}ms budget`,
		);
	} finally {
		await driver.quit();
	}
}
