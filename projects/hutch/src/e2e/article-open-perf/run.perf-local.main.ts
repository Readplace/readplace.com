import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pinCdnFixtures } from "@packages/e2e-harness";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";
import { getEnv, requireEnv } from "@packages/require-env";
import { type BrowserContext, type Page, chromium } from "@playwright/test";
import { perfSetting } from "browser-extension-core/perf";
import { z } from "zod";
import {
	ARTICLE_END_MARKER,
	ARTICLE_END_MARKER_SELECTOR,
	ARTICLE_FIXTURES,
	ARTICLE_OPEN_CONDITIONS,
	type ArticleSize,
	type OpenCondition,
	UNTHROTTLED,
	articleWordCount,
	buildArticleHtml,
	cpuThrottlingFor,
	networkEmulationFor,
} from "./article-open-conditions";
import {
	type ArticleOpenSample,
	type ConditionResult,
	articleOpenReportPaths,
	formatResultsTable,
	navigationKindOf,
	splitWarmup,
	summarizeArticleOpen,
	summarizeDocumentHop,
} from "./article-open-latency";
import { installArticleOpenProbe } from "./article-open-probe.browser";

declare global {
	interface Window {
		htmx?: unknown;
	}
}

const PORT = Number(requireEnv("E2E_PORT"));
const ORIGIN = `http://127.0.0.1:${PORT}`;
const READY_NONCE = randomUUID();
const MEASURED_PER_CONDITION = perfSetting("PERF_ARTICLE_OPEN_MEASURED");
const WARMUPS_PER_CONDITION = perfSetting("PERF_ARTICLE_OPEN_WARMUPS");
const OPENS_PER_CONDITION = MEASURED_PER_CONDITION + WARMUPS_PER_CONDITION;
const RUN_LABEL = requireEnv("PERF_ARTICLE_OPEN_LABEL");

const TITLE_SELECTOR = "a[data-test-article-title]";
const BODY_SELECTOR = "[data-article-body]";
const PENDING_KEY = "readplace.article-open.start";
const SEED_FETCHED_AT = "2026-01-15T10:00:00.000Z";
const SUITE_FAILSAFE_MS = 60 * 60 * 1000;
const SERVER_READY_TIMEOUT_MS = 180_000;
const OPEN_TIMEOUT_MS = 120_000;

const PERF_USER = {
	email: "article-open-perf@example.com",
	password: "testpassword123",
};

const CreatedUser = z.object({ ok: z.literal(true), userId: z.string() });
const SeededArticle = z.object({ ok: z.literal(true), articleId: z.string() });

function reapServerGroup(server: ChildProcess): void {
	if (server.pid === undefined || server.exitCode !== null) return;
	try {
		process.kill(-server.pid, "SIGKILL");
	} catch {
		server.kill("SIGKILL");
	}
}

function armSuiteFailsafe(server: ChildProcess): void {
	process.on("exit", () => reapServerGroup(server));
	setTimeout(() => {
		console.error(`suite failsafe: still running after ${SUITE_FAILSAFE_MS}ms`);
		reapServerGroup(server);
		process.exit(1);
	}, SUITE_FAILSAFE_MS).unref();
}

async function waitForServer(url: string): Promise<void> {
	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const answered = await fetch(url)
			.then((response) => response.status === 200)
			.catch(() => false);
		if (answered) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`the perf server never answered ${url}`);
}

/** The same server the extension perf suites run against: it accepts a save the
 * way production does instead of crawling inside the request. Started through
 * its nx target so the command it runs stays declared in one place. */
async function startPerfServer(): Promise<ChildProcess> {
	const server = spawn("pnpm", ["nx", "run", "hutch:perf-server"], {
		env: {
			...process.env,
			[READY_NONCE_ENV]: READY_NONCE,
			E2E_PORT: String(PORT),
			NODE_ENV: "test",
			NX_DAEMON: "false",
		},
		stdio: ["ignore", 2, 2],
		detached: true,
	});
	server.on("error", () => {});
	await waitForServer(`${ORIGIN}${readyProbePath(READY_NONCE)}`);
	return server;
}

