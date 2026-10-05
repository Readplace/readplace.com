import assert from "node:assert/strict";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GmailHttpRequestSettings, GmailHttpResponseHeaders } from "@packages/provider-contracts/gmail-history";
import { classifyForwardedLine } from "../forward-analytics/forward-analytics-handler";
import { FORWARDED_STREAMS } from "./events";
import {
	type GmailDiagnosticEvent,
	type GmailImportRecordCorrelation,
	type GmailOAuthCorrelation,
	type GmailOAuthStateInspection,
	initRecordGmailDiagnostic,
} from "./gmail-diagnostics";

const RECORDED_AT = "2026-10-05T03:04:05.678Z";
const now = () => new Date(RECORDED_AT);

const INVOCATION_ID = "8e2f0c47-4b1d-4c55-a0f3-77d2b9e1c6aa";
const SQS_MESSAGE_ID = "4f1c2b9e-0d3a-4e8f-9b61-2a5c7d8e9f10";
const JOB_ID = "0123456789abcdef0123456789abcdef";
const GENERATION = "fedcba9876543210fedcba9876543210";
const FINGERPRINT_A = "a4".repeat(32);
const FINGERPRINT_B = "b7".repeat(32);
const STATE_TTL_MS = 300_000;

type LogMethodName = keyof HutchLogger;

interface LoggedCall {
	method: LogMethodName;
	args: unknown[];
}

function createCapturingLogger(): { logger: HutchLogger; calls: LoggedCall[] } {
	const calls: LoggedCall[] = [];
	const capture = (method: LogMethodName) => (...args: unknown[]) => {
		calls.push({ method, args });
	};
	return {
		logger: { info: capture("info"), error: capture("error"), warn: capture("warn"), debug: capture("debug") },
		calls,
	};
}

function createThrowingLogger(): { logger: HutchLogger; attempts: LogMethodName[] } {
	const attempts: LogMethodName[] = [];
	const fail = (method: LogMethodName) => () => {
		attempts.push(method);
		throw new Error("log sink unavailable");
	};
	return {
		logger: { info: fail("info"), error: fail("error"), warn: fail("warn"), debug: fail("debug") },
		attempts,
	};
}

function onlyLine(calls: LoggedCall[]): { method: LogMethodName; line: string } {
	assert.equal(calls.length, 1, "one diagnostic must produce exactly one log call");
	const [call] = calls;
	assert.equal(call.args.length, 1, "the line must be the only argument so the stored message is pure JSON");
	const [line] = call.args;
	assert(typeof line === "string", "the argument must be the serialized JSON line");
	return { method: call.method, line };
}

const LAMBDA_LEVEL_TAG: Record<LogMethodName, string> = { info: "INFO", error: "ERROR", warn: "WARN", debug: "DEBUG" };

function asLambdaWroteIt(input: { method: LogMethodName; line: string }): string {
	return `${RECORDED_AT}\t${INVOCATION_ID}\t${LAMBDA_LEVEL_TAG[input.method]}\t${input.line}\n`;
}

function withSmuggledValue(input: { event: GmailDiagnosticEvent; value: unknown }): GmailDiagnosticEvent {
	const smuggling = { ...input.event, smuggled: input.value };
	return smuggling;
}

function circularValue(): unknown {
	const node: { self?: unknown } = {};
	node.self = node;
	return node;
}

function signedState(input: { fingerprint: string; ageMs: number }): GmailOAuthStateInspection {
	return {
		present: true,
		fingerprint: input.fingerprint,
		signatureValid: true,
		payload: "valid",
		createdAtMs: Date.parse(RECORDED_AT) - input.ageMs,
		ageMs: input.ageMs,
		intentKind: "connect",
	};
}

const connectRequest: GmailOAuthCorrelation = {
	route: "connect",
	traceId: "0b6f8f5e-2f43-4c1e-9a55-3e1f6f0c2d71",
	requestId: "gw-request-connect",
	userId: "user-1",
};

const callbackRequest: GmailOAuthCorrelation = {
	route: "callback",
	traceId: "5d0c3a8e-91b4-4f0e-8a7d-6c2b1e9f4a30",
	requestId: undefined,
	userId: "user-1",
};

const pageDelivery: GmailImportRecordCorrelation = {
	handler: "history-import",
	invocationId: INVOCATION_ID,
	sqsMessageId: SQS_MESSAGE_ID,
	receiveCount: 2,
	sourceQueue: "gmail-history-import-q",
	deadLetterSourceQueue: undefined,
	envelopeKind: "page",
	userId: "user-1",
	jobId: JOB_ID,
	generation: GENERATION,
	page: 3,
};

