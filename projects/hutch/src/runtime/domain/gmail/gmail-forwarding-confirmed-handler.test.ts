import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { RewriteGmailFilterCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailForwardingConfirmedHandler } from "./gmail-forwarding-confirmed-handler";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const NOW = new Date("2026-08-27T00:00:00.000Z");

function eventBody(): string {
	return JSON.stringify({ detail: { userId: USER, forwardingAddress: GATEWAY } });
}

function makeHarness(options: { failWrite?: boolean } = {}) {
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const published: { event: unknown; detail: unknown }[] = [];
	const handler = initGmailForwardingConfirmedHandler({
		connections: options.failWrite
			? {
					...connections,
					markForwardingConfirmed: async () => {
						throw new Error("dynamo unavailable");
					},
				}
			: connections,
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
	return { run, connections, published };
}

describe("initGmailForwardingConfirmedHandler", () => {
	it("marks the connection confirmed and asks for the filter to be written", async () => {
		const { run, connections, published } = makeHarness();
		await connections.createConnection({
			userId: USER,
			gatewayAddress: GATEWAY,
			googleAccountEmail: "reader@gmail.com",
		});

		const response = await run(buildSqsEvent([{ messageId: "evt-1", body: eventBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(
			(await connections.findConnectionByUserId(USER))?.forwardingConfirmedAt,
			NOW.toISOString(),
		);
		assert.equal(published[0].event, RewriteGmailFilterCommand);
		assert.deepEqual(published[0].detail, { userId: USER, reason: "forwarding-confirmed" });
	});

	it("retries an event whose detail it cannot read", async () => {
		const { run, published } = makeHarness();

		const response = await run(
			buildSqsEvent([{ messageId: "evt-1", body: JSON.stringify({ detail: { userId: USER } }) }]),
		);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "evt-1" }] });
		assert.deepEqual(published, []);
	});

	it("retries a record whose write throws", async () => {
		const { run, published } = makeHarness({ failWrite: true });

		const response = await run(buildSqsEvent([{ messageId: "evt-1", body: eventBody() }]));

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "evt-1" }] });
		assert.deepEqual(published, []);
	});
});
