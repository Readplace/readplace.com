/* c8 ignore start -- staging-only perf harness, never run under the local suite */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireEnv } from "@packages/require-env";
import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";
import { splitWarmup } from "../article-open-perf/article-open-latency";
import { deletePerfUser, dismissOnboarding, perfUserFor, signUpPerfUser } from "./perf-user";
import {
	type ControlProbe,
	type OpResult,
	type ScreenResponseBudgets,
	type ScreenResponseSample,
	budgetVerdict,
	controlProbeOf,
	formatResultsTable,
	missingOpResults,
	navigationKindOf,
	readBudgets,
	screenResponseReportPaths,
	summarizePhases,
	summarizeScreenResponse,
} from "./screen-response-latency";
import {
	QUEUES_TRIGGER,
	QUEUE_COUNTS,
	QUEUE_NAV,
	type NavigationKind,
	type ScreenResponseOp,
	type ScreenResponseOpId,
	assignButton,
	assignOp,
	backToQueueOp,
	openArticleOp,
	queueNavLink,
	queueSwitchOp,
	queueTag,
	tabSwitchOp,
	terminalCard,
	unassignButton,
} from "./screen-response-ops";
import { installScreenResponseProbe } from "./screen-response-probe.browser";
import {
	type SeededDataset,
	assertNoRepeatingPollers,
	queueUrl,
	readerUrl,
	seedPerfDataset,
} from "./seed";

const PROBE_KEYS = {
	armKey: "readplace.screen-response.arm",
	pendingKey: "readplace.screen-response.pending",
	offClockSelector: QUEUE_COUNTS,
};

const SAMPLE_TIMEOUT_MS = 60_000;
const OP_TIMEOUT_MS = 12 * 60 * 1000;
const SETUP_TIMEOUT_MS = 20 * 60 * 1000;
const CONTROL_PROBE_PATH = "/embed/icon.svg";

const RUN_ID = randomUUID();
const BASE_URL = requireEnv("STAGING_URL");
const REPORT_SHA = requireEnv("PERF_SCREEN_RESPONSE_SHA");
const OUTPUT_ROOT = path.resolve(__dirname, "..", "..", "..", "test-results-staging");

let budgets: ScreenResponseBudgets;
let dataset: SeededDataset;
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
let controlAtStartMs: number[] = [];
let controlAtEndMs: number[] = [];
let remeasuresUsed = 0;
const results: OpResult[] = [];
const collectedSamples: Record<string, ScreenResponseSample[]> = {};

function say(message: string): void {
	process.stdout.write(`${message}\n`);
}

function phaseFailure(phase: string, cause: unknown): Error {
	const detail = cause instanceof Error ? cause.message : String(cause);
	return new Error(
		`${phase} FAILURE (not a budget breach — no operation was gated on this): ${detail}`,
		cause instanceof Error ? { cause } : undefined,
	);
}

async function newPerfContext(browser: Browser): Promise<BrowserContext> {
	const context = await browser.newContext({ storageState });
	await context.addInitScript(installScreenResponseProbe, PROBE_KEYS);
	return context;
}

function countsSettled(page: Page): Promise<unknown> {
	return page.waitForResponse((response) => response.url().includes("/queue/counts"), {
		timeout: SAMPLE_TIMEOUT_MS,
	});
}

async function openListing(input: { page: Page; url: string }): Promise<void> {
	const counts = countsSettled(input.page);
	await input.page.goto(input.url, { waitUntil: "load" });
	await expect(input.page.locator(QUEUE_NAV)).toHaveCount(1);
	await counts;
	await input.page.waitForFunction(() => "htmx" in window, undefined, {
		timeout: SAMPLE_TIMEOUT_MS,
	});
}

async function measure(input: { page: Page; op: ScreenResponseOp }): Promise<ScreenResponseSample> {
	const { page, op } = input;
	await page.waitForFunction(() => "htmx" in window, undefined, { timeout: SAMPLE_TIMEOUT_MS });
	await page.evaluate(
		(armed) => {
			window.readplaceScreenResponse = undefined;
			window.sessionStorage.setItem(armed.key, armed.value);
		},
		{
			key: PROBE_KEYS.armKey,
			value: JSON.stringify({ trigger: op.trigger, predicate: op.predicate }),
		},
	);
	await page.locator(op.trigger).click();
	await page.waitForFunction(() => window.readplaceScreenResponse !== undefined, undefined, {
		timeout: SAMPLE_TIMEOUT_MS,
	});
	const sample = await page.evaluate(() => window.readplaceScreenResponse);
	assert.ok(sample, `${op.id}: the probe resolved without a sample`);
	assert.equal(
		sample.historyCacheHit,
		false,
		`${op.id}: htmx restored this screen from its history cache, so the sample timed a restore rather than a response`,
	);
	assert.equal(
		sample.matchedOneOf,
		op.expectedOneOf,
		`${op.id}: the clock stopped on ${sample.matchedOneOf} instead of ${op.expectedOneOf}`,
	);
	assert.ok(
		Number.isFinite(sample.elapsedMs) && sample.elapsedMs > 0,
		`${op.id}: the probe reported an unusable elapsed time of ${sample.elapsedMs}`,
	);
	return sample;
}

