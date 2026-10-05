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
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initGmailHistoryImportOutcomeDlqHandler, initGmailHistoryImportPageDlqHandler } from "./gmail-history-import-dlq-handler";
import { type CapturedGmailDiagnostic, captureGmailDiagnostics, throwingGmailDiagnosticSink } from "./gmail-import-diagnostics.test-helper";

const READER = UserIdSchema.parse("reader-1");
const CREATED = "2026-09-29T00:00:00.000Z";
const NOW = new Date("2026-09-30T00:00:00.000Z");
const ZERO = { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 };
const DLQ_ARN = "arn:aws:sqs:ap-southeast-2:111122223333:gmail-history-import-dlq";
const PAGES_QUEUE_ARN = "arn:aws:sqs:ap-southeast-2:111122223333:gmail-history-import-pages-q";
const OUTCOMES_QUEUE_ARN = "arn:aws:sqs:ap-southeast-2:111122223333:gmail-history-import-outcomes-q";

function jobIdOf(n: number) {
	return GmailHistoryImportJobIdSchema.parse(String(n).padStart(32, "0"));
}

async function queuedImport(imports: GmailHistoryImportStore, jobId: ReturnType<typeof jobIdOf>) {
	await imports.createJob({
		userId: READER,
		jobId,
		senderEmail: ForwardableSenderSchema.parse("dan@tldrnewsletter.com"),
		destinationAddresses: [InboxAddressSchema.parse("gmail-abc123@read.place")],
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

function deadLetters(records: { messageId: string; body: string }[], sourceArn: string): SQSEvent {
	return {
		Records: buildSqsEvent(records).Records.map((record) => ({
			...record,
			eventSourceARN: DLQ_ARN,
			attributes: { ...record.attributes, ApproximateReceiveCount: "1", DeadLetterQueueSourceArn: sourceArn },
		})),
	};
}

async function run(handler: Handler<SQSEvent, SQSBatchResponse>, records: { messageId: string; body: string }[], sourceArn = PAGES_QUEUE_ARN) {
	const response = await handler(deadLetters(records, sourceArn), { ...buildLambdaContext(), awsRequestId: "invocation-1" }, () => {});
	assert(response);
	return response;
}

function trail(lines: CapturedGmailDiagnostic[]) {
	return lines.map((line) => [line.sequence, line.event, line.level, line.step ?? (line.target === undefined ? line.outcome : `${line.target} ${line.outcome}`)]);
}

function linesOf(lines: CapturedGmailDiagnostic[], sqsMessageId: string) {
	return lines.filter((line) => line.sqsMessageId === sqsMessageId);
}

function harness() {
	const imports = initInMemoryGmailHistoryImport();
	const published: { event: unknown; detail: unknown }[] = [];
	const capture = captureGmailDiagnostics({ now: () => NOW });
	const deps = {
		imports,
		publishEvent: (async (event, detail) => { published.push({ event, detail }); }) as PublishEvent,
		now: () => NOW,
		logger: capture.logger,
		recordDiagnostic: capture.recordDiagnostic,
	};
	return { imports, published, deps, capture };
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
		const lines = h.capture.diagnostics();
		for (const [n, sqsMessageId, envelopeKind, page] of [[1, "start", "start", 0], [2, "page", "page", 0], [3, "progress", "progress", 1]] as const) {
			const recordLines = linesOf(lines, sqsMessageId);
			assert.deepEqual(trail(recordLines), [
				[undefined, "gmail.import.record.started", "INFO", undefined],
				[1, "gmail.import.step", "ERROR", { kind: "job-failed", reason: "dead-lettered", persisted: true }],
				[2, "gmail.import.publication", "INFO", "GmailHistoryImportFailed published"],
				[undefined, "gmail.import.record.finished", "INFO", "acked"],
			]);
			assert.deepEqual(recordLines[0], {
				version: 1,
				timestamp: NOW.toISOString(),
				handler: "history-import-page-dlq",
				invocationId: "invocation-1",
				sqsMessageId,
				receiveCount: 1,
				sourceQueue: "gmail-history-import-dlq",
				deadLetterSourceQueue: "gmail-history-import-pages-q",
				event: "gmail.import.record.started",
				level: "INFO",
			});
			assert.deepEqual(recordLines.slice(1).map((line) => [line.envelopeKind, line.userId, line.jobId, line.generation, line.page]), [1, 2, 3].map(() => [envelopeKind, READER, jobIdOf(n), "generation-1", page]));
		}
		assert.equal(lines.length, 12);
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
		const lines = h.capture.diagnostics();
		assert.deepEqual(trail(linesOf(lines, "old")), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "ERROR", { kind: "job-failed", reason: "dead-lettered", persisted: false }],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.deepEqual(trail(linesOf(lines, "finished")), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "dead-letter-without-generation" }],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.deepEqual(linesOf(lines, "finished").at(-1)?.generation, undefined);
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
		assert.deepEqual(h.capture.diagnostics().map((line) => [line.event, line.level, line.outcome, line.errorName, line.userId, line.deadLetterSourceQueue]), [
			["gmail.import.record.started", "INFO", undefined, undefined, undefined, "gmail-history-import-pages-q"],
			["gmail.import.record.finished", "ERROR", "retry-requested", "SyntaxError", undefined, "gmail-history-import-pages-q"],
		]);
		assert.equal(h.capture.otherLines().length, 1);
	});

	it("shows a run failed before its announcement was refused, and returns the record for retry", async () => {
		const h = harness();
		await queuedImport(h.imports, jobIdOf(1));
		const refused = new RangeError("EventBridge throttled the entry");

		const response = await run(initGmailHistoryImportPageDlqHandler({ ...h.deps, publishEvent: async () => { throw refused; } }), [
			{ messageId: "start", body: body(StartGmailHistoryImportCommand, { userId: READER, jobId: jobIdOf(1), generation: "generation-1" }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "start" }] });
		assert.equal((await h.imports.findJob({ userId: READER, jobId: jobIdOf(1) }))?.state, "failed");
		const lines = h.capture.diagnostics();
		assert.deepEqual(trail(lines), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "ERROR", { kind: "job-failed", reason: "dead-lettered", persisted: true }],
			[2, "gmail.import.publication", "ERROR", "GmailHistoryImportFailed failed"],
			[undefined, "gmail.import.record.finished", "ERROR", "retry-requested"],
		]);
		assert.deepEqual([lines[2].errorName, lines[3].errorName], ["RangeError", "RangeError"]);
		assert.deepEqual(h.capture.otherLines(), [
			{ method: "error", args: ["[gmail-history-import-dlq] page record failed", { messageId: "start", error: refused }] },
		]);
	});

	it("drains exhausted records the same way when the diagnostic sink throws", async () => {
		const drain = async (sink: "capturing" | "throwing") => {
			const h = harness();
			await queuedImport(h.imports, jobIdOf(1));
			const recordDiagnostic = sink === "throwing" ? throwingGmailDiagnosticSink({ now: () => NOW }) : h.deps.recordDiagnostic;
			const response = await run(initGmailHistoryImportPageDlqHandler({ ...h.deps, recordDiagnostic }), [
				{ messageId: "start", body: body(StartGmailHistoryImportCommand, { userId: READER, jobId: jobIdOf(1), generation: "generation-1" }) },
				{ messageId: "bad", body: "not json" },
			]);
			return { response, job: await h.imports.findJob({ userId: READER, jobId: jobIdOf(1) }), published: h.published };
		};

		assert.deepEqual(await drain("throwing"), await drain("capturing"));
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
		], OUTCOMES_QUEUE_ARN);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportCompletedEvent, detail: { userId: READER, jobId, counts: { ...ZERO, listed: 1, failed: 1 } } },
		]);
		const lines = h.capture.diagnostics();
		assert.deepEqual(trail(lines), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "recorded", outcome: "failed" }],
			[2, "gmail.import.step", "INFO", { kind: "job-completed", persisted: true }],
			[3, "gmail.import.publication", "INFO", "GmailHistoryImportCompleted published"],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.deepEqual(lines.map((line) => [line.handler, line.deadLetterSourceQueue]), lines.map(() => ["history-import-outcome-dlq", "gmail-history-import-outcomes-q"]));
		assert.deepEqual(lines.slice(1).map((line) => [line.envelopeKind, line.userId, line.jobId, line.generation, line.page]), lines.slice(1).map(() => ["outcome", READER, jobId, "generation-1", undefined]));
	});

	it("drains a stale outcome without completing anything and keeps the message id out of the trail", async () => {
		const h = harness();
		const jobId = jobIdOf(1);
		await queuedImport(h.imports, jobId);

		const response = await run(initGmailHistoryImportOutcomeDlqHandler(h.deps), [
			{ messageId: "stale", body: body(GmailHistoryImportMessageIngestedEvent, { userId: READER, jobId, generation: "generation-0", gmailMessageId: "SentinelMessageA1", outcome: "imported" }) },
		], OUTCOMES_QUEUE_ARN);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.published, []);
		assert.deepEqual(trail(h.capture.diagnostics()), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "stale", outcome: "failed" }],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.equal(h.capture.everythingLogged().includes("SentinelMessageA1"), false);
	});
});
