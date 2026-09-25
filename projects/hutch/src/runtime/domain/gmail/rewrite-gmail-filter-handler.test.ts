import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import {
	GMAIL_FILTER_REWRITE_FAILED_EVENT,
	type GmailFilterRewriteFailedLine,
	GmailFilterRewriteFailedEvent,
	GmailFilterRewrittenEvent,
	METERED_GMAIL_FILTER_REWRITE_REASONS,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initRewriteGmailFilterHandler } from "./rewrite-gmail-filter-handler";
import type { RewriteGmailFilterOutcome } from "./rewrite-gmail-filter";

const USER = "00000000000000000000000000000001";

function commandBody(reason = "sender-added"): string {
	return JSON.stringify({ detail: { userId: USER, reason } });
}

function makeHarness(outcome: RewriteGmailFilterOutcome | (() => never)) {
	const rewritten: string[] = [];
	const published: { event: unknown; detail: unknown }[] = [];
	const metricLines: GmailFilterRewriteFailedLine[] = [];
	const capture = (line: GmailFilterRewriteFailedLine) => {
		metricLines.push(line);
	};
	const handler = initRewriteGmailFilterHandler({
		rewriteGmailFilter: async ({ userId }) => {
			rewritten.push(userId);
			if (typeof outcome === "function") return outcome();
			return outcome;
		},
		publishEvent: (async (event, detail) => {
			published.push({ event, detail });
		}) as PublishEvent,
		metricLog: { info: capture, error: capture, warn: capture, debug: capture },
		logger: HutchLogger.from(noopLogger),
	});
	const run = async (event: SQSEvent) => {
		const response = await handler(event, buildLambdaContext(), () => {});
		assert(response, "the handler always returns a batch response");
		return response;
	};
	return { run, rewritten, published, metricLines };
}

const METERED_OUTCOME: {
	[R in (typeof METERED_GMAIL_FILTER_REWRITE_REASONS)[number]]: Extract<
		RewriteGmailFilterOutcome,
		{ reason: R }
	>;
} = {
	"query-too-long": {
		ok: false,
		reason: "query-too-long",
		forwardTo: "gmail-a7b2c9@read.place",
		senderCount: 40,
		senderCapacity: 36,
	},
	rejected: {
		ok: false,
		reason: "rejected",
		message: "Gmail stored a different query than the one sent",
	},
};

const nonMeteredOutcomes: Extract<RewriteGmailFilterOutcome, { ok: false }>[] = [
	{ ok: false, reason: "not-connected" },
	{ ok: false, reason: "not-confirmed" },
	{ ok: false, reason: "reauth-required" },
];

describe("initRewriteGmailFilterHandler", () => {
	it("publishes the rewritten fact with the sender count it settled on", async () => {
		const { run, rewritten, published } = makeHarness({
			ok: true,
			filterCount: 2,
			senderCount: 2,
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(rewritten, [USER]);
		assert.equal(published[0].event, GmailFilterRewrittenEvent);
		assert.deepEqual(published[0].detail, { userId: USER, senderCount: 2 });
	});

	it("publishes the rewritten fact with no senders once the last sender is gone", async () => {
		const { run, published } = makeHarness({ ok: true, filterCount: 0, senderCount: 0 });

		await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody("sender-removed") }]));

		assert.deepEqual(published[0].detail, { userId: USER, senderCount: 0 });
	});

	it("retries a Gmail outage instead of publishing a failure or metering it", async () => {
		const { run, published, metricLines } = makeHarness({
			ok: false,
			reason: "unavailable",
			status: 503,
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "cmd-1" }] });
		assert.deepEqual(published, []);
		assert.deepEqual(metricLines, []);
	});

	it.each(METERED_GMAIL_FILTER_REWRITE_REASONS)(
		"ACKs a terminal %s failure, publishes the fact, and meters it as one pure-JSON error line",
		async (reason) => {
			const { run, published, metricLines } = makeHarness(METERED_OUTCOME[reason]);

			const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

			assert.deepEqual(response, { batchItemFailures: [] });
			assert.equal(published[0].event, GmailFilterRewriteFailedEvent);
			assert.deepEqual(published[0].detail, { userId: USER, reason });
			assert.deepEqual(metricLines, [
				{
					level: "ERROR",
					message: "[rewrite-gmail-filter] filter not written",
					event: GMAIL_FILTER_REWRITE_FAILED_EVENT,
					reason,
					userId: USER,
				},
			]);
		},
	);

	it.each(nonMeteredOutcomes)(
		"ACKs and publishes a $reason terminal failure but writes no metric line — it is a reader-state or reauth outcome, not an operational error",
		async (outcome) => {
			const { run, published, metricLines } = makeHarness(outcome);

			const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

			assert.deepEqual(response, { batchItemFailures: [] });
			assert.equal(published[0].event, GmailFilterRewriteFailedEvent);
			assert.deepEqual(published[0].detail, { userId: USER, reason: outcome.reason });
			assert.deepEqual(metricLines, []);
		},
	);

	it("retries a command whose detail it cannot read", async () => {
		const { run, rewritten } = makeHarness({ ok: true, filterCount: 1, senderCount: 1 });

		const response = await run(
			buildSqsEvent([{ messageId: "cmd-1", body: JSON.stringify({ detail: { userId: USER } }) }]),
		);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "cmd-1" }] });
		assert.deepEqual(rewritten, []);
	});

	it("retries a record that throws without losing the rest of the batch", async () => {
		const { run, published } = makeHarness(() => {
			throw new Error("dynamo unavailable");
		});

		const response = await run(
			buildSqsEvent([
				{ messageId: "cmd-1", body: commandBody() },
				{ messageId: "cmd-2", body: commandBody() },
			]),
		);

		assert.deepEqual(response, {
			batchItemFailures: [{ itemIdentifier: "cmd-1" }, { itemIdentifier: "cmd-2" }],
		});
		assert.deepEqual(published, []);
	});
});
