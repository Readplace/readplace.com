import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { RewriteGmailFilterCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { AliasNameSchema, GMAIL_FORWARDING_ALIAS, type InboxAddress } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailForwardingConfirmedHandler } from "./gmail-forwarding-confirmed-handler";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const DOMAIN = "read.place";
const NOW = new Date("2026-08-27T00:00:00.000Z");

function eventBody(forwardingAddress: InboxAddress): string {
	return JSON.stringify({ detail: { userId: USER, forwardingAddress } });
}

function makeHarness(options: { failWrite?: boolean } = {}) {
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const addresses = initInMemoryInboxAddress({ now: () => NOW });
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
		addresses,
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
	return { run, connections, addresses, published };
}

describe("initGmailForwardingConfirmedHandler", () => {
	it("confirms the gateway address, marks the connection confirmed, and asks for the filter", async () => {
		const { run, connections, addresses, published } = makeHarness();
		const gateway = await addresses.createAddress({
			userId: USER,
			domain: DOMAIN,
			name: GMAIL_FORWARDING_ALIAS,
			purpose: "gmail-forwarding",
		});
		await connections.createConnection({ userId: USER, gatewayAddress: gateway.address });

		const response = await run(
			buildSqsEvent([{ messageId: "evt-1", body: eventBody(gateway.address) }]),
		);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal((await addresses.findByAddress(gateway.address))?.gmailConfirmedAt, NOW.toISOString());
		assert.equal(
			(await connections.findConnectionByUserId(USER))?.forwardingConfirmedAt,
			NOW.toISOString(),
		);
		assert.equal(published[0].event, RewriteGmailFilterCommand);
		assert.deepEqual(published[0].detail, { userId: USER, reason: "forwarding-confirmed" });
	});

	it("confirms a named inbox without flipping the gateway confirmation", async () => {
		const { run, connections, addresses, published } = makeHarness();
		const gateway = await addresses.createAddress({
			userId: USER,
			domain: DOMAIN,
			name: GMAIL_FORWARDING_ALIAS,
			purpose: "gmail-forwarding",
		});
		await connections.createConnection({ userId: USER, gatewayAddress: gateway.address });
		const inbox = await addresses.createAddress({
			userId: USER,
			domain: DOMAIN,
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});

		await run(buildSqsEvent([{ messageId: "evt-1", body: eventBody(inbox.address) }]));

		assert.equal((await addresses.findByAddress(inbox.address))?.gmailConfirmedAt, NOW.toISOString());
		assert.equal((await connections.findConnectionByUserId(USER))?.forwardingConfirmedAt, undefined);
		assert.deepEqual(published[0].detail, { userId: USER, reason: "forwarding-confirmed" });
	});

	it("stamps the address and still asks for the filter when no connection remains", async () => {
		const { run, connections, addresses, published } = makeHarness();
		const inbox = await addresses.createAddress({
			userId: USER,
			domain: DOMAIN,
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});

		await run(buildSqsEvent([{ messageId: "evt-1", body: eventBody(inbox.address) }]));

		assert.equal((await addresses.findByAddress(inbox.address))?.gmailConfirmedAt, NOW.toISOString());
		assert.equal(await connections.findConnectionByUserId(USER), undefined);
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
		const { run, connections, addresses, published } = makeHarness({ failWrite: true });
		const gateway = await addresses.createAddress({
			userId: USER,
			domain: DOMAIN,
			name: GMAIL_FORWARDING_ALIAS,
			purpose: "gmail-forwarding",
		});
		await connections.createConnection({ userId: USER, gatewayAddress: gateway.address });

		const response = await run(
			buildSqsEvent([{ messageId: "evt-1", body: eventBody(gateway.address) }]),
		);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "evt-1" }] });
		assert.deepEqual(published, []);
	});
});
