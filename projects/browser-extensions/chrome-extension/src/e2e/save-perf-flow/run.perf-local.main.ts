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
import { SAVE_RENDERED_MARK } from "browser-extension-core";
import {
	SAVE_LATENCY_BUDGET_MS,
	latencyReportPath,
	summarizeLatency,
} from "browser-extension-core/perf";
import { getEnv, requireEnv } from "@packages/require-env";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";

const EXTENSION_DIR = path.resolve(__dirname, "../../../dist-extension-compiled");
const CFT_PATH_FILE = path.resolve(__dirname, "../../../.cache/chrome/binary-path");
const CFT_DRIVER_PATH_FILE = path.resolve(__dirname, "../../../.cache/chrome/driver-path");

const TEST_EMAIL = "save-perf-e2e-test@example.com";
const TEST_PASSWORD = "testpassword123";
const TEST_PORT = Number(requireEnv("E2E_PORT"));
const READY_NONCE = randomUUID();
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;

/** Warm-ups are measured and reported but never gated: the first saves after a
 * browser launch carry extension start-up, the token mint the login just did,
 * and an entry point no ETag has been issued for yet. The cold request shape is
 * what regresses, and the simulated-network suite gates that deterministically;
 * gating a Rosetta-emulated cold start would measure the runner. */
const WARMUP_SAVES = 2;
const GATED_SAVES = 20;

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

/** `hutch:perf-server` accepts a save the way production does — state reads and
 * a published event — where `hutch:e2e-server` crawls and parses the article
 * inside the request, which would make this suite a measurement of the crawler. */
async function startPerfServer(): Promise<ChildProcess> {
	const child = spawn("pnpm", ["nx", "run", "hutch:perf-server"], {
		env: {
			...process.env,
			E2E_PORT: String(TEST_PORT),
			[READY_NONCE_ENV]: READY_NONCE,
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		stdio: ["ignore", 2, 2],
		detached: true,
	});
	child.on("error", () => {});
	await waitForServer(`${ORIGIN}${readyProbePath(READY_NONCE)}`);
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

async function stopPerfServer(child: ChildProcess): Promise<void> {
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

async function readSavedViewMark(
	driver: WebDriver,
): Promise<{ marks: number; elapsedMs: number } | null> {
	const raw = await driver.executeScript(
		`const entries = performance.getEntriesByName(${JSON.stringify(SAVE_RENDERED_MARK)});` +
			"return entries.length === 0 ? [] : [entries.length, entries[0].startTime];",
	);
	assert.ok(Array.isArray(raw), "the saved-view probe must answer with an array");
	if (raw.length === 0) return null;
	const [marks, elapsedMs] = raw.map(Number);
	return { marks, elapsedMs };
}

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
	target: { popupUrl: string; url: string; title: string },
): Promise<number> {
	const query = `url=${encodeURIComponent(target.url)}&title=${encodeURIComponent(target.title)}`;
	await driver.get(`${target.popupUrl}?${query}`);

	const rendered = await waitForUi(
		driver,
		() => readSavedViewMark(driver),
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
	input: { popupUrl: string; runId: string; count: number; label: string },
): Promise<number[]> {
	const samplesMs: number[] = [];
	for (let sample = 0; sample < input.count; sample += 1) {
		samplesMs.push(
			await measureSave(driver, {
				popupUrl: input.popupUrl,
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
		suite: "chrome",
	});
	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	fs.writeFileSync(
		reportPath,
		JSON.stringify(
			{
				schema: "save-latency/v1",
				browser: "chrome",
				budgetMs: SAVE_LATENCY_BUDGET_MS,
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
test(`a save paints the saved view in under ${SAVE_LATENCY_BUDGET_MS}ms on average`, async (t) => {
	const server = await startPerfServer();
	armSuiteFailsafe(server);
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
					(err.message.includes("ECONNREFUSED") ||
						err.message.includes("Chrome instance exited") ||
						err.name === "TimeoutError");
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
		options.addArguments("--headless=new");
	}
	options.addArguments(`--load-extension=${EXTENSION_DIR}`);
	options.addArguments("--disable-search-engine-choice-screen");
	options.addArguments("--no-sandbox"); // CI container has no user namespace; without this Chrome exits immediately
	options.addArguments("--disable-dev-shm-usage"); // CI runners have a small /dev/shm partition; without this Chrome crashes with ECONNREFUSED
	if (getEnv("PERF_GPU") !== "true") {
		options.addArguments("--disable-gpu"); // CI runners have no GPU drivers; the GPU process crashes intermittently in headless mode
	}

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
		const runId = randomUUID().replace(/-/g, "");

		await logIn(driver, popupUrl);

		const warmupMs = await measureSaves(driver, {
			popupUrl,
			runId,
			count: WARMUP_SAVES,
			label: "warmup",
		});
		const samplesMs = await measureSaves(driver, {
			popupUrl,
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
			stats.meanMs < SAVE_LATENCY_BUDGET_MS,
			`a save took ${Math.round(stats.meanMs)}ms on average, over the ${SAVE_LATENCY_BUDGET_MS}ms budget`,
		);
	} finally {
		await driver.quit();
	}
}
