import assert from "node:assert/strict";
import type { SQSRecord, SQSRecordAttributes } from "aws-lambda";
import type { GmailHttpAttempt, GmailHttpClassification } from "@packages/provider-contracts/gmail-history";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { GMAIL_DIAGNOSTIC_VERSION } from "../../observability/gmail-diagnostics";
import { captureGmailDiagnostics, throwingGmailDiagnosticSink } from "./gmail-import-diagnostics.test-helper";
import { startGmailImportRecordTrace } from "./gmail-import-record-trace";

const NOW = new Date("2026-10-05T03:00:00.000Z");
const LIVE_QUEUE_ARN = "arn:aws:sqs:ap-southeast-2:111122223333:gmail-history-import-pages-q";
const DEAD_LETTER_QUEUE_ARN = "arn:aws:sqs:ap-southeast-2:111122223333:gmail-history-import-dlq";

function sqsRecord(overrides: { messageId: string; eventSourceARN: string; attributes: Partial<SQSRecordAttributes> }): SQSRecord {
	const [record] = buildSqsEvent([{ messageId: overrides.messageId, body: "{}" }]).Records;
	return { ...record, eventSourceARN: overrides.eventSourceARN, attributes: { ...record.attributes, ...overrides.attributes } };
}

function httpAttempt(classification: GmailHttpClassification): GmailHttpAttempt {
	return {
		operation: "messages.get",
		attempt: 1,
		request: { operation: "messages.get", fieldMask: "raw,internalDate,labelIds", format: "raw" },
		requestedEndpoint: "gmail.messages.get",
		durationMs: 40,
		response: undefined,
		transportFailure: undefined,
		classification,
	};
}

function liveTrace(capture: ReturnType<typeof captureGmailDiagnostics>, messageId = "sqs-live") {
	return startGmailImportRecordTrace({
		handler: "history-import",
		invocationId: "invocation-1",
		record: sqsRecord({ messageId, eventSourceARN: LIVE_QUEUE_ARN, attributes: { ApproximateReceiveCount: "1" } }),
		recordDiagnostic: capture.recordDiagnostic,
		now: () => NOW,
	});
}

