/* c8 ignore start -- staging-only perf harness, never run under the local suite */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireEnv } from "@packages/require-env";
import {
	type Browser,
	type BrowserContext,
	type Page,
	type Request,
	type Response,
	expect,
	test,
} from "@playwright/test";
import { splitWarmup } from "../article-open-perf/article-open-latency";
import { deletePerfUser, dismissOnboarding, perfUserFor, signUpPerfUser } from "./perf-user";
import {
	type ControlProbe,
	type MeasuredScreenResponse,
	type OpResult,
	type ResponseSource,
	type ScreenResponseBudgets,
	budgetVerdict,
	controlProbeOf,
	formatResultsTable,
	missingOpResults,
	navigationKindOf,
	readBudgets,
	responseSourceOf,
	screenResponseReportPaths,
	summarizePhases,
	summarizeProvenance,
	summarizeScreenResponse,
} from "./screen-response-latency";
import {
	CHANGELOG_BANNER,
	READLISTS_TRIGGER,
	READLIST_COUNTS,
	READLIST_NAV,
	type NavigationKind,
	type ScreenResponseOp,
	type ScreenResponseOpId,
	assignButton,
	assignOp,
	backToReadlistOp,
	openArticleOp,
	readlistNavLink,
	readlistSwitchOp,
	readlistTag,
	tabSwitchOp,
	terminalCard,
	unassignButton,
} from "./screen-response-ops";
import { installScreenResponseProbe } from "./screen-response-probe.browser";
import {
	type SeededDataset,
	assertNoRepeatingPollers,
	readlistUrl,
	readerUrl,
	seedPerfDataset,
} from "./seed";

const PROBE_KEYS = {
	armKey: "readplace.screen-response.arm",
	pendingKey: "readplace.screen-response.pending",
	offClockSelector: `${READLIST_COUNTS}, ${CHANGELOG_BANNER}`,
};

const SAMPLE_TIMEOUT_MS = 60_000;
const OP_TIMEOUT_MS = 12 * 60 * 1000;
const SETUP_TIMEOUT_MS = 20 * 60 * 1000;
const CONTROL_PROBE_PATH = "/embed/icon.svg";
const PROVENANCE_GRACE_MS = 5_000;

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
const collectedSamples: Record<string, MeasuredScreenResponse[]> = {};

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
	await expect(input.page.locator(READLIST_NAV)).toHaveCount(1);
	await counts;
	await input.page.waitForFunction(() => "htmx" in window, undefined, {
		timeout: SAMPLE_TIMEOUT_MS,
	});
}

interface ReceivedResponse {
	url: string;
	fromDiskCache?: boolean;
	serviceWorkerResponseSource?: Exclude<ResponseSource, "unknown">;
}

interface ResponsesSeen {
	describe(url: string): Promise<ReceivedResponse | undefined>;
	clear(): void;
}

const responsesSeenByPage = new WeakMap<Page, Promise<ResponsesSeen>>();

async function watchResponses(page: Page): Promise<ResponsesSeen> {
	const session = await page.context().newCDPSession(page);
	const seen: ReceivedResponse[] = [];
	const waiting = new Set<() => void>();
	session.on("Network.responseReceived", (event) => {
		seen.push(event.response);
		for (const wake of waiting) wake();
	});
	await session.send("Network.enable");
	return {
		clear: () => {
			seen.length = 0;
		},
		describe: (url) =>
			new Promise((resolve) => {
				const settle = () => {
					const found = [...seen].reverse().find((response) => response.url === url);
					if (found === undefined) return;
					waiting.delete(settle);
					clearTimeout(timer);
					resolve(found);
				};
				const timer = setTimeout(() => {
					waiting.delete(settle);
					resolve(undefined);
				}, PROVENANCE_GRACE_MS);
				waiting.add(settle);
				settle();
			}),
	};
}

function responsesSeen(page: Page): Promise<ResponsesSeen> {
	const existing = responsesSeenByPage.get(page);
	if (existing !== undefined) return existing;
	const created = watchResponses(page);
	responsesSeenByPage.set(page, created);
	return created;
}

function isRedirect(response: Response): boolean {
	return response.status() >= 300 && response.status() < 400;
}

function chainStartOf(request: Request): Request {
	const previous = request.redirectedFrom();
	return previous === null ? request : chainStartOf(previous);
}

