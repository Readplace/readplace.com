import assert from "node:assert/strict";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	GmailHistoryImportJobIdSchema,
	type GmailHistoryImportStore,
	GmailMessageIdSchema,
} from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { GmailHistoryImportCompletedEvent, GmailHistoryImportMessageIngestedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initRecordGmailHistoryImportOutcomeHandler } from "./record-gmail-history-import-outcome-handler";

const READER = UserIdSchema.parse("reader-1");
const JOB = GmailHistoryImportJobIdSchema.parse("0".repeat(31).concat("1"));
const CREATED = "2026-09-29T00:00:00.000Z";
const NOW = new Date("2026-09-30T00:00:00.000Z");
const ZERO = { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 };

async function runningImportOf(imports: GmailHistoryImportStore, messageIds: string[]) {
	await imports.createJob({
		userId: READER,
		jobId: JOB,
		senderEmail: ForwardableSenderSchema.parse("dan@tldrnewsletter.com"),
		destinationAddress: InboxAddressSchema.parse("gmail-abc123@read.place"),
		connection: {
			gatewayAddress: InboxAddressSchema.parse("gmail-def456@read.place"),
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		},
		window: undefined,
		generation: "generation-0",
		page: 0,
		pageToken: undefined,
		listingCompletedAt: undefined,
		state: "awaiting-permission",
		counts: ZERO,
		failureReason: undefined,
		cancelReason: undefined,
		createdAt: CREATED,
		updatedAt: CREATED,
		completedAt: undefined,
	});
	await imports.startJob({ userId: READER, jobId: JOB, generation: "generation-1", now: NOW });
	await imports.claimPage({ userId: READER, jobId: JOB, generation: "generation-1", page: 0, now: NOW });
	for (const id of messageIds) {
		await imports.recordFetched({ userId: READER, jobId: JOB, generation: "generation-1", gmailMessageId: GmailMessageIdSchema.parse(id), rawS3Key: `raw/${id}.eml`, now: NOW });
	}
	const listed = await imports.findJob({ userId: READER, jobId: JOB });
	assert(listed);
	await imports.savePage({ previous: listed, pageToken: undefined, now: NOW });
}

function ingested(input: { gmailMessageId: string; outcome: "imported" | "failed"; generation?: string }) {
	return JSON.stringify({
		"detail-type": GmailHistoryImportMessageIngestedEvent.detailType,
		detail: { userId: READER, jobId: JOB, generation: input.generation ?? "generation-1", gmailMessageId: input.gmailMessageId, outcome: input.outcome },
	});
}

async function run(handler: Handler<SQSEvent, SQSBatchResponse>, records: { messageId: string; body: string }[]) {
	const response = await handler(buildSqsEvent(records), buildLambdaContext(), () => {});
	assert(response);
	return response;
}

function harness() {
	const imports = initInMemoryGmailHistoryImport();
	const published: { event: unknown; detail: unknown }[] = [];
	const deps = {
		imports,
		publishEvent: (async (event, detail) => { published.push({ event, detail }); }) as PublishEvent,
		now: () => NOW,
		logger: HutchLogger.from(noopLogger),
	};
	return { imports, published, deps };
}

describe("initRecordGmailHistoryImportOutcomeHandler", () => {
	it("counts each outcome and announces the import once the last message settles", async () => {
		const h = harness();
		await runningImportOf(h.imports, ["first", "second"]);

		const response = await run(initRecordGmailHistoryImportOutcomeHandler(h.deps), [
			{ messageId: "first", body: ingested({ gmailMessageId: "first", outcome: "imported" }) },
			{ messageId: "second", body: ingested({ gmailMessageId: "second", outcome: "failed" }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportCompletedEvent, detail: { userId: READER, jobId: JOB, counts: { ...ZERO, listed: 2, imported: 1, failed: 1 } } },
		]);
	});

	it("ignores a redelivered outcome and an outcome from a superseded run", async () => {
		const h = harness();
		await runningImportOf(h.imports, ["first", "second"]);
		const handler = initRecordGmailHistoryImportOutcomeHandler(h.deps);
		await run(handler, [{ messageId: "first", body: ingested({ gmailMessageId: "first", outcome: "imported" }) }]);

		const response = await run(handler, [
			{ messageId: "again", body: ingested({ gmailMessageId: "first", outcome: "imported" }) },
			{ messageId: "old", body: ingested({ gmailMessageId: "second", outcome: "imported", generation: "generation-0" }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.published, []);
		assert.deepEqual((await h.imports.findJob({ userId: READER, jobId: JOB }))?.counts, { ...ZERO, listed: 2, imported: 1 });
	});

	it("completes the import when the last outcome is redelivered after its completion step was interrupted", async () => {
		const h = harness();
		await runningImportOf(h.imports, ["only"]);
		let interrupted = false;
		const handler = initRecordGmailHistoryImportOutcomeHandler({
			...h.deps,
			imports: {
				...h.imports,
				completeIfSettled: async (input) => {
					if (!interrupted) {
						interrupted = true;
						throw new Error("Lambda timed out");
					}
					return h.imports.completeIfSettled(input);
				},
			},
		});

		const first = await run(handler, [{ messageId: "only", body: ingested({ gmailMessageId: "only", outcome: "imported" }) }]);
		const redelivered = await run(handler, [{ messageId: "only", body: ingested({ gmailMessageId: "only", outcome: "imported" }) }]);

		assert.deepEqual(first, { batchItemFailures: [{ itemIdentifier: "only" }] });
		assert.deepEqual(redelivered, { batchItemFailures: [] });
		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportCompletedEvent, detail: { userId: READER, jobId: JOB, counts: { ...ZERO, listed: 1, imported: 1 } } },
		]);
	});

	it("returns malformed records for retry", async () => {
		const h = harness();

		const response = await run(initRecordGmailHistoryImportOutcomeHandler(h.deps), [
			{ messageId: "bad", body: "not json" },
		]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "bad" }] });
	});
});
