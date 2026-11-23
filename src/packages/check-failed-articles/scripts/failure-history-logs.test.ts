import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { GetQueryResultsResponse, StartQueryRequest } from "@aws-sdk/client-cloudwatch-logs";
import { type FailureHistoryArticle, initFailureHistoryLogs, initFailureHistoryQuery } from "./failure-history-logs";

const CUTOFF = new Date("2026-11-23T03:00:00.630Z");
const SAVED_AT = "2026-11-17T14:15:16.100Z";
const ADMITTED_AT = "2026-11-19T16:17:18.200Z";
const DISPATCHED_AT = Date.parse(ADMITTED_AT) + 300;
const RESOLVED = "[ResolveOnView] dispatched";

function article(name: string, overrides: Partial<FailureHistoryArticle> = {}): FailureHistoryArticle {
	return {
		key: `example.com/${name}`,
		originalUrl: `https://example.com/${name}`,
		savedAt: SAVED_AT,
		fullCrawlRequestedAt: ADMITTED_AT,
		resolutionOnViewClaimedAt: ADMITTED_AT,
		...overrides,
	};
}

function resultRow(fields: Record<string, string>) {
	return Object.entries(fields).map(([field, value]) => ({ field, value }));
}

function dispatch(url: string, edits: Record<string, string> = {}) {
	return resultRow({
		singleQuotedUrl: url,
		dispatchTime: String(DISPATCHED_AT),
		dispatch: RESOLVED,
		surface: "readlist-siren",
		...edits,
	});
}

function ownerOpen(key: string, timestamp: string) {
	const article_id = createHash("sha256").update(key).digest("hex").slice(0, 32);
	return resultRow({ timestamp, article_id });
}

function complete(results: NonNullable<GetQueryResultsResponse["results"]>, recordsMatched = results.length): GetQueryResultsResponse {
	return { status: "Complete", results, statistics: { recordsMatched } };
}

function fakeLogs(respond: (query: StartQueryRequest) => GetQueryResultsResponse) {
	const queries: StartQueryRequest[] = [];
	return {
		queries,
		client: {
			startQuery: async (query: StartQueryRequest) => {
				queries.push(query);
				return { queryId: String(queries.length - 1) };
			},
			getQueryResults: async ({ queryId }: { queryId: string | undefined }) => {
				const query = queries[Number(queryId)];
				assert(query);
				return respond(query);
			},
		},
	};
}

function isOwnerQuery(query: StartQueryRequest) {
	return query.logGroupNames?.includes("/readplace/analytics") === true;
}

test("joins exact normalized physical keys in bounded batches and scopes owner opens to the save lifetime", async () => {
	const first = article("first", { originalUrl: "https://example.com/wrapper" });
	const second = article("second");
	const beforeSave = new Date(Date.parse(SAVED_AT) - 1).toISOString();
	const afterCutoff = new Date(CUTOFF.getTime() + 1).toISOString();
	const ownerRows = [
		ownerOpen(first.key, beforeSave), ownerOpen(first.key, SAVED_AT), ownerOpen(first.key, SAVED_AT),
		ownerOpen(first.key, CUTOFF.toISOString()), ownerOpen(second.key, afterCutoff),
	];
	const { client, queries } = fakeLogs((query) => isOwnerQuery(query) ? complete(ownerRows) : complete([
		dispatch("https://example.com/first?utm_source=test"),
		dispatch(second.originalUrl, { surface: "readlist-html" }),
		dispatch("https://example.com/third", { surface: "reader" }),
	]));

	const report = await initFailureHistoryLogs({ client, now: () => CUTOFF.getTime() })({ articles: [first, second], cutoff: CUTOFF });
	assert.deepEqual(report.get(first.key), {
		admissionSurface: "readlist-siren", admissionCovered: true,
		ownerOpenTimes: [Date.parse(SAVED_AT), CUTOFF.getTime()], ownerOpensCovered: true,
	});
	assert.deepEqual(report.get(second.key), {
		admissionSurface: "readlist-html", admissionCovered: true, ownerOpenTimes: [], ownerOpensCovered: true,
	});
	assert.equal(queries.length, 2);
	const ownerQuery = queries.find(isOwnerQuery);
	assert(ownerQuery?.queryString);
	assert.match(ownerQuery.queryString, /event = "engagement_activity" and activity_kind = "reader-open"/);
	assert.match(ownerQuery.queryString, /display timestamp, article_id/);
	assert.equal(ownerQuery.startTime, Math.floor(Date.parse(SAVED_AT) / 1_000));
	const workerQuery = queries.find((query) => !isOwnerQuery(query));
	assert(workerQuery?.queryString);
	assert.deepEqual(workerQuery.logGroupNames, [
		"/aws/lambda/submit-link-handler",
		"/aws/lambda/recrawl-link-initiated-handler",
		"/aws/lambda/save-anonymous-link-command-handler",
	]);
	assert.equal(workerQuery.startTime, Math.floor((Date.parse(ADMITTED_AT) - 1_000) / 1_000));
	assert.equal(workerQuery.endTime, Math.ceil((Date.parse(ADMITTED_AT) + 60_000) / 1_000));

	const parsePatterns = [...workerQuery.queryString.matchAll(/^\| parse @message \/(.*)\/$/gm)];
	const lambdaMessage = "2026-11-19T16:17:18.500Z\trequest\tINFO\t[ResolveOnView] dispatched {\n  url: 'https://example.com/first',\n  surface: 'readlist-siren',\n  axes: 'crawl-and-summary'\n}";
	const fields = Object.assign({}, ...parsePatterns.map(([, pattern]) => new RegExp(pattern).exec(lambdaMessage)?.groups));
	assert.deepEqual(fields, {
		dispatch: RESOLVED,
		singleQuotedUrl: "https://example.com/first",
		surface: "readlist-siren",
	});
});