function screenResponseOf(input: { page: Page; op: ScreenResponseOp }): Promise<Response> {
	const { page, op } = input;
	return page.waitForResponse(
		(response) => {
			if (isRedirect(response)) return false;
			const request = response.request();
			if (op.navigation === "new-document") {
				return request.isNavigationRequest() && request.frame() === page.mainFrame();
			}
			return chainStartOf(request).headers()["hx-boosted"] === "true";
		},
		{ timeout: SAMPLE_TIMEOUT_MS },
	);
}

async function measure(input: { page: Page; op: ScreenResponseOp }): Promise<MeasuredScreenResponse> {
	const { page, op } = input;
	await page.waitForFunction(() => "htmx" in window, undefined, { timeout: SAMPLE_TIMEOUT_MS });
	const seen = await responsesSeen(page);
	seen.clear();
	const screenResponse = screenResponseOf({ page, op });
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
	const response = await screenResponse;
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
	return {
		...sample,
		fromServiceWorker: response.fromServiceWorker(),
		responseSource: responseSourceOf(await seen.describe(response.url())),
	};
}

async function measureListing(input: {
	page: Page;
	op: ScreenResponseOp;
}): Promise<MeasuredScreenResponse> {
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
	samples: MeasuredScreenResponse[];
	recollect: () => Promise<MeasuredScreenResponse[]>;
}): Promise<void> {
	const budget = budgets.ops[input.opId];

	const judge = (samples: MeasuredScreenResponse[], attempt: string) => {
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
			provenance: summarizeProvenance(measured),
			warmupMs: warmup.map((sample) => Math.round(sample.elapsedMs)),
			verdict: budgetVerdict({ opId: input.opId, budget, stats }),
		};
	};

	let outcome = judge(input.samples, "measured");
	say(outcome.verdict.message);
	say(`${input.opId}: warm-ups discarded — ${outcome.warmupMs.join("ms, ")}ms`);
	say(
		`${input.opId}: ${outcome.provenance.throughWorker} of ${outcome.provenance.of} through the worker, ` +
			`${outcome.provenance.fromHttpCache} of ${outcome.provenance.of} from the HTTP cache`,
	);

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
		provenance: outcome.provenance,
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
	readlistSwitch: MeasuredScreenResponse[];
	tabSwitch: MeasuredScreenResponse[];
}> {
	const perContext = budgets.meta.samples.freshContexts;
	const readlistSwitch: MeasuredScreenResponse[] = [];
	const tabSwitch: MeasuredScreenResponse[] = [];
	for (let index = 0; index < perContext.warmups + perContext.measured; index += 1) {
		const context = await newPerfContext(browser);
		try {
			const page = await context.newPage();
			await openListing({ page, url: readlistUrl({ baseURL: BASE_URL, readlist: dataset.alphaSlug }) });
			readlistSwitch.push(
				await measureListing({
					page,
					op: readlistSwitchOp({ id: "readlist-switch-first", slug: dataset.bravoSlug }),
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
	return { readlistSwitch, tabSwitch };
}

async function collectReadlistSwitchSubsequent(browser: Browser): Promise<MeasuredScreenResponse[]> {
	const counts = budgets.meta.samples.longLivedContext;
	const context = await newPerfContext(browser);
	try {
		const page = await context.newPage();
		await openListing({ page, url: readlistUrl({ baseURL: BASE_URL, readlist: dataset.alphaSlug }) });
		const samples: MeasuredScreenResponse[] = [];
		for (let index = 0; index < counts.warmups + counts.measured; index += 1) {
			const slug = index % 2 === 0 ? dataset.bravoSlug : dataset.alphaSlug;
			await expect(page.locator(readlistNavLink(slug))).toHaveCount(1);
			samples.push(
				await measureListing({
					page,
					op: readlistSwitchOp({ id: "readlist-switch-subsequent", slug }),
				}),
			);
		}
		return samples;
	} finally {
		await context.close();
	}
}

async function collectTabSwitchSubsequent(browser: Browser): Promise<MeasuredScreenResponse[]> {
	const counts = budgets.meta.samples.longLivedContext;
	const context = await newPerfContext(browser);
	try {
		const page = await context.newPage();
		await openListing({ page, url: readlistUrl({ baseURL: BASE_URL, readlist: dataset.alphaSlug }) });
		const samples: MeasuredScreenResponse[] = [];
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

async function collectAssign(browser: Browser): Promise<MeasuredScreenResponse[]> {
	const counts = budgets.meta.samples.longLivedContext;
	const context = await newPerfContext(browser);
	try {
		const page = await context.newPage();
		await page.goto(readerUrl({ baseURL: BASE_URL, articleId: dataset.assignArticleId }), {
			waitUntil: "load",
		});
		await assertNoRepeatingPollers({ page, where: "the reader the assign is measured on" });
		const samples: MeasuredScreenResponse[] = [];
		for (let index = 0; index < counts.warmups + counts.measured; index += 1) {
			await page.locator(READLISTS_TRIGGER).click();
			await expect(page.locator(assignButton(dataset.assignSlug))).toBeVisible();
			samples.push(await measure({ page, op: assignOp({ slug: dataset.assignSlug }) }));
			await page.locator(unassignButton(dataset.assignSlug)).click();
			await expect(page.locator(readlistTag(dataset.assignSlug))).toHaveCount(0);
		}
		return samples;
	} finally {
		await context.close();
	}
}

async function collectOpenAndBack(browser: Browser): Promise<{
	opens: MeasuredScreenResponse[];
	backs: MeasuredScreenResponse[];
}> {
	const counts = budgets.meta.samples.longLivedContext;
	const context = await newPerfContext(browser);
	const opens: MeasuredScreenResponse[] = [];
	const backs: MeasuredScreenResponse[] = [];
	try {
		const page = await context.newPage();
		await openListing({ page, url: `${BASE_URL}/queue` });
		for (let index = 0; index < counts.warmups + counts.measured; index += 1) {
			await expect(page.locator(terminalCard(dataset.openArticleId))).toHaveCount(1);
			opens.push(
				await measure({ page, op: openArticleOp({ articleId: dataset.openArticleId }) }),
			);
			await assertNoRepeatingPollers({ page, where: "the reader the open landed on" });
			backs.push(await measureListing({ page, op: backToReadlistOp() }));
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

	test("readlist-switch-first and tab-switch-first, one sample per fresh browser context", async ({
		browser,
	}) => {
		test.setTimeout(OP_TIMEOUT_MS);
		const warmups = budgets.meta.samples.freshContexts.warmups;
		const firsts = await collectFirsts(browser);
		await gate({
			opId: "readlist-switch-first",
			navigation: "same-document",
			warmups,
			samples: firsts.readlistSwitch,
			recollect: async () => (await collectFirsts(browser)).readlistSwitch,
		});
		await gate({
			opId: "tab-switch-first",
			navigation: "same-document",
			warmups,
			samples: firsts.tabSwitch,
			recollect: async () => (await collectFirsts(browser)).tabSwitch,
		});
	});

	test("readlist-switch-subsequent, bouncing between two seeded readlists in one context", async ({
		browser,
	}) => {
		test.setTimeout(OP_TIMEOUT_MS);
		await gate({
			opId: "readlist-switch-subsequent",
			navigation: "same-document",
			warmups: budgets.meta.samples.longLivedContext.warmups,
			samples: await collectReadlistSwitchSubsequent(browser),
			recollect: () => collectReadlistSwitchSubsequent(browser),
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

	test("assign-to-readlist from the reader, reset through the tag's own unassign", async ({
		browser,
	}) => {
		test.setTimeout(OP_TIMEOUT_MS);
		await gate({
			opId: "assign-to-readlist",
			navigation: "same-document",
			warmups: budgets.meta.samples.longLivedContext.warmups,
			samples: await collectAssign(browser),
			recollect: () => collectAssign(browser),
		});
	});

	test("open-article and back-to-readlist, measured as one paired loop", async ({ browser }) => {
		test.setTimeout(OP_TIMEOUT_MS);
		const warmups = budgets.meta.samples.longLivedContext.warmups;
		const paired = await collectOpenAndBack(browser);
		await gate({
			opId: "open-article",
			navigation: "same-document",
			warmups,
			samples: paired.opens,
			recollect: async () => (await collectOpenAndBack(browser)).opens,
		});
		await gate({
			opId: "back-to-readlist",
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
