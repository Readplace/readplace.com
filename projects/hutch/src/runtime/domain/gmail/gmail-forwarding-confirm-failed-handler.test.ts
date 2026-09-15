import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { type InboxAddress, InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailForwardingConfirmFailedHandler } from "./gmail-forwarding-confirm-failed-handler";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const NAMED = InboxAddressSchema.parse("tech-1a2b3c@read.place");
const NOW = new Date("2026-08-27T00:00:00.000Z");

function eventBody(forwardingAddress: InboxAddress, reason: string): string {
	return JSON.stringify({ detail: { userId: USER, forwardingAddress, reason } });
}

function makeHarness(options: { failWrite?: boolean } = {}) {
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const handler = initGmailForwardingConfirmFailedHandler({
		connections: options.failWrite
			? {
					...connections,
					recordConfirmError: async () => {
						throw new Error("dynamo unavailable");
					},
				}
			: connections,
		now: () => NOW,
		logger: HutchLogger.from(noopLogger),
	});
	const run = async (event: SQSEvent) => {
		const response = await handler(event, buildLambdaContext(), () => {});
		assert(response, "the handler always returns a batch response");
		return response;
	};
	return { run, connections };
}

describe("initGmailForwardingConfirmFailedHandler", () => {
	it("stamps the reason and time on an unconfirmed gateway", async () => {
		const { run, connections } = makeHarness();
		await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });

		const response = await run(
			buildSqsEvent([{ messageId: "evt-1", body: eventBody(GATEWAY, "token-rejected") }]),
		);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual((await connections.findConnectionByUserId(USER))?.lastConfirmError, {
			reason: "token-rejected",
			at: NOW.toISOString(),
		});
	});

	it("leaves a confirmed row alone", async () => {
		const { run, connections } = makeHarness();
		await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });
		await connections.markForwardingConfirmed({ userId: USER });

		await run(buildSqsEvent([{ messageId: "evt-1", body: eventBody(GATEWAY, "token-rejected") }]));

		assert.equal((await connections.findConnectionByUserId(USER))?.lastConfirmError, undefined);
	});

	it("leaves the row alone when the failed address is a named inbox", async () => {
		const { run, connections } = makeHarness();
		await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });

		await run(buildSqsEvent([{ messageId: "evt-1", body: eventBody(NAMED, "not-confirmed") }]));

		assert.equal((await connections.findConnectionByUserId(USER))?.lastConfirmError, undefined);
	});

	it("does nothing when no connection exists", async () => {
		const { run, connections } = makeHarness();

		const response = await run(
			buildSqsEvent([{ messageId: "evt-1", body: eventBody(GATEWAY, "invalid-url") }]),
		);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(await connections.findConnectionByUserId(USER), undefined);
	});

	it("retries a malformed detail", async () => {
		const { run, connections } = makeHarness();
		await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });

		const response = await run(
			buildSqsEvent([
				{ messageId: "evt-1", body: JSON.stringify({ detail: { userId: USER, forwardingAddress: GATEWAY } }) },
			]),
		);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "evt-1" }] });
		assert.equal((await connections.findConnectionByUserId(USER))?.lastConfirmError, undefined);
	});

	it("retries a record whose write throws", async () => {
		const { run, connections } = makeHarness({ failWrite: true });
		await connections.createConnection({ userId: USER, gatewayAddress: GATEWAY });

		const response = await run(
			buildSqsEvent([{ messageId: "evt-1", body: eventBody(GATEWAY, "token-rejected") }]),
		);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "evt-1" }] });
	});
});
