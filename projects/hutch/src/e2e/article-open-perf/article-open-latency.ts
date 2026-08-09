import assert from "node:assert";
import path from "node:path";
import { perfArtifactDirectory, summarizeLatency } from "browser-extension-core/perf";
import { z } from "zod";

export type SameDocumentSample = {
	elapsedMs: number;
	resolutionMs: number;
	sameDocument: true;
};

export type NewDocumentSample = {
	elapsedMs: number;
	resolutionMs: number;
	sameDocument: false;
	unloadEventMs: number;
	preRequestMs: number;
};

export type ArticleOpenSample = SameDocumentSample | NewDocumentSample;

const ArticleOpenStatsSchema = z.object({
	count: z.number(),
	meanMs: z.number(),
	sdMs: z.number(),
	p50Ms: z.number(),
	p95Ms: z.number(),
	maxMs: z.number(),
	resolutionMs: z.number(),
});
export type ArticleOpenStats = z.infer<typeof ArticleOpenStatsSchema>;

const DocumentHopStatsSchema = z.object({
	unloadEventMeanMs: z.number(),
	preRequestMeanMs: z.number(),
});
export type DocumentHopStats = z.infer<typeof DocumentHopStatsSchema>;

const ConditionResultSchema = z.object({
	condition: z.string(),
	navigation: z.enum(["same-document", "new-document"]),
	stats: ArticleOpenStatsSchema,
	hop: DocumentHopStatsSchema.optional(),
});
export type ConditionResult = z.infer<typeof ConditionResultSchema>;
export type NavigationKind = ConditionResult["navigation"];

export const ArticleOpenReportSchema = z.object({
	label: z.string(),
	results: z.array(ConditionResultSchema).min(1),
});
export type ArticleOpenReport = z.infer<typeof ArticleOpenReportSchema>;

export function summarizeArticleOpen(samples: ArticleOpenSample[]): ArticleOpenStats {
	assert(
		samples.length >= 2,
		"an article-open summary needs at least two samples to carry a standard deviation",
	);
	const elapsedMs = samples.map((sample) => sample.elapsedMs);
	const latency = summarizeLatency(elapsedMs);
	const variance =
		elapsedMs.reduce((sum, sample) => sum + (sample - latency.meanMs) ** 2, 0) /
		(elapsedMs.length - 1);
	return {
		...latency,
		sdMs: Math.sqrt(variance),
		resolutionMs: summarizeLatency(samples.map((sample) => sample.resolutionMs)).meanMs,
	};
}

function isNewDocument(sample: ArticleOpenSample): sample is NewDocumentSample {
	return !sample.sameDocument;
}

export function summarizeDocumentHop(
	samples: ArticleOpenSample[],
): DocumentHopStats | undefined {
	const hops = samples.filter(isNewDocument);
	if (hops.length === 0) return undefined;
	return {
		unloadEventMeanMs: summarizeLatency(hops.map((hop) => hop.unloadEventMs)).meanMs,
		preRequestMeanMs: summarizeLatency(hops.map((hop) => hop.preRequestMs)).meanMs,
	};
}

export function splitWarmup<TSample>(input: {
	samples: TSample[];
	warmups: number;
}): { warmup: TSample[]; measured: TSample[] } {
	assert(
		input.samples.length > input.warmups,
		`a condition needs more than ${input.warmups} samples to report anything past its warm-ups`,
	);
	return {
		warmup: input.samples.slice(0, input.warmups),
		measured: input.samples.slice(input.warmups),
	};
}

/** The one arm-detecting statement in the harness: a run against a boosted build
 * must report every open as same-document and a run against an unboosted one
 * every open as new-document. A condition that reports both measured two
 * different things and its mean would average them. */
export function navigationKindOf(samples: ArticleOpenSample[]): NavigationKind {
	assert(samples.length > 0, "a navigation kind needs at least one sample");
	const sameDocument = samples.every((sample) => sample.sameDocument);
	const newDocument = samples.every(isNewDocument);
	assert(
		sameDocument !== newDocument,
		"every sample in a condition must open the article the same way",
	);
	return sameDocument ? "same-document" : "new-document";
}

function toTenth(value: number): string {
	return value.toFixed(1);
}

function hopCells(hop: DocumentHopStats | undefined): string {
	if (hop === undefined) return " | — | —";
	return ` | ${toTenth(hop.unloadEventMeanMs)} | ${toTenth(hop.preRequestMeanMs)}`;
}

export function formatResultsTable(results: ConditionResult[]): string {
	assert(results.length > 0, "a results table needs at least one condition");
	return [
		"| Condition | Open | n | mean (ms) | sd (ms) | p50 (ms) | p95 (ms) | resolution (ms) | unload (ms) | pre-request (ms) |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		...results.map(
			(result) =>
				`| ${result.condition} | ${result.navigation} | ${result.stats.count}` +
				` | ${toTenth(result.stats.meanMs)} | ${toTenth(result.stats.sdMs)}` +
				` | ${toTenth(result.stats.p50Ms)} | ${toTenth(result.stats.p95Ms)}` +
				` | ${toTenth(result.stats.resolutionMs)}${hopCells(result.hop)} |`,
		),
	].join("\n");
}

/** The table is written beside the samples it was computed from so a published
 * number can be traced back to the run that produced it. */
export function articleOpenReportPaths(input: {
	root: string | undefined;
	runId: string | undefined;
	label: string;
}): { samples: string; table: string } {
	const directory = perfArtifactDirectory(input);
	return {
		samples: path.join(directory, `${input.label}-article-open-latency.json`),
		table: path.join(directory, `${input.label}-article-open-latency.md`),
	};
}
