import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import {
	GmailForwardingConfirmedEvent,
	GmailForwardingConfirmFailedEvent,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { ConfirmForwardingAddressResult } from "./confirm-forwarding-address";
import { initConfirmGmailForwardingHandler } from "./confirm-gmail-forwarding-handler";

const VERIFY_URL = "https://mail.google.com/mail/vf-%5BANGjdJ_redacted%5D-M8fzAOTZ";
const GATEWAY = "gmail-a7b2c9@read.place";

function commandBody(): string {
	return JSON.stringify({
		detail: {
			userId: "00000000000000000000000000000001",
			forwardingAddress: GATEWAY,
			verifyUrl: VERIFY_URL,
		},
	});
}

function makeHarness(result: ConfirmForwardingAddressResult | (() => never)) {
	const posts: string[] = [];
	const published: { event: unknown; detail: unknown }[] = [];
	const handler = initConfirmGmailForwardingHandler({
		confirmForwardingAddress: async ({ verifyUrl }) => {
			posts.push(verifyUrl);
			if (typeof result === "function") return result();
			return result;
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
	return { run, posts, published };
}

describe("initConfirmGmailForwardingHandler", () => {
	it("POSTs the confirmation and publishes the confirmed fact", async () => {
		const { run, posts, published } = makeHarness({ ok: true });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(posts, [VERIFY_URL]);
		assert.equal(published.length, 1);
		assert.equal(published[0].event, GmailForwardingConfirmedEvent);
		assert.deepEqual(published[0].detail, {
			userId: "00000000000000000000000000000001",
			forwardingAddress: GATEWAY,
		});
	});

	it("ACKs a spent token and publishes the failure fact", async () => {
		const { run, published } = makeHarness({ ok: false, reason: "token-rejected", status: 400 });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(published.length, 1);
		assert.equal(published[0].event, GmailForwardingConfirmFailedEvent);
		assert.deepEqual(published[0].detail, {
			userId: "00000000000000000000000000000001",
			forwardingAddress: GATEWAY,
			reason: "token-rejected",
		});
	});

	it("retries when Google is unavailable", async () => {
		const { run, published } = makeHarness({ ok: false, reason: "unavailable", status: 503 });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.equal(response.batchItemFailures.length, 1);
		assert.deepEqual(published, []);
	});

	it("ACKs and publishes the failure fact when the interstitial came back", async () => {
		const { run, published } = makeHarness({ ok: false, reason: "not-confirmed" });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(published.length, 1);
		assert.equal(published[0].event, GmailForwardingConfirmFailedEvent);
	});

	it("ACKs a command whose URL failed the worker-side allowlist and publishes why", async () => {
		const { run, published } = makeHarness({ ok: false, reason: "invalid-url" });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(published.length, 1);
		assert.deepEqual(published[0].detail, {
			userId: "00000000000000000000000000000001",
			forwardingAddress: GATEWAY,
			reason: "invalid-url",
		});
	});

	it("fails a malformed command to the DLQ", async () => {
		const { run, posts } = makeHarness({ ok: true });

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: JSON.stringify({ detail: { nope: true } }) }]));

		assert.equal(response.batchItemFailures.length, 1);
		assert.deepEqual(posts, []);
	});

	it("retries when the POST itself throws", async () => {
		const { run } = makeHarness(() => {
			throw new Error("socket hang up");
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.equal(response.batchItemFailures.length, 1);
	});
});
