import assert from "node:assert/strict";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJob,
	GmailHistoryImportJobIdSchema,
} from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import {
	GmailHistoryImportCompletedEvent,
	GmailHistoryImportFailedEvent,
	GmailHistoryImportPageProcessedEvent,
	ProcessGmailHistoryImportPageCommand,
	StartGmailHistoryImportCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { GmailHistoryImport, GmailHistoryImportPage, GmailHistoryImportStep } from "./gmail-history-import";
import { initGmailHistoryImportHandler } from "./gmail-history-import-handler";

const USER = UserIdSchema.parse("reader-1");
const JOB = GmailHistoryImportJobIdSchema.parse("0".repeat(32));
const PAGE: GmailHistoryImportPage = { userId: USER, jobId: JOB, generation: "generation-1", page: 1 };
const COUNTS = { listed: 1, imported: 1, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 };
const COMPLETED_JOB: GmailHistoryImportJob = {
	userId: USER,
	jobId: JOB,
	senderEmail: ForwardableSenderSchema.parse("dan@tldrnewsletter.com"),
	destinationAddress: InboxAddressSchema.parse("gmail-abc123@read.place"),
	connection: {
		gatewayAddress: InboxAddressSchema.parse("gmail-def456@read.place"),
		accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	},
	window: undefined,
	generation: "generation-1",
	page: 1,
	pageToken: undefined,
	listingCompletedAt: "2026-09-30T00:00:00.000Z",
	state: "complete",
	counts: COUNTS,
	failureReason: undefined,
	cancelReason: undefined,
	createdAt: "2026-09-29T00:00:00.000Z",
	updatedAt: "2026-09-30T00:00:00.000Z",
	completedAt: "2026-09-30T00:00:00.000Z",
};

function body(event: { detailType: string }, detail: unknown) {
	return JSON.stringify({ "detail-type": event.detailType, detail });
}

async function run(handler: Handler<SQSEvent, SQSBatchResponse>, records: { messageId: string; body: string }[]) {
	const response = await handler(buildSqsEvent(records), buildLambdaContext(), () => {});
	assert(response);
	return response;
}

function harness(steps: { start: GmailHistoryImportStep; page: GmailHistoryImportStep }) {
	const published: { event: unknown; detail: unknown }[] = [];
	const dispatched: GmailHistoryImportPage[] = [];
	const calls: unknown[] = [];
	const importer: GmailHistoryImport = {
		start: async (input) => { calls.push({ start: input }); return steps.start; },
		page: async (input) => { calls.push({ page: input }); return steps.page; },
	};
	const deps = {
		importer,
		dispatchPage: async (input: GmailHistoryImportPage) => { dispatched.push(input); },
		publishEvent: (async (event, detail) => { published.push({ event, detail }); }) as PublishEvent,
		logger: HutchLogger.from(noopLogger),
	};
	return { deps, published, dispatched, calls };
}

describe("initGmailHistoryImportHandler", () => {
	it("announces the page that follows a start step", async () => {
		const h = harness({
			start: { next: PAGE, completed: undefined, failed: undefined },
			page: { next: undefined, completed: undefined, failed: undefined },
		});

		const response = await run(initGmailHistoryImportHandler(h.deps), [
			{ messageId: "start", body: body(StartGmailHistoryImportCommand, { userId: USER, jobId: JOB, generation: "generation-1" }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.calls, [{ start: { userId: USER, jobId: JOB, generation: "generation-1" } }]);
		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportPageProcessedEvent, detail: { userId: USER, jobId: JOB, nextPage: { generation: "generation-1", page: 1 } } },
		]);
	});

	it("announces a completed import and ends the page loop", async () => {
		const h = harness({
			start: { next: undefined, completed: undefined, failed: undefined },
			page: { next: undefined, completed: COMPLETED_JOB, failed: undefined },
		});

		await run(initGmailHistoryImportHandler(h.deps), [
			{ messageId: "page", body: JSON.stringify({ detail: PAGE }) },
		]);

		assert.deepEqual(h.calls, [{ page: PAGE }]);
		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportCompletedEvent, detail: { userId: USER, jobId: JOB, counts: COUNTS } },
			{ event: GmailHistoryImportPageProcessedEvent, detail: { userId: USER, jobId: JOB, nextPage: undefined } },
		]);
	});

	it("announces a failed import and ends the page loop", async () => {
		const h = harness({
			start: { next: undefined, completed: undefined, failed: "permission-revoked" },
			page: { next: undefined, completed: undefined, failed: undefined },
		});

		await run(initGmailHistoryImportHandler(h.deps), [
			{ messageId: "start", body: body(StartGmailHistoryImportCommand, { userId: USER, jobId: JOB, generation: "generation-1" }) },
		]);

		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportFailedEvent, detail: { userId: USER, jobId: JOB, reason: "permission-revoked" } },
			{ event: GmailHistoryImportPageProcessedEvent, detail: { userId: USER, jobId: JOB, nextPage: undefined } },
		]);
	});

	it("dispatches the next page when progress names one and stops when it does not", async () => {
		const nothing = { next: undefined, completed: undefined, failed: undefined };
		const h = harness({ start: nothing, page: nothing });

		await run(initGmailHistoryImportHandler(h.deps), [
			{ messageId: "progress", body: body(GmailHistoryImportPageProcessedEvent, { userId: USER, jobId: JOB, nextPage: { generation: "generation-1", page: 1 } }) },
			{ messageId: "done", body: body(GmailHistoryImportPageProcessedEvent, { userId: USER, jobId: JOB }) },
			{ messageId: "command", body: body(ProcessGmailHistoryImportPageCommand, PAGE) },
		]);

		assert.deepEqual(h.dispatched, [PAGE]);
		assert.deepEqual(h.calls, [{ page: PAGE }]);
		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportPageProcessedEvent, detail: { userId: USER, jobId: JOB, nextPage: undefined } },
		]);
	});

	it("returns only the records that failed so SQS retries them", async () => {
		const nothing = { next: undefined, completed: undefined, failed: undefined };
		const h = harness({ start: nothing, page: nothing });
		const failingPublish: PublishEvent = async () => { throw new Error("EventBridge unavailable"); };

		const response = await run(initGmailHistoryImportHandler({ ...h.deps, publishEvent: failingPublish }), [
			{ messageId: "bad", body: "not json" },
			{ messageId: "start", body: body(StartGmailHistoryImportCommand, { userId: USER, jobId: JOB, generation: "generation-1" }) },
			{ messageId: "done", body: body(GmailHistoryImportPageProcessedEvent, { userId: USER, jobId: JOB }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "bad" }, { itemIdentifier: "start" }] });
	});
});
