import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import {
	GmailFilterRewriteFailedEvent,
	GmailFilterRewrittenEvent,
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
	const handler = initRewriteGmailFilterHandler({
		rewriteGmailFilter: async ({ userId }) => {
			rewritten.push(userId);
			if (typeof outcome === "function") return outcome();
			return outcome;
		},
		publishEvent: (async (event, detail) => {
			published.push({ event, detail });
		}) as PublishEvent,
		logger: HutchLogger.from(noopLogger),
	});
	const run = async (event: SQSEvent) => {
		const response = await handler(event, buildLambdaContext(), () => {});
		assert(response, "the handler always returns a batch response");
		return response;
	};
	return { run, rewritten, published };
}

describe("initRewriteGmailFilterHandler", () => {
	it("publishes the rewritten fact with the filter it settled on", async () => {
		const { run, rewritten, published } = makeHarness({
			ok: true,
			filterId: "f-101",
			senderCount: 2,
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(rewritten, [USER]);
		assert.equal(published[0].event, GmailFilterRewrittenEvent);
		assert.deepEqual(published[0].detail, { userId: USER, filterId: "f-101", senderCount: 2 });
	});

	it("publishes the rewritten fact with no filter once the last sender is gone", async () => {
		const { run, published } = makeHarness({ ok: true, filterId: undefined, senderCount: 0 });

		await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody("sender-removed") }]));

		assert.deepEqual(published[0].detail, { userId: USER, filterId: undefined, senderCount: 0 });
	});

	it("retries a Gmail outage instead of publishing a failure", async () => {
		const { run, published } = makeHarness({ ok: false, reason: "unavailable", status: 503 });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "cmd-1" }] });
		assert.deepEqual(published, []);
	});

	it("ACKs a terminal failure and publishes why the filter was not written", async () => {
		const { run, published } = makeHarness({
			ok: false,
			reason: "query-too-long",
			message: "40 senders produce a 2396-character query",
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(published[0].event, GmailFilterRewriteFailedEvent);
		assert.deepEqual(published[0].detail, { userId: USER, reason: "query-too-long" });
	});

	it("retries a command whose detail it cannot read", async () => {
		const { run, rewritten } = makeHarness({ ok: true, filterId: "f-1", senderCount: 1 });

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