describe("startGmailImportRecordTrace", () => {
	it("opens a record with only the SQS correlation that exists before its body is read", () => {
		const capture = captureGmailDiagnostics({ now: () => NOW });

		startGmailImportRecordTrace({
			handler: "history-import-page-dlq",
			invocationId: "invocation-1",
			record: sqsRecord({
				messageId: "sqs-1",
				eventSourceARN: DEAD_LETTER_QUEUE_ARN,
				attributes: { ApproximateReceiveCount: "3", DeadLetterQueueSourceArn: LIVE_QUEUE_ARN },
			}),
			recordDiagnostic: capture.recordDiagnostic,
			now: () => NOW,
		});

		assert.deepEqual(capture.diagnostics(), [
			{
				version: GMAIL_DIAGNOSTIC_VERSION,
				timestamp: NOW.toISOString(),
				handler: "history-import-page-dlq",
				invocationId: "invocation-1",
				sqsMessageId: "sqs-1",
				receiveCount: 3,
				sourceQueue: "gmail-history-import-dlq",
				deadLetterSourceQueue: "gmail-history-import-pages-q",
				event: "gmail.import.record.started",
				level: "INFO",
			},
		]);
	});

	it("leaves out the dead-letter source a live queue never has", () => {
		const capture = captureGmailDiagnostics({ now: () => NOW });

		liveTrace(capture);

		assert.deepEqual(
			capture.diagnostics().map((line) => [line.receiveCount, line.deadLetterSourceQueue, line.sourceQueue]),
			[[1, undefined, "gmail-history-import-pages-q"]],
		);
	});

	it("numbers HTTP attempts, steps and publications in one sequence and raises the level only for operational errors", async () => {
		const capture = captureGmailDiagnostics({ now: () => NOW });
		const trace = liveTrace(capture);
		const publishFailure = new TypeError("EventBridge refused the event");

		trace.identify({ envelopeKind: "page", userId: "reader-1", jobId: "a".repeat(32), generation: "generation-1", page: 2 });
		for (const classification of ["ok", "rejected", "unavailable", "transport-failed", "exception"] as const) {
			trace.observe({ kind: "http-attempt", attempt: httpAttempt(classification) });
		}
		trace.observe({ kind: "page-claimed" });
		trace.observe({ kind: "gmail-call-failed", operation: "messages.get", lastAttemptOperation: "messages.get", reason: "rejected", status: 400 });
		trace.observe({ kind: "message-publication-failed", index: 0, errorName: "TypeError" });
		trace.observe({ kind: "job-failed", reason: "gmail-rejected", persisted: true });
		trace.step({ kind: "job-completed", persisted: false });
		await trace.publish({ target: "GmailHistoryImportPageProcessed", send: async () => {} });
		await assert.rejects(
			trace.publish({ target: "GmailHistoryImportFailed", send: async () => { throw publishFailure; } }),
			(error) => error === publishFailure,
		);

		const lines = capture.diagnostics();
		assert.deepEqual(
			lines.map((line) => [line.sequence, line.event, line.level, line.classification ?? line.step?.kind ?? line.outcome]),
			[
				[undefined, "gmail.import.record.started", "INFO", undefined],
				[1, "gmail.http.attempt", "INFO", "ok"],
				[2, "gmail.http.attempt", "INFO", "rejected"],
				[3, "gmail.http.attempt", "ERROR", "unavailable"],
				[4, "gmail.http.attempt", "ERROR", "transport-failed"],
				[5, "gmail.http.attempt", "ERROR", "exception"],
				[6, "gmail.import.step", "INFO", "page-claimed"],
				[7, "gmail.import.step", "ERROR", "gmail-call-failed"],
				[8, "gmail.import.step", "ERROR", "message-publication-failed"],
				[9, "gmail.import.step", "ERROR", "job-failed"],
				[10, "gmail.import.step", "INFO", "job-completed"],
				[11, "gmail.import.publication", "INFO", "published"],
				[12, "gmail.import.publication", "ERROR", "failed"],
			],
		);
		assert.deepEqual(lines[1], {
			version: GMAIL_DIAGNOSTIC_VERSION,
			timestamp: NOW.toISOString(),
			handler: "history-import",
			invocationId: "invocation-1",
			sqsMessageId: "sqs-live",
			receiveCount: 1,
			sourceQueue: "gmail-history-import-pages-q",
			envelopeKind: "page",
			userId: "reader-1",
			jobId: "a".repeat(32),
			generation: "generation-1",
			page: 2,
			event: "gmail.http.attempt",
			level: "INFO",
			sequence: 1,
			...JSON.parse(JSON.stringify(httpAttempt("ok"))),
		});
		assert.deepEqual(lines[7].step, { kind: "gmail-call-failed", operation: "messages.get", lastAttemptOperation: "messages.get", reason: "rejected", status: 400 });
		assert.deepEqual(
			lines.slice(11).map((line) => [line.target, line.outcome, line.errorName]),
			[["GmailHistoryImportPageProcessed", "published", undefined], ["GmailHistoryImportFailed", "failed", "TypeError"]],
		);
		assert.equal(capture.everythingLogged().includes("EventBridge refused"), false);
	});

	it("finishes an acknowledged record with how long it took, without calling it a completed import", () => {
		let clock = NOW.getTime();
		const capture = captureGmailDiagnostics({ now: () => NOW });
		const trace = startGmailImportRecordTrace({
			handler: "history-import-outcomes",
			invocationId: "invocation-1",
			record: sqsRecord({ messageId: "sqs-1", eventSourceARN: LIVE_QUEUE_ARN, attributes: {} }),
			recordDiagnostic: capture.recordDiagnostic,
			now: () => new Date(clock),
		});

		clock += 250;
		trace.acked();

		assert.deepEqual(capture.diagnostics().at(-1), {
			version: GMAIL_DIAGNOSTIC_VERSION,
			timestamp: NOW.toISOString(),
			handler: "history-import-outcomes",
			invocationId: "invocation-1",
			sqsMessageId: "sqs-1",
			receiveCount: 1,
			sourceQueue: "gmail-history-import-pages-q",
			event: "gmail.import.record.finished",
			level: "INFO",
			outcome: "acked",
			durationMs: 250,
		});
	});

	it("finishes a record returned for retry with only the class of its error", () => {
		const capture = captureGmailDiagnostics({ now: () => NOW });
		const trace = liveTrace(capture);

		trace.retryRequested(new SyntaxError("Unexpected token in sentinel.sender@leak-check.example"));

		const finished = capture.diagnostics().at(-1);
		assert.equal(finished?.event, "gmail.import.record.finished");
		assert.deepEqual([finished?.level, finished?.outcome, finished?.errorName], ["ERROR", "retry-requested", "SyntaxError"]);
		assert.equal(capture.everythingLogged().includes("sentinel.sender"), false);
	});

	it("keeps each record's correlation and sequence to itself", () => {
		const capture = captureGmailDiagnostics({ now: () => NOW });
		const first = liveTrace(capture, "sqs-first");
		const second = liveTrace(capture, "sqs-second");

		first.identify({ envelopeKind: "start", userId: "reader-1", jobId: "1".repeat(32), generation: "generation-1", page: 0 });
		first.observe({ kind: "page-claimed" });
		second.observe({ kind: "page-claimed" });
		second.acked();

		const secondLines = capture.diagnostics().filter((line) => line.sqsMessageId === "sqs-second");
		assert.deepEqual(secondLines.map((line) => [line.event, line.sequence, line.userId, line.jobId]), [
			["gmail.import.record.started", undefined, undefined, undefined],
			["gmail.import.step", 1, undefined, undefined],
			["gmail.import.record.finished", undefined, undefined, undefined],
		]);
	});

	it("keeps publishing and finishing when the diagnostic sink throws", async () => {
		const recordDiagnostic = throwingGmailDiagnosticSink({ now: () => NOW });
		const trace = startGmailImportRecordTrace({
			handler: "history-import",
			invocationId: "invocation-1",
			record: sqsRecord({ messageId: "sqs-1", eventSourceARN: LIVE_QUEUE_ARN, attributes: {} }),
			recordDiagnostic,
			now: () => NOW,
		});
		const sent: string[] = [];
		const failure = new Error("EventBridge unavailable");

		trace.observe({ kind: "http-attempt", attempt: httpAttempt("unavailable") });
		trace.step({ kind: "job-failed", reason: "dead-lettered", persisted: true });
		await trace.publish({ target: "GmailHistoryImportFailed", send: async () => { sent.push("failed"); } });
		await assert.rejects(trace.publish({ target: "GmailHistoryImportFailed", send: async () => { throw failure; } }), (error) => error === failure);
		trace.acked();
		trace.retryRequested(failure);

		assert.deepEqual(sent, ["failed"]);
	});
});
