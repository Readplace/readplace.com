import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { summarizeLatency } from "browser-extension-core/perf";
import { z } from "zod";
import {
	type NavigationKind,
	SCREEN_RESPONSE_OP_IDS,
	type ScreenResponseOpId,
} from "./screen-response-ops";

export const ENCROACHMENT_RATIO = 0.9;

const BUDGETS_FILENAME = "budgets.perf-staging.json";

export interface ScreenResponsePhases {
	beforeRequestMs?: number;
	afterSwapMs?: number;
	afterSettleMs?: number;
}

interface ResponseCommon {
	elapsedMs: number;
	matchedOneOf: string;
	historyCacheHit: boolean;
	phases: ScreenResponsePhases;
}

export interface SameDocumentResponse extends ResponseCommon {
	sameDocument: true;
}

export interface NewDocumentResponse extends ResponseCommon {
	sameDocument: false;
	responseStartMs: number;
	activationStartMs?: number;
	fcpMs?: number;
}

export type ScreenResponseSample = SameDocumentResponse | NewDocumentResponse;

export interface ScreenResponseStats {
	count: number;
	maxMs: number;
	meanMs: number;
	p50Ms: number;
	p95Ms: number;
	sortedMs: number[];
}

export function summarizeMs(samplesMs: readonly number[]): ScreenResponseStats {
	const sortedMs = [...samplesMs].sort((left, right) => left - right);
	const latency = summarizeLatency(sortedMs);
	return {
		count: latency.count,
		maxMs: latency.maxMs,
		meanMs: latency.meanMs,
		p50Ms: latency.p50Ms,
		p95Ms: latency.p95Ms,
		sortedMs,
	};
}

export function summarizeScreenResponse(
	samples: readonly ScreenResponseSample[],
): ScreenResponseStats {
	return summarizeMs(samples.map((sample) => sample.elapsedMs));
}

function isNewDocument(sample: ScreenResponseSample): sample is NewDocumentResponse {
	return !sample.sameDocument;
}

export function navigationKindOf(samples: readonly ScreenResponseSample[]): NavigationKind {
	assert(samples.length > 0, "a navigation kind needs at least one sample");
	const sameDocument = samples.every((sample) => sample.sameDocument);
	const newDocument = samples.every(isNewDocument);
	assert(
		sameDocument !== newDocument,
		"every sample in an operation must reach the screen the same way",
	);
	return sameDocument ? "same-document" : "new-document";
}

function meanOf(values: readonly number[]): number | undefined {
	if (values.length === 0) return undefined;
	return summarizeLatency([...values]).meanMs;
}

function definedNumbers(values: readonly (number | undefined)[]): number[] {
	return values.flatMap((value) => (value === undefined ? [] : [value]));
}

export interface PhaseMeans {
	beforeRequestMs?: number;
	afterSwapMs?: number;
	afterSettleMs?: number;
	responseStartMs?: number;
	activationStartMs?: number;
	fcpMs?: number;
}

export function summarizePhases(samples: readonly ScreenResponseSample[]): PhaseMeans {
	const hops = samples.filter(isNewDocument);
	return {
		beforeRequestMs: meanOf(definedNumbers(samples.map((s) => s.phases.beforeRequestMs))),
		afterSwapMs: meanOf(definedNumbers(samples.map((s) => s.phases.afterSwapMs))),
		afterSettleMs: meanOf(definedNumbers(samples.map((s) => s.phases.afterSettleMs))),
		responseStartMs: meanOf(hops.map((hop) => hop.responseStartMs)),
		activationStartMs: meanOf(definedNumbers(hops.map((hop) => hop.activationStartMs))),
		fcpMs: meanOf(definedNumbers(hops.map((hop) => hop.fcpMs))),
	};
}

const BaselineSchema = z.object({
	maxMs: z.number().positive(),
	runs: z.number().int().positive(),
	shas: z.array(z.string().min(1)).min(1),
	recordedAt: z.string().min(1),
});

const OpBudgetSchema = z.discriminatedUnion("level", [
	z.object({
		level: z.literal("warn"),
		budgetMs: z.null(),
		baseline: z.null(),
		note: z.string().min(1),
	}),
	z.object({
		level: z.literal("error"),
		budgetMs: z.number().positive(),
		baseline: BaselineSchema,
		note: z.string().min(1),
	}),
]);

export type OpBudget = z.infer<typeof OpBudgetSchema>;
export type BudgetLevel = OpBudget["level"];

const SampleCountsSchema = z.object({
	warmups: z.number().int().nonnegative(),
	measured: z.number().int().positive(),
});

const ScreenResponseBudgetsSchema = z.object({
	meta: z.object({
		statistic: z.literal("max"),
		vantage: z.string().min(1),
		encroachmentRatio: z.literal(ENCROACHMENT_RATIO),
		confirmationRemeasureCap: z.number().int().nonnegative(),
		controlProbeRequests: z.number().int().positive(),
		samples: z.object({
			longLivedContext: SampleCountsSchema,
			freshContexts: SampleCountsSchema,
		}),
	}),
	ops: z.object({
		"queue-switch-first": OpBudgetSchema,
		"queue-switch-subsequent": OpBudgetSchema,
		"tab-switch-first": OpBudgetSchema,
		"tab-switch-subsequent": OpBudgetSchema,
		"assign-to-queue": OpBudgetSchema,
		"open-article": OpBudgetSchema,
		"back-to-queue": OpBudgetSchema,
	} satisfies Record<ScreenResponseOpId, z.ZodType>),
});

