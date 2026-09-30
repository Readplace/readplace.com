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
import {
	GmailHistoryImportCompletedEvent,
	GmailHistoryImportFailedEvent,
	GmailHistoryImportMessageIngestedEvent,
	GmailHistoryImportPageProcessedEvent,
	ProcessGmailHistoryImportPageCommand,
	StartGmailHistoryImportCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailHistoryImportOutcomeDlqHandler, initGmailHistoryImportPageDlqHandler } from "./gmail-history-import-dlq-handler";

const READER = UserIdSchema.parse("reader-1");
const CREATED = "2026-09-29T00:00:00.000Z";
const NOW = new Date("2026-09-30T00:00:00.000Z");
const ZERO = { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 };

function jobIdOf(n: number) {
	return GmailHistoryImportJobIdSchema.parse(String(n).padStart(32, "0"));
}

async function queuedImport(imports: GmailHistoryImportStore, jobId: ReturnType<typeof jobIdOf>) {
	await imports.createJob({
		userId: READER,
		jobId,
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
	await imports.startJob({ userId: READER, jobId, generation: "generation-1", now: NOW });
}

function body(event: { detailType: string }, detail: unknown) {
	return JSON.stringify({ "detail-type": event.detailType, detail });
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

describe("initGmailHistoryImportPageDlqHandler", () => {
	it("fails the run each exhausted start, page or progress record belonged to", async () => {
		const h = harness();
		for (const n of [1, 2, 3]) await queuedImport(h.imports, jobIdOf(n));

		const response = await run(initGmailHistoryImportPageDlqHandler(h.deps), [
			{ messageId: "start", body: body(StartGmailHistoryImportCommand, { userId: READER, jobId: jobIdOf(1), generation: "generation-1" }) },
			{ messageId: "page", body: body(ProcessGmailHistoryImportPageCommand, { userId: READER, jobId: jobIdOf(2), generation: "generation-1", page: 0 }) },
			{ messageId: "progress", body: body(GmailHistoryImportPageProcessedEvent, { userId: READER, jobId: jobIdOf(3), nextPage: { generation: "generation-1", page: 1 } }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.published, [1, 2, 3].map((n) => ({
			event: GmailHistoryImportFailedEvent,
			detail: { userId: READER, jobId: jobIdOf(n), reason: "dead-lettered" },
		})));
	});

	it("leaves the current run alone when an exhausted record came from an older run or reported a finished one", async () => {
		const h = harness();
		await queuedImport(h.imports, jobIdOf(1));

		const response = await run(initGmailHistoryImportPageDlqHandler(h.deps), [
			{ messageId: "old", body: body(ProcessGmailHistoryImportPageCommand, { userId: READER, jobId: jobIdOf(1), generation: "generation-0", page: 0 }) },
			{ messageId: "finished", body: body(GmailHistoryImportPageProcessedEvent, { userId: READER, jobId: jobIdOf(1) }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.published, []);
		assert.equal((await h.imports.findJob({ userId: READER, jobId: jobIdOf(1) }))?.state, "queued");
	});

	it("fails a run whose start claimed its first page before the start was exhausted", async () => {
		const h = harness();
		await queuedImport(h.imports, jobIdOf(1));
		await h.imports.claimPage({ userId: READER, jobId: jobIdOf(1), generation: "generation-1", page: 0, now: NOW });

		await run(initGmailHistoryImportPageDlqHandler(h.deps), [
			{ messageId: "start", body: body(StartGmailHistoryImportCommand, { userId: READER, jobId: jobIdOf(1), generation: "generation-1" }) },
		]);

		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportFailedEvent, detail: { userId: READER, jobId: jobIdOf(1), reason: "dead-lettered" } },
		]);
		assert.equal((await h.imports.findJob({ userId: READER, jobId: jobIdOf(1) }))?.state, "failed");
	});

	it("returns malformed records for retry", async () => {
		const h = harness();

		const response = await run(initGmailHistoryImportPageDlqHandler(h.deps), [{ messageId: "bad", body: "not json" }]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "bad" }] });
	});
});

describe("initGmailHistoryImportOutcomeDlqHandler", () => {
	it("counts an undeliverable message as failed so the import can still finish", async () => {
		const h = harness();
		const jobId = jobIdOf(1);
		await queuedImport(h.imports, jobId);
		await h.imports.claimPage({ userId: READER, jobId, generation: "generation-1", page: 0, now: NOW });
		await h.imports.recordFetched({ userId: READER, jobId, generation: "generation-1", gmailMessageId: GmailMessageIdSchema.parse("only"), rawS3Key: "raw/only.eml", now: NOW });
		const listed = await h.imports.findJob({ userId: READER, jobId });
		assert(listed);
		await h.imports.savePage({ previous: listed, pageToken: undefined, now: NOW });

		const response = await run(initGmailHistoryImportOutcomeDlqHandler(h.deps), [
			{ messageId: "only", body: body(GmailHistoryImportMessageIngestedEvent, { userId: READER, jobId, generation: "generation-1", gmailMessageId: "only", outcome: "imported" }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportCompletedEvent, detail: { userId: READER, jobId, counts: { ...ZERO, listed: 1, failed: 1 } } },
		]);
	});
});