async function measureListing(input: {
	page: Page;
	op: ScreenResponseOp;
}): Promise<ScreenResponseSample> {
	const counts = countsSettled(input.page);
	const sample = await measure(input);
	await counts;
	return sample;
}

async function controlProbe(page: Page): Promise<number[]> {
	const timings: number[] = [];
	for (let index = 0; index < budgets.meta.controlProbeRequests; index += 1) {
		const startedAtMs = Date.now();
		const response = await page.request.get(
			`${BASE_URL}${CONTROL_PROBE_PATH}?probe=${RUN_ID}-${index}`,
		);
		assert.ok(response.ok(), `the control probe answered ${response.status()}`);
		await response.body();
		timings.push(Date.now() - startedAtMs);
	}
	return timings;
}

function controlProbeOrUndefined(): ControlProbe | undefined {
	if (controlAtStartMs.length === 0 || controlAtEndMs.length === 0) return undefined;
	return controlProbeOf({ atStartMs: controlAtStartMs, atEndMs: controlAtEndMs });
}

function writeReport(): void {
	const paths = screenResponseReportPaths({ outputRoot: OUTPUT_ROOT, sha: REPORT_SHA });
	fs.mkdirSync(path.dirname(paths.samples), { recursive: true });
	fs.writeFileSync(
		paths.samples,
		JSON.stringify(
			{
				schema: "screen-response-latency/v1",
				sha: REPORT_SHA,
				runId: RUN_ID,
				meta: budgets.meta,
				budgets: budgets.ops,
				controlProbe: controlProbeOrUndefined(),
				notMeasured: missingOpResults(results),
				results,
				samples: collectedSamples,
			},
			null,
			"\t",
		),
	);
	fs.writeFileSync(
		paths.table,
		`# Screen response — ${REPORT_SHA}\n\n${formatResultsTable(results)}\n`,
	);
}

async function gate(input: {
	opId: ScreenResponseOpId;
	navigation: NavigationKind;
	warmups: number;
	samples: ScreenResponseSample[];
	recollect: () => Promise<ScreenResponseSample[]>;
}): Promise<void> {
	const budget = budgets.ops[input.opId];

	const judge = (samples: ScreenResponseSample[], attempt: string) => {
		collectedSamples[`${input.opId}:${attempt}`] = samples;
		const { warmup, measured } = splitWarmup({ samples, warmups: input.warmups });
		const navigation = navigationKindOf(measured);
		assert.equal(
			navigation,
			input.navigation,
			`${input.opId}: reached the screen as ${navigation}, expected ${input.navigation} — a budget over both would compare two different mechanisms`,
		);
		const stats = summarizeScreenResponse(measured);
		return {
			navigation,
			stats,
			phases: summarizePhases(measured),
			warmupMs: warmup.map((sample) => Math.round(sample.elapsedMs)),
			verdict: budgetVerdict({ opId: input.opId, budget, stats }),
		};
	};

	let outcome = judge(input.samples, "measured");
	say(outcome.verdict.message);
	say(`${input.opId}: warm-ups discarded — ${outcome.warmupMs.join("ms, ")}ms`);

	let remeasured = false;
	if (
		outcome.verdict.outcome === "breached" &&
		remeasuresUsed < budgets.meta.confirmationRemeasureCap
	) {
		remeasuresUsed += 1;
		say(
			`${input.opId}: breached — re-measuring once and gating on the confirmation alone ` +
				`(${remeasuresUsed} of ${budgets.meta.confirmationRemeasureCap} confirmations used this job)`,
		);
		outcome = judge(await input.recollect(), "confirmation");
		remeasured = true;
		say(`${input.opId}: confirmation — ${outcome.verdict.message}`);
	}

	results.push({
		opId: input.opId,
		navigation: outcome.navigation,
		stats: outcome.stats,
		phases: outcome.phases,
		verdict: outcome.verdict,
		warmupMs: outcome.warmupMs,
		remeasured,
	});
	writeReport();

	if (outcome.verdict.outcome === "breached") {
		assert.fail(`BUDGET BREACH — ${outcome.verdict.message}`);
	}
}

