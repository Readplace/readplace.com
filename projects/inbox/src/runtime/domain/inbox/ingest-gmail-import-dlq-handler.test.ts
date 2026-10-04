import assert from "node:assert/strict";
import { GmailHistoryImportMessageIngestedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initIngestGmailImportDlqHandler } from "./ingest-gmail-import-dlq-handler";

const FETCHED = {
	userId: "00000000000000000000000000000001",
	jobId: "0123456789abcdef0123456789abcdef",
	generation: "generation-1",
	gmailMessageId: "18c2f0a1b2c3d4e5",
	accountEmail: "reader@gmail.com",
	senderEmail: "dan@tldr.tech",
	destinationAddresses: ["gmail-abc123@read.place"],
	rawEmailS3Key: "gmail-import/reader/job/18c2f0a1b2c3d4e5.eml",
	internalDate: "2026-09-20T07:30:00.000Z",
};

function makeHarness(publishEvent: PublishEvent) {
	const errors: string[] = [];
	const handler = initIngestGmailImportDlqHandler({
		publishEvent,
		logger: HutchLogger.from({
			info: () => {},
			warn: () => {},
			error: (...args: unknown[]) => {
				errors.push(String(args[0]));
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

describe("initIngestGmailImportDlqHandler", () => {
	it("settles a dead-lettered import message as failed so its import can complete", async () => {
		const published: { event: unknown; detail: unknown }[] = [];
		const { run, errors } = makeHarness((async (event, detail) => {
			published.push({ event, detail });
		}) as PublishEvent);

		const response = await run(JSON.stringify({ detail: FETCHED }));

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(published, [
			{
				event: GmailHistoryImportMessageIngestedEvent,
				detail: {
					userId: FETCHED.userId,
					jobId: FETCHED.jobId,
					generation: FETCHED.generation,
					gmailMessageId: FETCHED.gmailMessageId,
					outcome: "failed",
				},
			},
		]);
		assert.deepEqual(errors, [
			"[ingest-gmail-import-dlq] import message gave up",
		]);
	});

	it("keeps the dead letter for another attempt when the failed outcome cannot be published", async () => {
		const { run, errors } = makeHarness((async () => {
			throw new Error("event bus unavailable");
		}) as PublishEvent);

		const response = await run(JSON.stringify({ detail: FETCHED }));

		assert.deepEqual(response, {
			batchItemFailures: [{ itemIdentifier: "dead-1" }],
		});
		assert.deepEqual(errors, ["[ingest-gmail-import-dlq] record failed"]);
	});

	it("acknowledges a dead letter that names no import message", async () => {
		const published: unknown[] = [];
		const { run, errors } = makeHarness((async (_event, detail) => {
			published.push(detail);
		}) as PublishEvent);

		const response = await run("not-json");

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(published, []);
		assert.deepEqual(errors, [
			"[ingest-gmail-import-dlq] unidentifiable fetched message",
		]);
	});
});