const pageDeadLetter: GmailImportRecordCorrelation = {
	...pageDelivery,
	handler: "history-import-page-dlq",
	invocationId: "c3d9a1f0-6e2b-4a7c-8d15-0f4e2b7a9c61",
	receiveCount: 1,
	sourceQueue: "gmail-history-import-failures-dlq",
	deadLetterSourceQueue: "gmail-history-import-q",
};

const NO_HEADERS: GmailHttpResponseHeaders = {
	contentType: undefined,
	declaredContentLength: undefined,
	contentEncoding: undefined,
	date: undefined,
	retryAfter: undefined,
	googRequestId: undefined,
	guploaderUploadId: undefined,
	cloudTraceContext: undefined,
};

const LIST_REQUEST: GmailHttpRequestSettings = {
	operation: "messages.list",
	fieldMask: "messages(id),nextPageToken",
	pageSize: 25,
	includeSpamTrash: false,
	pageTokenPresent: true,
};

const STATE_MISMATCH: GmailDiagnosticEvent = {
	...callbackRequest,
	event: "gmail.oauth.callback.inspected",
	level: "INFO",
	providerError: undefined,
	codePresent: true,
	queryShape: "valid",
	queryState: signedState({ fingerprint: FINGERPRINT_A, ageMs: 9_000 }),
	cookieState: signedState({ fingerprint: FINGERPRINT_B, ageMs: 5_000 }),
	statesEqual: false,
	verifiedAgeMs: 9_000,
	decisionAgeMs: 5_000,
	ttlMs: STATE_TTL_MS,
	decision: "state-mismatch",
};

const EMPTY_LISTING: GmailDiagnosticEvent = {
	...pageDelivery,
	event: "gmail.http.attempt",
	level: "ERROR",
	sequence: 1,
	operation: "messages.list",
	attempt: 1,
	request: LIST_REQUEST,
	requestedEndpoint: "gmail.messages.list",
	durationMs: 87,
	response: {
		status: 204,
		redirected: false,
		finalEndpoint: "gmail.messages.list",
		finalOriginExpected: true,
		bodyNull: true,
		headers: { ...NO_HEADERS, date: "2026-10-05T03:04:05.000Z", googRequestId: "AJ8f2wq_x-1" },
		bodyReads: [{ source: "response", outcome: "json-decode-failed", measuredBytes: 0, errorName: "SyntaxError", fields: {} }],
	},
	transportFailure: undefined,
	classification: "unavailable",
};

const RECORD_STARTED: GmailDiagnosticEvent = { ...pageDelivery, event: "gmail.import.record.started", level: "INFO" };

const INFO_SAMPLES: { label: string; event: GmailDiagnosticEvent }[] = [
	{
		label: "gmail.oauth.request.received",
		event: { ...connectRequest, event: "gmail.oauth.request.received", level: "INFO", method: "POST", hxRequest: true },
	},
	{
		label: "gmail.oauth.state.issued",
		event: {
			...connectRequest,
			event: "gmail.oauth.state.issued",
			level: "INFO",
			issuedStateFingerprint: FINGERPRINT_B,
			previousCookie: signedState({ fingerprint: FINGERPRINT_A, ageMs: 4_000 }),
			intentKind: "connect",
		},
	},
	{ label: "gmail.oauth.callback.inspected", event: STATE_MISMATCH },
	{
		label: "gmail.oauth.request.completed with a redirect",
		event: {
			...callbackRequest,
			event: "gmail.oauth.request.completed",
			level: "INFO",
			completion: "finished",
			status: 303,
			stage: "state-check",
			failureReason: undefined,
			redirect: "integrations",
			outcome: "oauth_state",
			durationMs: 41,
		},
	},
	{ label: "gmail.import.record.started", event: RECORD_STARTED },
	{
		label: "gmail.http.attempt that succeeded",
		event: {
			...pageDelivery,
			event: "gmail.http.attempt",
			level: "INFO",
			sequence: 1,
			operation: "messages.list",
			attempt: 1,
			request: LIST_REQUEST,
			requestedEndpoint: "gmail.messages.list",
			durationMs: 112,
			response: {
				status: 200,
				redirected: false,
				finalEndpoint: "gmail.messages.list",
				finalOriginExpected: true,
				bodyNull: false,
				headers: { ...NO_HEADERS, contentType: "application/json", contentEncoding: "gzip" },
				bodyReads: [{
					source: "response",
					outcome: "valid",
					measuredBytes: 61,
					errorName: undefined,
					fields: { messagesPresent: true, messageCount: 2, nextPageTokenPresent: false },
				}],
			},
			transportFailure: undefined,
			classification: "ok",
		},
	},
	{
		label: "gmail.import.step for a listed page",
		event: {
			...pageDelivery,
			event: "gmail.import.step",
			level: "INFO",
			sequence: 2,
			step: { kind: "page-listed", messageCount: 2, nextPagePresent: false },
		},
	},
	{
		label: "gmail.import.publication that was published",
		event: {
			...pageDelivery,
			event: "gmail.import.publication",
			level: "INFO",
			sequence: 3,
			target: "GmailHistoryImportPageProcessed",
			outcome: "published",
			errorName: undefined,
		},
	},
	{
		label: "gmail.import.record.finished as acked",
		event: { ...pageDelivery, event: "gmail.import.record.finished", level: "INFO", outcome: "acked", errorName: undefined, durationMs: 930 },
	},
];