async function collectFirsts(browser: Browser): Promise<{
	queueSwitch: ScreenResponseSample[];
	tabSwitch: ScreenResponseSample[];
}> {
	const perContext = budgets.meta.samples.freshContexts;
	const queueSwitch: ScreenResponseSample[] = [];
	const tabSwitch: ScreenResponseSample[] = [];
	for (let index = 0; index < perContext.warmups + perContext.measured; index += 1) {
		const context = await newPerfContext(browser);
		try {
			const page = await context.newPage();
			await openListing({ page, url: queueUrl({ baseURL: BASE_URL, queue: dataset.alphaSlug }) });
			queueSwitch.push(
				await measureListing({
					page,
					op: queueSwitchOp({ id: "queue-switch-first", slug: dataset.bravoSlug }),
				}),
			);
			tabSwitch.push(
				await measureListing({
					page,
					op: tabSwitchOp({ id: "tab-switch-first", tab: "done" }),
				}),
			);
		} finally {
			await context.close();
		}
	}
	return { queueSwitch, tabSwitch };
}

async function collectQueueSwitchSubsequent(browser: Browser): Promise<ScreenResponseSample[]> {
	const counts = budgets.meta.samples.longLivedContext;
	const context = await newPerfContext(browser);
	try {
		const page = await context.newPage();
		await openListing({ page, url: queueUrl({ baseURL: BASE_URL, queue: dataset.alphaSlug }) });
		const samples: ScreenResponseSample[] = [];
		for (let index = 0; index < counts.warmups + counts.measured; index += 1) {
			const slug = index % 2 === 0 ? dataset.bravoSlug : dataset.alphaSlug;
			await expect(page.locator(queueNavLink(slug))).toHaveCount(1);
			samples.push(
				await measureListing({
					page,
					op: queueSwitchOp({ id: "queue-switch-subsequent", slug }),
				}),
			);
		}
		return samples;
	} finally {
		await context.close();
	}
}

async function collectTabSwitchSubsequent(browser: Browser): Promise<ScreenResponseSample[]> {
	const counts = budgets.meta.samples.longLivedContext;
	const context = await newPerfContext(browser);
	try {
		const page = await context.newPage();
		await openListing({ page, url: queueUrl({ baseURL: BASE_URL, queue: dataset.alphaSlug }) });
		const samples: ScreenResponseSample[] = [];
		for (let index = 0; index < counts.warmups + counts.measured; index += 1) {
			samples.push(
				await measureListing({
					page,
					op: tabSwitchOp({
						id: "tab-switch-subsequent",
						tab: index % 2 === 0 ? "done" : "queue",
					}),
				}),
			);
		}
		return samples;
	} finally {
		await context.close();
	}
}

async function collectAssign(browser: Browser): Promise<ScreenResponseSample[]> {
	const counts = budgets.meta.samples.longLivedContext;
	const context = await newPerfContext(browser);
	try {
		const page = await context.newPage();
		await page.goto(readerUrl({ baseURL: BASE_URL, articleId: dataset.assignArticleId }), {
			waitUntil: "load",
		});
		await assertNoRepeatingPollers({ page, where: "the reader the assign is measured on" });
		const samples: ScreenResponseSample[] = [];
		for (let index = 0; index < counts.warmups + counts.measured; index += 1) {
			await page.locator(QUEUES_TRIGGER).click();
			await expect(page.locator(assignButton(dataset.assignSlug))).toBeVisible();
			samples.push(await measure({ page, op: assignOp({ slug: dataset.assignSlug }) }));
			await page.locator(unassignButton(dataset.assignSlug)).click();
			await expect(page.locator(queueTag(dataset.assignSlug))).toHaveCount(0);
		}
		return samples;
	} finally {
		await context.close();
	}
}

async function collectOpenAndBack(browser: Browser): Promise<{
	opens: ScreenResponseSample[];
	backs: ScreenResponseSample[];
}> {
	const counts = budgets.meta.samples.longLivedContext;
	const context = await newPerfContext(browser);
	const opens: ScreenResponseSample[] = [];
	const backs: ScreenResponseSample[] = [];
	try {
		const page = await context.newPage();
		await openListing({ page, url: `${BASE_URL}/queue` });
		for (let index = 0; index < counts.warmups + counts.measured; index += 1) {
			await expect(page.locator(terminalCard(dataset.openArticleId))).toHaveCount(1);
			opens.push(
				await measure({ page, op: openArticleOp({ articleId: dataset.openArticleId }) }),
			);
			await assertNoRepeatingPollers({ page, where: "the reader the open landed on" });
			backs.push(await measureListing({ page, op: backToQueueOp() }));
		}
		return { opens, backs };
	} finally {
		await context.close();
	}
}