async function stopPerfServer(server: ChildProcess): Promise<void> {
	if (server.exitCode !== null || server.pid === undefined) return;
	const pid = server.pid;
	const killGroup = (signal: NodeJS.Signals) => {
		try {
			process.kill(-pid, signal);
		} catch {
			server.kill(signal);
		}
	};
	await new Promise<void>((resolve) => {
		const settled = () => resolve();
		server.once("exit", settled);
		killGroup("SIGTERM");
		setTimeout(() => {
			killGroup("SIGKILL");
			server.off("exit", settled);
			resolve();
		}, 5_000).unref();
	});
}

async function postJson(url: string, body: unknown): Promise<unknown> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	assert.equal(response.status, 201, `POST ${url} answered ${response.status}`);
	return response.json();
}

async function seedArticle(input: {
	userId: string;
	size: ArticleSize;
	savedAt: string;
}): Promise<string> {
	const fixture = ARTICLE_FIXTURES[input.size];
	const seeded = await postJson(`${ORIGIN}/e2e/seed-crawled-article`, {
		url: `${ORIGIN}/e2e/article-open-perf/${input.size}`,
		title: `Article open perf — ${input.size}`,
		content: buildArticleHtml(fixture),
		contentFetchedAt: SEED_FETCHED_AT,
		savedByUserId: input.userId,
		wordCount: articleWordCount(fixture),
		savedAt: input.savedAt,
	});
	return SeededArticle.parse(seeded).articleId;
}

async function logIn(page: Page): Promise<void> {
	await page.goto(`${ORIGIN}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(PERF_USER.email);
	await page.locator("#password").fill(PERF_USER.password);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-queue");
}

/** htmx has to be live before the click or a boosted link falls back to a plain
 * navigation, which would silently measure the unboosted arm. Waiting costs the
 * unboosted arm nothing: the wait ends before the clock starts. */
async function openQueue(page: Page): Promise<void> {
	await page.goto(`${ORIGIN}/queue`, { waitUntil: "load" });
	await page.waitForFunction(() => window.htmx !== undefined);
}

async function measureOpen(page: Page, articleId: string): Promise<ArticleOpenSample> {
	await openQueue(page);
	await page.locator(`[data-test-article="${articleId}"] ${TITLE_SELECTOR}`).click();
	await page.waitForFunction(() => window.readplaceArticleOpen !== undefined, undefined, {
		timeout: OPEN_TIMEOUT_MS,
	});
	const sample = await page.evaluate(() => window.readplaceArticleOpen);
	assert.ok(sample, "the probe resolved without an article-open sample");
	assert.ok(
		Number.isFinite(sample.elapsedMs) && sample.elapsedMs > 0,
		`the probe reported an unusable elapsed time: ${sample.elapsedMs}`,
	);
	return sample;
}

async function measureCondition(input: {
	context: BrowserContext;
	page: Page;
	condition: OpenCondition;
	articleIds: Record<ArticleSize, string>;
	diagnostic: (message: string) => void;
}): Promise<{ result: ConditionResult; samples: ArticleOpenSample[] }> {
	const cdp = await input.context.newCDPSession(input.page);
	await cdp.send("Network.enable");
	await cdp.send("Emulation.setCPUThrottlingRate", cpuThrottlingFor(input.condition));
	await cdp.send("Network.emulateNetworkConditions", networkEmulationFor(input.condition));

	const samples: ArticleOpenSample[] = [];
	for (let sample = 0; sample < OPENS_PER_CONDITION; sample += 1) {
		samples.push(await measureOpen(input.page, input.articleIds[input.condition.article]));
	}

	await cdp.send("Emulation.setCPUThrottlingRate", UNTHROTTLED.cpu);
	await cdp.send("Network.emulateNetworkConditions", UNTHROTTLED.network);
	await cdp.detach();

	const navigation = navigationKindOf(samples);
	const { warmup, measured } = splitWarmup({
		samples,
		warmups: WARMUPS_PER_CONDITION,
	});
	const stats = summarizeArticleOpen(measured);
	const hop = summarizeDocumentHop(measured);
	input.diagnostic(
		`${input.condition.name}: ${navigation}, mean ${stats.meanMs.toFixed(1)}ms, ` +
			`sd ${stats.sdMs.toFixed(1)}ms, p50 ${stats.p50Ms.toFixed(1)}ms, ` +
			`p95 ${stats.p95Ms.toFixed(1)}ms, resolution ${stats.resolutionMs.toFixed(1)}ms ` +
			`over ${stats.count} opens ` +
			`(warm-ups discarded: ${warmup.map((entry) => Math.round(entry.elapsedMs)).join("ms, ")}ms)`,
	);
	return {
		result: { condition: input.condition.name, navigation, stats, hop },
		samples,
	};
}

function writeReport(input: {
	results: ConditionResult[];
	samples: Record<string, ArticleOpenSample[]>;
}): { samples: string; table: string } {
	const reportPaths = articleOpenReportPaths({
		root: getEnv("CI_ARTIFACT_ROOT"),
		runId: getEnv("GITHUB_RUN_ID"),
		label: RUN_LABEL,
	});
	fs.mkdirSync(path.dirname(reportPaths.samples), { recursive: true });
	fs.writeFileSync(
		reportPaths.samples,
		JSON.stringify(
			{
				schema: "article-open-latency/v2",
				label: RUN_LABEL,
				measuredPerCondition: MEASURED_PER_CONDITION,
				warmupsPerCondition: WARMUPS_PER_CONDITION,
				conditions: ARTICLE_OPEN_CONDITIONS,
				results: input.results,
				samples: input.samples,
			},
			null,
			"\t",
		),
	);
	fs.writeFileSync(
		reportPaths.table,
		`# Article open latency — ${RUN_LABEL}\n\n${formatResultsTable(input.results)}\n`,
	);
	return reportPaths;
}