const ERROR_SAMPLES: { label: string; event: GmailDiagnosticEvent }[] = [
	{
		label: "gmail.oauth.request.completed with a 500",
		event: {
			...callbackRequest,
			event: "gmail.oauth.request.completed",
			level: "ERROR",
			completion: "finished",
			status: 500,
			stage: "state-check",
			failureReason: undefined,
			redirect: undefined,
			outcome: undefined,
			durationMs: 12,
		},
	},
	{ label: "gmail.http.attempt answered with an empty 204", event: EMPTY_LISTING },
	{
		label: "gmail.http.attempt that failed in transport",
		event: {
			...pageDelivery,
			event: "gmail.http.attempt",
			level: "ERROR",
			sequence: 1,
			operation: "messages.list",
			attempt: 1,
			request: LIST_REQUEST,
			requestedEndpoint: "gmail.messages.list",
			durationMs: 3_002,
			response: undefined,
			transportFailure: { errorName: "TypeError", errorCode: "ECONNRESET" },
			classification: "transport-failed",
		},
	},
	{
		label: "gmail.import.step for a failed Gmail call",
		event: {
			...pageDelivery,
			event: "gmail.import.step",
			level: "ERROR",
			sequence: 2,
			step: {
				kind: "gmail-call-failed",
				operation: "messages.list",
				lastAttemptOperation: "messages.list",
				reason: "unavailable",
				status: 204,
			},
		},
	},
	{
		label: "gmail.import.step for a dead-lettered job",
		event: {
			...pageDeadLetter,
			event: "gmail.import.step",
			level: "ERROR",
			sequence: 1,
			step: { kind: "job-failed", reason: "dead-lettered", persisted: true },
		},
	},
	{
		label: "gmail.import.publication that failed",
		event: {
			...pageDeadLetter,
			event: "gmail.import.publication",
			level: "ERROR",
			sequence: 2,
			target: "GmailHistoryImportFailed",
			outcome: "failed",
			errorName: "TimeoutError",
		},
	},
	{
		label: "gmail.import.record.finished as retry-requested",
		event: { ...pageDelivery, event: "gmail.import.record.finished", level: "ERROR", outcome: "retry-requested", errorName: "Error", durationMs: 840 },
	},
];

function assertCarriesOnlyEnvelopeAndEventFields(input: { line: string; event: GmailDiagnosticEvent }): void {
	assert.deepEqual(JSON.parse(input.line), { version: 1, timestamp: RECORDED_AT, ...JSON.parse(JSON.stringify(input.event)) });
}