test("ambiguous, unrelated, preceding and out-of-window dispatches cannot establish admission source", async () => {
	const duplicate = article("duplicate");
	const competed = article("competed", { originalUrl: "https://example.com/wrapper" });
	const preceding = article("preceding");
	const outOfWindow = article("out-of-window");
	const aliased = article("aliased", { originalUrl: "https://example.com/other-key" });
	const invalidSurface = article("unexpected");
	const articles = [duplicate, competed, preceding, outOfWindow, aliased, invalidSurface];
	const { client } = fakeLogs((query) => isOwnerQuery(query) ? complete([]) : complete([
		dispatch(duplicate.originalUrl), dispatch(duplicate.originalUrl),
		dispatch("https://example.com/competed"),
		dispatch(competed.originalUrl, { dispatch: "[SubmitLinkCommand] saved" }),
		dispatch(preceding.originalUrl, { dispatchTime: String(Date.parse(ADMITTED_AT) - 1) }),
		dispatch(outOfWindow.originalUrl, { dispatchTime: String(Date.parse(ADMITTED_AT) + 60_001) }),
		dispatch(aliased.originalUrl),
		dispatch(invalidSurface.originalUrl, { surface: "unrecognized" }),
	]));

	const report = await initFailureHistoryLogs({ client, now: () => CUTOFF.getTime() })({ articles, cutoff: CUTOFF });
	for (const row of articles) {
		assert.deepEqual(report.get(row.key), {
			admissionSurface: undefined, admissionCovered: true, ownerOpenTimes: [], ownerOpensCovered: true,
		});
	}
});

test("only recent, in-lifetime admissions with matching claims can be searched", async () => {
	const old = article("old", {
		savedAt: "2026-09-01T10:00:00.000Z",
		fullCrawlRequestedAt: "2026-10-01T10:00:00.000Z",
		resolutionOnViewClaimedAt: "2026-10-01T10:00:00.000Z",
	});
	const stale = article("stale", { resolutionOnViewClaimedAt: SAVED_AT });
	const future = article("future", {
		fullCrawlRequestedAt: "2026-11-24T10:00:00.000Z",
		resolutionOnViewClaimedAt: "2026-11-24T10:00:00.000Z",
	});
	const beforeSave = article("previous-lifetime", { savedAt: "2026-11-20T10:00:00.000Z" });
	const articles = [old, stale, future, beforeSave];
	const { client, queries } = fakeLogs(() => complete([]));
	const report = await initFailureHistoryLogs({ client, now: () => CUTOFF.getTime() })({ articles, cutoff: CUTOFF });
	assert.equal(queries.every(isOwnerQuery), true);
	assert(queries.length > 1);
	for (const row of articles) {
		assert.deepEqual(report.get(row.key), {
			admissionSurface: undefined, admissionCovered: false, ownerOpenTimes: [], ownerOpensCovered: true,
		});
	}
});

test("an unavailable older owner interval preserves positives and marks only affected articles incomplete", async () => {
	const old = article("older", { savedAt: "2026-11-03T10:00:00.000Z" });
	const newArticle = article("recent");
	const { client } = fakeLogs((query) => {
		if (!isOwnerQuery(query)) return complete([]);
		assert(query.endTime);
		if (query.endTime < Date.parse(SAVED_AT) / 1_000) return { status: "Timeout" };
		return complete([ownerOpen(old.key, SAVED_AT)]);
	});
	const report = await initFailureHistoryLogs({ client, now: () => CUTOFF.getTime() })({ articles: [old, newArticle], cutoff: CUTOFF });
	assert.deepEqual(report.get(old.key), {
		admissionSurface: undefined, admissionCovered: true, ownerOpenTimes: [Date.parse(SAVED_AT)], ownerOpensCovered: false,
	});
	assert.deepEqual(report.get(newArticle.key), {
		admissionSurface: undefined, admissionCovered: true, ownerOpenTimes: [], ownerOpensCovered: true,
	});
});

const queryInput = { logGroupNames: ["/example"], queryString: "display timestamp", startTime: 1, endTime: 100 };

test("query waits for completion and passes back projected fields only", async () => {
	const { client } = fakeLogs(() => complete([]));
	let polls = 0;
	let waits = 0;
	const query = initFailureHistoryQuery({
		client: {
			...client,
			getQueryResults: async () => {
				polls += 1;
				if (polls === 1) return { status: "Running", results: [resultRow({ timestamp: "partial" })] };
				return complete([resultRow({ timestamp: "final", "@ptr": "irrelevant" })]);
			},
		},
		wake: async () => { waits += 1; },
	});
	assert.deepEqual(await query(queryInput), [new Map([["timestamp", "final"]])]);
	assert.equal(waits, 1);
});

test("query discards capped, truncated, failed and aborted results", async () => {
	const row = resultRow({ timestamp: "partial" });
	for (const response of [
		complete([row], 2),
		complete(Array.from({ length: 10_000 }, () => row)),
		{ ...complete([row]), nextToken: "another-page" },
		{ status: "Failed" } satisfies GetQueryResultsResponse,
	]) {
		const { client } = fakeLogs(() => response);
		assert.equal(await initFailureHistoryQuery({ client })(queryInput), undefined);
	}

	const { client, queries } = fakeLogs(() => { throw new Error("unavailable"); });
	const query = initFailureHistoryQuery({ client });
	assert.equal(await query(queryInput, AbortSignal.abort()), undefined);
	assert.deepEqual(queries, []);
	assert.equal(await query(queryInput), undefined);
});
