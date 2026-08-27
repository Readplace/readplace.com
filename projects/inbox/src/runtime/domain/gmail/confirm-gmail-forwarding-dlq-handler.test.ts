import assert from "node:assert/strict";
import { HutchLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initConfirmGmailForwardingDlqHandler } from "./confirm-gmail-forwarding-dlq-handler";

const GATEWAY = "gmail-a7b2c9@read.place";

function makeHarness() {
	const errors: { message: string; data: unknown }[] = [];
	const handler = initConfirmGmailForwardingDlqHandler({
		logger: HutchLogger.from({
			info: () => {},
			warn: () => {},
			error: (...args: unknown[]) => {
				errors.push({ message: String(args[0]), data: args[1] });
			},
			debug: () => {},
		}),
	});
	const run = async (body: string) => {
		const response = await handler(
			buildSqsEvent([{ messageId: "dead-1", body }]),
			buildLambdaContext(),
			() => {},
		);
		assert(response, "the handler always returns a batch response");
		return response;
	};
	return { run, errors };
}

describe("initConfirmGmailForwardingDlqHandler", () => {
	it("names the address that never got confirmed and ACKs the dead letter", async () => {
		const { run, errors } = makeHarness();

		const response = await run(
			JSON.stringify({
				detail: {
					userId: "00000000000000000000000000000001",
					forwardingAddress: GATEWAY,
					verifyUrl: "https://mail.google.com/mail/vf-token",
				},
			}),
		);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(errors.length, 1);
		assert.equal(JSON.stringify(errors[0].data).includes(GATEWAY), true);
	});

	it("ACKs an unidentifiable command rather than replaying it forever", async () => {
		const { run, errors } = makeHarness();

		const response = await run(JSON.stringify({ detail: { nope: true } }));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(errors.length, 1);
	});

	it("ACKs a record whose body is not JSON at all", async () => {
		const { run, errors } = makeHarness();

		const response = await run("not-json");

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.equal(errors.length, 1);
	});
});
