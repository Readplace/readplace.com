import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { GmailDisconnectedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { DisconnectGmailOutcome } from "./disconnect-gmail";
import { initDisconnectGmailHandler } from "./disconnect-gmail-handler";

const USER = "00000000000000000000000000000001";

function commandBody(): string {
	return JSON.stringify({ detail: { userId: USER } });
}

function makeHarness(outcome: DisconnectGmailOutcome | (() => never)) {
	const published: { event: unknown; detail: unknown }[] = [];
	const handler = initDisconnectGmailHandler({
		disconnectGmail: async () => {
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
	return { run, published };
}

describe("initDisconnectGmailHandler", () => {
	it("publishes what the teardown actually managed to do", async () => {
		const { run, published } = makeHarness({
			ok: true,
			filterRemoved: true,
			grantRevoked: false,
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(published[0].event, GmailDisconnectedEvent);
		assert.deepEqual(published[0].detail, {
			userId: USER,
			filterRemoved: true,
			grantRevoked: false,
		});
	});

	it("retries while Google is unavailable", async () => {
		const { run, published } = makeHarness({ ok: false, reason: "unavailable" });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "cmd-1" }] });
		assert.deepEqual(published, []);
	});

	it("ACKs a command for a reader who was never connected", async () => {
		const { run, published } = makeHarness({ ok: false, reason: "not-connected" });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(published, []);
	});

	it("retries a command whose detail it cannot read", async () => {
		const { run } = makeHarness({ ok: true, filterRemoved: true, grantRevoked: true });

		const response = await run(
			buildSqsEvent([{ messageId: "cmd-1", body: JSON.stringify({ detail: {} }) }]),
		);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "cmd-1" }] });
	});

	it("retries a record that throws", async () => {
		const { run } = makeHarness(() => {
			throw new Error("dynamo unavailable");
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "cmd-1" }] });
	});
});