describe("initRecordGmailDiagnostic", () => {
	it.each(INFO_SAMPLES)("writes $label through logger.info as one JSON line the forwarder leaves in the Lambda's own log group", ({ event }) => {
		const { logger, calls } = createCapturingLogger();

		initRecordGmailDiagnostic({ logger, now })(event);

		const { method, line } = onlyLine(calls);
		assert.equal(method, "info");
		assertCarriesOnlyEnvelopeAndEventFields({ line, event });
		assert.equal(classifyForwardedLine({ message: asLambdaWroteIt({ method, line }), analyticsStreams: FORWARDED_STREAMS }), undefined);
	});

	it.each(ERROR_SAMPLES)("writes $label through logger.error as one JSON line the forwarder copies to the errors funnel", ({ event }) => {
		const { logger, calls } = createCapturingLogger();

		initRecordGmailDiagnostic({ logger, now })(event);

		const { method, line } = onlyLine(calls);
		assert.equal(method, "error");
		assertCarriesOnlyEnvelopeAndEventFields({ line, event });
		assert.equal(classifyForwardedLine({ message: asLambdaWroteIt({ method, line }), analyticsStreams: FORWARDED_STREAMS }), "errors");
	});

	it("records the A/B state race with both fingerprints and ages, omitting the absent request id and provider error", () => {
		const { logger, calls } = createCapturingLogger();

		initRecordGmailDiagnostic({ logger, now })(STATE_MISMATCH);

		const verifiedA = { present: true, fingerprint: FINGERPRINT_A, signatureValid: true, payload: "valid", createdAtMs: Date.parse(RECORDED_AT) - 9_000, ageMs: 9_000, intentKind: "connect" };
		const verifiedB = { ...verifiedA, fingerprint: FINGERPRINT_B, createdAtMs: Date.parse(RECORDED_AT) - 5_000, ageMs: 5_000 };
		assert.deepEqual(JSON.parse(onlyLine(calls).line), {
			version: 1,
			timestamp: RECORDED_AT,
			route: "callback",
			traceId: "5d0c3a8e-91b4-4f0e-8a7d-6c2b1e9f4a30",
			userId: "user-1",
			event: "gmail.oauth.callback.inspected",
			level: "INFO",
			codePresent: true,
			queryShape: "valid",
			queryState: verifiedA,
			cookieState: verifiedB,
			statesEqual: false,
			verifiedAgeMs: 9_000,
			decisionAgeMs: 5_000,
			ttlMs: STATE_TTL_MS,
			decision: "state-mismatch",
		});
	});

	it("records an empty 204 listing with its parsing evidence, omitting the transport failure, dead-letter source and unset headers", () => {
		const { logger, calls } = createCapturingLogger();

		initRecordGmailDiagnostic({ logger, now })(EMPTY_LISTING);

		assert.deepEqual(JSON.parse(onlyLine(calls).line), {
			version: 1,
			timestamp: RECORDED_AT,
			handler: "history-import",
			invocationId: INVOCATION_ID,
			sqsMessageId: SQS_MESSAGE_ID,
			receiveCount: 2,
			sourceQueue: "gmail-history-import-q",
			envelopeKind: "page",
			userId: "user-1",
			jobId: JOB_ID,
			generation: GENERATION,
			page: 3,
			event: "gmail.http.attempt",
			level: "ERROR",
			sequence: 1,
			operation: "messages.list",
			attempt: 1,
			request: {
				operation: "messages.list",
				fieldMask: "messages(id),nextPageToken",
				pageSize: 25,
				includeSpamTrash: false,
				pageTokenPresent: true,
			},
			requestedEndpoint: "gmail.messages.list",
			durationMs: 87,
			response: {
				status: 204,
				redirected: false,
				finalEndpoint: "gmail.messages.list",
				finalOriginExpected: true,
				bodyNull: true,
				headers: { date: "2026-10-05T03:04:05.000Z", googRequestId: "AJ8f2wq_x-1" },
				bodyReads: [{ source: "response", outcome: "json-decode-failed", measuredBytes: 0, errorName: "SyntaxError", fields: {} }],
			},
			classification: "unavailable",
		});
	});

	it("swallows a logger whose info throws", () => {
		const { logger, attempts } = createThrowingLogger();
		const record = initRecordGmailDiagnostic({ logger, now });

		assert.doesNotThrow(() => record(RECORD_STARTED));
		assert.deepEqual(attempts, ["info"]);
	});

	it("swallows a logger whose error throws", () => {
		const { logger, attempts } = createThrowingLogger();
		const record = initRecordGmailDiagnostic({ logger, now });

		assert.doesNotThrow(() => record(EMPTY_LISTING));
		assert.deepEqual(attempts, ["error"]);
	});

	it.each([
		{
			label: "throws",
			clock: (): Date => {
				throw new Error("clock unavailable");
			},
		},
		{ label: "returns an invalid date", clock: () => new Date(Number.NaN) },
	])("drops the line without throwing when the clock $label", ({ clock }) => {
		const { logger, calls } = createCapturingLogger();
		const record = initRecordGmailDiagnostic({ logger, now: clock });

		assert.doesNotThrow(() => record(RECORD_STARTED));
		assert.deepEqual(calls, []);
	});

	it.each([
		{ label: "a BigInt", value: 10n },
		{ label: "a circular reference", value: circularValue() },
	])("drops the line without throwing when the event carries $label, which JSON.stringify cannot serialize", ({ value }) => {
		assert.throws(() => JSON.stringify(value), TypeError);
		const { logger, calls } = createCapturingLogger();
		const record = initRecordGmailDiagnostic({ logger, now });

		assert.doesNotThrow(() => record(withSmuggledValue({ event: EMPTY_LISTING, value })));
		assert.deepEqual(calls, []);
	});
});
