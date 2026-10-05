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
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { type CapturedGmailDiagnostic, captureGmailDiagnostics, throwingGmailDiagnosticSink } from "./gmail-import-diagnostics.test-helper";
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

describe("initRecordGmailHistoryImportOutcomeHandler", () => {
	it("counts each outcome and announces the import once the last message settles", async () => {
		const h = harness();
		await runningImportOf(h.imports, ["SentinelMessageA1", "SentinelMessageB2"]);

		const response = await run(initRecordGmailHistoryImportOutcomeHandler(h.deps), [
			{ messageId: "first", body: ingested({ gmailMessageId: "SentinelMessageA1", outcome: "imported" }) },
			{ messageId: "second", body: ingested({ gmailMessageId: "SentinelMessageB2", outcome: "failed" }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [] });
		assert.deepEqual(h.published, [
			{ event: GmailHistoryImportCompletedEvent, detail: { userId: READER, jobId: JOB, counts: { ...ZERO, listed: 2, imported: 1, failed: 1 } } },
		]);
		const lines = h.capture.diagnostics();
		assert.deepEqual(trail(linesOf(lines, "first")), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "recorded", outcome: "imported" }],
			[2, "gmail.import.step", "INFO", { kind: "job-completed", persisted: false }],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.deepEqual(trail(linesOf(lines, "second")), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "recorded", outcome: "failed" }],
			[2, "gmail.import.step", "INFO", { kind: "job-completed", persisted: true }],
			[3, "gmail.import.publication", "INFO", "GmailHistoryImportCompleted published"],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.deepEqual(linesOf(lines, "second")[0], {
			version: 1,
			timestamp: NOW.toISOString(),
			handler: "history-import-outcomes",
			invocationId: "test-request-id",
			sqsMessageId: "second",
			receiveCount: 1,
			sourceQueue: "test-queue",
			event: "gmail.import.record.started",
			level: "INFO",
		});
		assert.deepEqual(
			linesOf(lines, "second").slice(1).map((line) => [line.envelopeKind, line.userId, line.jobId, line.generation, line.page]),
			[1, 2, 3, 4].map(() => ["outcome", READER, JOB, "generation-1", undefined]),
		);
		assert.equal(h.capture.everythingLogged().includes("SentinelMessage"), false);
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
		const lines = h.capture.diagnostics();
		assert.deepEqual(trail(linesOf(lines, "again")), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "duplicate", outcome: "imported" }],
			[2, "gmail.import.step", "INFO", { kind: "job-completed", persisted: false }],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.deepEqual(trail(linesOf(lines, "old")), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "stale", outcome: "imported" }],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.equal(linesOf(lines, "old").at(-1)?.generation, "generation-0");
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
		assert.deepEqual(trail(h.capture.diagnostics()), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "recorded", outcome: "imported" }],
			[undefined, "gmail.import.record.finished", "ERROR", "retry-requested"],
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "duplicate", outcome: "imported" }],
			[2, "gmail.import.step", "INFO", { kind: "job-completed", persisted: true }],
			[3, "gmail.import.publication", "INFO", "GmailHistoryImportCompleted published"],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.equal(h.capture.diagnostics()[2].errorName, "Error");
	});

	it("returns malformed records for retry", async () => {
		const h = harness();

		const response = await run(initRecordGmailHistoryImportOutcomeHandler(h.deps), [
			{ messageId: "bad", body: "not json" },
		]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "bad" }] });
		assert.deepEqual(h.capture.diagnostics().map((line) => [line.event, line.level, line.outcome, line.errorName, line.envelopeKind]), [
			["gmail.import.record.started", "INFO", undefined, undefined, undefined],
			["gmail.import.record.finished", "ERROR", "retry-requested", "SyntaxError", undefined],
		]);
	});

	it("records a refused completion announcement after the outcome and completion were saved", async () => {
		const h = harness();
		await runningImportOf(h.imports, ["only"]);
		const refused = new TypeError("EventBridge refused the entry");

		const response = await run(initRecordGmailHistoryImportOutcomeHandler({ ...h.deps, publishEvent: async () => { throw refused; } }), [
			{ messageId: "only", body: ingested({ gmailMessageId: "only", outcome: "imported" }) },
		]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "only" }] });
		assert.equal((await h.imports.findJob({ userId: READER, jobId: JOB }))?.state, "complete");
		assert.deepEqual(trail(h.capture.diagnostics()), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.step", "INFO", { kind: "outcome-recorded", result: "recorded", outcome: "imported" }],
			[2, "gmail.import.step", "INFO", { kind: "job-completed", persisted: true }],
			[3, "gmail.import.publication", "ERROR", "GmailHistoryImportCompleted failed"],
			[undefined, "gmail.import.record.finished", "ERROR", "retry-requested"],
		]);
		assert.deepEqual(h.capture.otherLines(), [
			{ method: "error", args: ["[gmail-history-import-outcomes] record failed", { messageId: "only", error: refused }] },
		]);
	});

	it("records outcomes the same way when the diagnostic sink throws", async () => {
		const record = async (sink: "capturing" | "throwing") => {
			const h = harness();
			await runningImportOf(h.imports, ["first", "second"]);
			const recordDiagnostic = sink === "throwing" ? throwingGmailDiagnosticSink({ now: () => NOW }) : h.deps.recordDiagnostic;
			const response = await run(initRecordGmailHistoryImportOutcomeHandler({ ...h.deps, recordDiagnostic }), [
				{ messageId: "first", body: ingested({ gmailMessageId: "first", outcome: "imported" }) },
				{ messageId: "bad", body: "not json" },
				{ messageId: "second", body: ingested({ gmailMessageId: "second", outcome: "failed" }) },
			]);
			return { response, job: await h.imports.findJob({ userId: READER, jobId: JOB }), published: h.published };
		};

		assert.deepEqual(await record("throwing"), await record("capturing"));
	});
});