test.describe.serial("screen response against the deployed staging stack", () => {
	let setupContext: BrowserContext;
	let setupPage: Page;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(SETUP_TIMEOUT_MS);
		try {
			budgets = readBudgets(__dirname);
			const user = perfUserFor(RUN_ID);
			setupContext = await browser.newContext();
			setupPage = await setupContext.newPage();
			say(`perf user: ${user.email}`);

			controlAtStartMs = await controlProbe(setupPage);
			say(`control probe at start: ${controlAtStartMs.join("ms, ")}ms`);

			await signUpPerfUser({ page: setupPage, baseURL: BASE_URL, user });
			await dismissOnboarding({ page: setupPage, baseURL: BASE_URL });
			dataset = await seedPerfDataset({
				page: setupPage,
				baseURL: BASE_URL,
				runId: RUN_ID,
				diagnostic: say,
			});
			storageState = await setupContext.storageState();
		} catch (cause) {
			throw phaseFailure("SETUP", cause);
		}
	});

	test("queue-switch-first and tab-switch-first, one sample per fresh browser context", async ({
		browser,
	}) => {
		test.setTimeout(OP_TIMEOUT_MS);
		const warmups = budgets.meta.samples.freshContexts.warmups;
		const firsts = await collectFirsts(browser);
		await gate({
			opId: "queue-switch-first",
			navigation: "same-document",
			warmups,
			samples: firsts.queueSwitch,
			recollect: async () => (await collectFirsts(browser)).queueSwitch,
		});
		await gate({
			opId: "tab-switch-first",
			navigation: "same-document",
			warmups,
			samples: firsts.tabSwitch,
			recollect: async () => (await collectFirsts(browser)).tabSwitch,
		});
	});

	test("queue-switch-subsequent, bouncing between two seeded queues in one context", async ({
		browser,
	}) => {
		test.setTimeout(OP_TIMEOUT_MS);
		await gate({
			opId: "queue-switch-subsequent",
			navigation: "same-document",
			warmups: budgets.meta.samples.longLivedContext.warmups,
			samples: await collectQueueSwitchSubsequent(browser),
			recollect: () => collectQueueSwitchSubsequent(browser),
		});
	});

	test("tab-switch-subsequent, bouncing between To-Read and Read in one context", async ({
		browser,
	}) => {
		test.setTimeout(OP_TIMEOUT_MS);
		await gate({
			opId: "tab-switch-subsequent",
			navigation: "same-document",
			warmups: budgets.meta.samples.longLivedContext.warmups,
			samples: await collectTabSwitchSubsequent(browser),
			recollect: () => collectTabSwitchSubsequent(browser),
		});
	});

	test("assign-to-queue from the reader, reset through the tag's own unassign", async ({
		browser,
	}) => {
		test.setTimeout(OP_TIMEOUT_MS);
		await gate({
			opId: "assign-to-queue",
			navigation: "same-document",
			warmups: budgets.meta.samples.longLivedContext.warmups,
			samples: await collectAssign(browser),
			recollect: () => collectAssign(browser),
		});
	});

	test("open-article and back-to-queue, measured as one paired loop", async ({ browser }) => {
		test.setTimeout(OP_TIMEOUT_MS);
		const warmups = budgets.meta.samples.longLivedContext.warmups;
		const paired = await collectOpenAndBack(browser);
		await gate({
			opId: "open-article",
			navigation: "new-document",
			warmups,
			samples: paired.opens,
			recollect: async () => (await collectOpenAndBack(browser)).opens,
		});
		await gate({
			opId: "back-to-queue",
			navigation: "new-document",
			warmups,
			samples: paired.backs,
			recollect: async () => (await collectOpenAndBack(browser)).backs,
		});
	});

	test.afterAll(async () => {
		try {
			controlAtEndMs = await controlProbe(setupPage);
			say(`control probe at end: ${controlAtEndMs.join("ms, ")}ms`);
			const probe = controlProbeOrUndefined();
			if (probe !== undefined) {
				say(
					`control probe p50 moved from ${probe.atStart.p50Ms}ms to ${probe.atEnd.p50Ms}ms ` +
						`(${probe.endOverStartRatio.toFixed(2)}x) — an annotation on the run, never an excuse for a breach`,
				);
			}
			if (results.length > 0) writeReport();
			await deletePerfUser({ page: setupPage, baseURL: BASE_URL });
			say("perf user deleted, taking its trial schedules with it");
		} catch (cause) {
			throw phaseFailure("TEARDOWN", cause);
		} finally {
			await setupContext.close();
		}
	});
});
/* c8 ignore stop */