test("article open from the queue, measured across cpu and network conditions", async (t) => {
	const server = await startPerfServer();
	armSuiteFailsafe(server);
	try {
		const userId = CreatedUser.parse(
			await postJson(`${ORIGIN}/e2e/users`, PERF_USER),
		).userId;
		const articleIds: Record<ArticleSize, string> = {
			small: await seedArticle({
				userId,
				size: "small",
				savedAt: "2026-01-15T10:00:00.000Z",
			}),
			large: await seedArticle({
				userId,
				size: "large",
				savedAt: "2026-01-15T11:00:00.000Z",
			}),
		};

		const browser = await chromium.launch({
			headless: getEnv("HEADLESS") !== "false",
		});
		try {
			const context = await browser.newContext();
			await pinCdnFixtures(context);
			const page = await context.newPage();
			await page.addInitScript(installArticleOpenProbe, {
				pendingKey: PENDING_KEY,
				titleSelector: TITLE_SELECTOR,
				bodySelector: BODY_SELECTOR,
				endMarkerSelector: ARTICLE_END_MARKER_SELECTOR,
				endMarkerText: ARTICLE_END_MARKER,
			});
			await logIn(page);

			const results: ConditionResult[] = [];
			const samples: Record<string, ArticleOpenSample[]> = {};
			for (const condition of ARTICLE_OPEN_CONDITIONS) {
				const measured = await measureCondition({
					context,
					page,
					condition,
					articleIds,
					diagnostic: (message) => t.diagnostic(message),
				});
				results.push(measured.result);
				samples[condition.name] = measured.samples;
			}
			for (const line of formatResultsTable(results).split("\n")) t.diagnostic(line);
			const reportPaths = writeReport({ results, samples });
			t.diagnostic(`table: ${reportPaths.table}`);
			t.diagnostic(`samples: ${reportPaths.samples}`);
		} finally {
			await browser.close();
		}
	} finally {
		await stopPerfServer(server);
	}
});
