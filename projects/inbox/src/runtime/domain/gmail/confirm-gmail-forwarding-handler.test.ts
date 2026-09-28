import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import {
	GMAIL_FORWARDING_CONFIRM_FAILED_EVENT,
	type GmailForwardingConfirmFailedLine,
	GmailForwardingConfirmedEvent,
	GmailForwardingConfirmFailedEvent,
	METERED_GMAIL_FORWARDING_CONFIRM_REASONS,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { ConfirmForwardingAddressResult } from "./confirm-forwarding-address";
import { initConfirmGmailForwardingHandler } from "./confirm-gmail-forwarding-handler";

const VERIFY_URL = "https://mail.google.com/mail/vf-%5BANGjdJ_redacted%5D-M8fzAOTZ";
const GATEWAY = "gmail-a7b2c9@read.place";
const USER = "00000000000000000000000000000001";

function commandBody(): string {
	return JSON.stringify({
		detail: {
			userId: USER,
			forwardingAddress: GATEWAY,
			verifyUrl: VERIFY_URL,
		},
	});
}

function makeHarness(result: ConfirmForwardingAddressResult | (() => never)) {
	const posts: string[] = [];
	const published: { event: unknown; detail: unknown }[] = [];
	const logs: { message: string; data: unknown }[] = [];
	const logCapture = (...args: unknown[]) => {
		logs.push({ message: String(args[0]), data: args[1] });
	};
	const metricLines: GmailForwardingConfirmFailedLine[] = [];
	const metricCapture = (line: GmailForwardingConfirmFailedLine) => {
		metricLines.push(line);
	};
	const handler = initConfirmGmailForwardingHandler({
		confirmForwardingAddress: async ({ verifyUrl }) => {
			posts.push(verifyUrl);
			if (typeof result === "function") return result();
			return result;
		},
		publishEvent: (async (event, detail) => {
			published.push({ event, detail });
		}) as PublishEvent,
		metricLog: { info: metricCapture, error: metricCapture, warn: metricCapture, debug: metricCapture },
		logger: HutchLogger.from({ info: logCapture, warn: logCapture, error: logCapture, debug: logCapture }),
	});
	const run = async (event: SQSEvent) => {
		const response = await handler(event, buildLambdaContext(), () => {});
		assert(response, "the handler always returns a batch response");
		return response;
	};
	return { run, posts, published, logs, metricLines };
}

const METERED_RESULT: {
	[R in (typeof METERED_GMAIL_FORWARDING_CONFIRM_REASONS)[number]]: Extract<
		ConfirmForwardingAddressResult,
		{ reason: R }
	>;
} = {
	"not-confirmed": { ok: false, reason: "not-confirmed" },
	"invalid-url": { ok: false, reason: "invalid-url" },
};

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

	it("ACKs a spent token, publishes the failure fact, and does not meter it (a re-clicked link is not an operational error)", async () => {
		const { run, published, metricLines } = makeHarness({
			ok: false,
			reason: "token-rejected",
			status: 400,
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(published.length, 1);
		assert.equal(published[0].event, GmailForwardingConfirmFailedEvent);
		assert.deepEqual(published[0].detail, {
			userId: USER,
			forwardingAddress: GATEWAY,
			reason: "token-rejected",
		});
		assert.deepEqual(metricLines, []);
	});

	it("retries when Google is unavailable, without publishing or metering a failure", async () => {
		const { run, published, metricLines } = makeHarness({
			ok: false,
			reason: "unavailable",
			status: 503,
		});

		const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

		assert.equal(response.batchItemFailures.length, 1);
		assert.deepEqual(published, []);
		assert.deepEqual(metricLines, []);
	});

	it.each(METERED_GMAIL_FORWARDING_CONFIRM_REASONS)(
		"ACKs a terminal %s confirmation, publishes the fact, and meters it as one pure-JSON error line",
		async (reason) => {
			const { run, published, metricLines } = makeHarness(METERED_RESULT[reason]);

			const response = await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

			assert.deepEqual(response, { batchItemFailures: [] });
			assert.equal(published.length, 1);
			assert.equal(published[0].event, GmailForwardingConfirmFailedEvent);
			assert.deepEqual(published[0].detail, {
				userId: USER,
				forwardingAddress: GATEWAY,
				reason,
			});
			assert.deepEqual(metricLines, [
				{
					level: "ERROR",
					message: "[confirm-gmail-forwarding] confirmation did not complete",
					event: GMAIL_FORWARDING_CONFIRM_FAILED_EVENT,
					reason,
					userId: USER,
				},
			]);
		},
	);

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

	it("logs each outcome by user id and never writes the gateway address", async () => {
		const outcomes: ConfirmForwardingAddressResult[] = [
			{ ok: true },
			{ ok: false, reason: "unavailable", status: 503 },
			{ ok: false, reason: "token-rejected", status: 400 },
			{ ok: false, reason: "not-confirmed" },
		];
		for (const outcome of outcomes) {
			const { run, logs, metricLines } = makeHarness(outcome);

			await run(buildSqsEvent([{ messageId: "cmd-1", body: commandBody() }]));

			const lines = [...logs, ...metricLines];
			assert.equal(lines.length, 1);
			assert.equal(JSON.stringify(lines[0]).includes(GATEWAY), false);
			assert.equal(JSON.stringify(lines[0]).includes("00000000000000000000000000000001"), true);
		}
	});
});