export type ScreenResponseBudgets = z.infer<typeof ScreenResponseBudgetsSchema>;

export function parseBudgets(raw: unknown): ScreenResponseBudgets {
	return ScreenResponseBudgetsSchema.parse(raw);
}

export function readBudgets(directory: string): ScreenResponseBudgets {
	return parseBudgets(JSON.parse(readFileSync(path.join(directory, BUDGETS_FILENAME), "utf-8")));
}

export type BudgetOutcome = "report-only" | "within" | "encroaching" | "breached";

export interface BudgetVerdict {
	opId: ScreenResponseOpId;
	level: BudgetLevel;
	budgetMs: number | null;
	maxMs: number;
	outcome: BudgetOutcome;
	message: string;
}

function toTenth(value: number): string {
	return value.toFixed(1);
}

function sampleList(stats: ScreenResponseStats): string {
	return stats.sortedMs.map((value) => Math.round(value)).join(", ");
}

export function budgetVerdict(input: {
	opId: ScreenResponseOpId;
	budget: OpBudget;
	stats: ScreenResponseStats;
}): BudgetVerdict {
	const { opId, budget, stats } = input;
	const common = { opId, level: budget.level, budgetMs: budget.budgetMs, maxMs: stats.maxMs };
	if (budget.level === "warn") {
		return {
			...common,
			outcome: "report-only",
			message:
				`${opId}: max ${toTenth(stats.maxMs)}ms over ${stats.count} samples, ` +
				`p50 ${toTenth(stats.p50Ms)}ms, p95 ${toTenth(stats.p95Ms)}ms — report-only, no budget locked`,
		};
	}
	if (stats.maxMs > budget.budgetMs) {
		return {
			...common,
			outcome: "breached",
			message:
				`${opId}: max ${toTenth(stats.maxMs)}ms exceeds the ${budget.budgetMs}ms budget ` +
				`(p50 ${toTenth(stats.p50Ms)}ms, p95 ${toTenth(stats.p95Ms)}ms over ${stats.count} samples) ` +
				`— samples: ${sampleList(stats)}`,
		};
	}
	if (stats.maxMs > budget.budgetMs * ENCROACHMENT_RATIO) {
		return {
			...common,
			outcome: "encroaching",
			message:
				`${opId}: max ${toTenth(stats.maxMs)}ms is inside the ${budget.budgetMs}ms budget but ` +
				`past ${ENCROACHMENT_RATIO} of it — samples: ${sampleList(stats)}`,
		};
	}
	return {
		...common,
		outcome: "within",
		message: `${opId}: max ${toTenth(stats.maxMs)}ms within the ${budget.budgetMs}ms budget`,
	};
}

export interface OpResult {
	opId: ScreenResponseOpId;
	navigation: NavigationKind;
	stats: ScreenResponseStats;
	phases: PhaseMeans;
	verdict: BudgetVerdict;
	warmupMs: number[];
	remeasured: boolean;
}

export interface ControlProbe {
	atStart: ScreenResponseStats;
	atEnd: ScreenResponseStats;
	endOverStartRatio: number;
}

export function controlProbeOf(input: {
	atStartMs: readonly number[];
	atEndMs: readonly number[];
}): ControlProbe {
	const atStart = summarizeMs(input.atStartMs);
	const atEnd = summarizeMs(input.atEndMs);
	return { atStart, atEnd, endOverStartRatio: atEnd.p50Ms / atStart.p50Ms };
}

function optionalCell(value: number | undefined): string {
	return value === undefined ? "—" : toTenth(value);
}

export function formatResultsTable(results: readonly OpResult[]): string {
	assert(results.length > 0, "a results table needs at least one operation");
	return [
		"| Operation | Reaches screen | n | max (ms) | budget (ms) | outcome | p50 (ms) | p95 (ms) | mean (ms) | beforeRequest (ms) | afterSwap (ms) | afterSettle (ms) | responseStart (ms) | FCP (ms) |",
		"| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		...results.map(
			(result) =>
				`| ${result.opId} | ${result.navigation} | ${result.stats.count}` +
				` | ${toTenth(result.stats.maxMs)}` +
				` | ${result.verdict.budgetMs === null ? "—" : result.verdict.budgetMs}` +
				` | ${result.verdict.outcome}` +
				` | ${toTenth(result.stats.p50Ms)} | ${toTenth(result.stats.p95Ms)}` +
				` | ${toTenth(result.stats.meanMs)}` +
				` | ${optionalCell(result.phases.beforeRequestMs)}` +
				` | ${optionalCell(result.phases.afterSwapMs)}` +
				` | ${optionalCell(result.phases.afterSettleMs)}` +
				` | ${optionalCell(result.phases.responseStartMs)}` +
				` | ${optionalCell(result.phases.fcpMs)} |`,
		),
	].join("\n");
}

export function screenResponseReportPaths(input: { outputRoot: string; sha: string }): {
	samples: string;
	table: string;
} {
	const directory = path.join(input.outputRoot, "perf");
	return {
		samples: path.join(directory, `screen-response-${input.sha}.json`),
		table: path.join(directory, `screen-response-${input.sha}.md`),
	};
}

export function missingOpResults(
	results: readonly OpResult[],
): readonly ScreenResponseOpId[] {
	const measured = new Set(results.map((result) => result.opId));
	return SCREEN_RESPONSE_OP_IDS.filter((opId) => !measured.has(opId));
}
