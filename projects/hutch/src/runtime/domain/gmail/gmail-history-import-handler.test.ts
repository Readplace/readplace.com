import assert from "node:assert/strict";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJob,
	type GmailHistoryImportJobId,
	GmailHistoryImportJobIdSchema,
	GmailMessageIdSchema,
} from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import {
	GmailHistoryImportCompletedEvent,
	GmailHistoryImportFailedEvent,
	GmailHistoryImportMessageFetchedEvent,
	GmailHistoryImportPageProcessedEvent,
	ProcessGmailHistoryImportPageCommand,
	StartGmailHistoryImportCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { GmailHistory, GmailHistoryResult, GmailHttpAttempt } from "@packages/provider-contracts/gmail-history";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailHistory, initInMemoryRawEmailBucket } from "@packages/test-fixtures/providers/gmail-history";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryGmailMapping } from "@packages/test-fixtures/providers/gmail-mapping";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { RecordGmailDiagnostic } from "../../observability/gmail-diagnostics";
import { type GmailHistoryImport, type GmailHistoryImportPage, type GmailHistoryImportStep, initGmailHistoryImport } from "./gmail-history-import";
import { initGmailHistoryImportHandler } from "./gmail-history-import-handler";
import { type CapturedGmailDiagnostic, captureGmailDiagnostics, throwingGmailDiagnosticSink } from "./gmail-import-diagnostics.test-helper";

const USER = UserIdSchema.parse("reader-1");
const JOB = GmailHistoryImportJobIdSchema.parse("0".repeat(32));
const PAGE: GmailHistoryImportPage = { userId: USER, jobId: JOB, generation: "generation-1", page: 1 };
const COUNTS = { listed: 1, imported: 1, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 };
const ZERO = { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 };
const COMPLETED_JOB: GmailHistoryImportJob = {
	userId: USER,
	jobId: JOB,
	senderEmail: ForwardableSenderSchema.parse("dan@tldrnewsletter.com"),
	destinationAddresses: [InboxAddressSchema.parse("gmail-abc123@read.place")],
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
const NOW = new Date("2026-10-05T03:00:00.000Z");
const INVOCATION = "invocation-1";
const LIVE_QUEUE_ARN = "arn:aws:sqs:ap-southeast-2:111122223333:gmail-history-import-q";
const SENTINEL_SENDER = ForwardableSenderSchema.parse("sentinel.sender@leak-check.example");
const SENTINEL_ACCOUNT = GmailAccountEmailSchema.parse("sentinel.account@leak-check.example");
const SENTINEL_PAGE_TOKEN = "SentinelPageToken";
const GATEWAY = InboxAddressSchema.parse("gmail-def456@read.place");
const READLIST = InboxAddressSchema.parse("gmail-abc123@read.place");
const SENSITIVE = ["sentinel", GATEWAY, READLIST];

function body(event: { detailType: string }, detail: unknown) {
	return JSON.stringify({ "detail-type": event.detailType, detail });
}

async function run(handler: Handler<SQSEvent, SQSBatchResponse>, records: { messageId: string; body: string }[]) {
	const response = await handler(buildSqsEvent(records), buildLambdaContext(), () => {});
	assert(response);
	return response;
}

function sqsEvent(records: { messageId: string; body: string; receiveCount?: string }[]): SQSEvent {
	return {
		Records: buildSqsEvent(records).Records.map((record, index) => ({
			...record,
			eventSourceARN: LIVE_QUEUE_ARN,
			attributes: { ...record.attributes, ApproximateReceiveCount: records[index].receiveCount ?? "1" },
		})),
	};
}

async function runEvent(handler: Handler<SQSEvent, SQSBatchResponse>, event: SQSEvent) {
	const response = await handler(event, { ...buildLambdaContext(), awsRequestId: INVOCATION }, () => {});
	assert(response);
	return response;
}

function describeLine(line: CapturedGmailDiagnostic) {
	if (line.step !== undefined) return line.step.kind;
	if (line.target !== undefined) return `${line.target} ${line.outcome}`;
	return line.classification ?? line.outcome;
}

function trail(lines: CapturedGmailDiagnostic[]) {
	return lines.map((line) => [line.sequence, line.event, line.level, describeLine(line)]);
}

function linesOf(lines: CapturedGmailDiagnostic[], sqsMessageId: string) {
	return lines.filter((line) => line.sqsMessageId === sqsMessageId);
}

function identities(lines: CapturedGmailDiagnostic[]) {
	return lines.map((line) => [line.envelopeKind, line.userId, line.jobId, line.generation, line.page]);
}

function assertNothingSensitive(logged: string) {
	for (const sensitive of SENSITIVE) assert.equal(logged.toLowerCase().includes(sensitive.toLowerCase()), false, `${sensitive} must not be logged`);
}

function harness(steps: { start: GmailHistoryImportStep; page: GmailHistoryImportStep; tookMs?: number }) {
	let clock = NOW.getTime();
	const capture = captureGmailDiagnostics({ now: () => NOW });
	const published: { event: unknown; detail: unknown }[] = [];
	const dispatched: GmailHistoryImportPage[] = [];
	const calls: unknown[] = [];
	const importer: GmailHistoryImport = {
		start: async (input) => { calls.push({ start: input }); clock += steps.tookMs ?? 0; return steps.start; },
		page: async (input) => { calls.push({ page: input }); return steps.page; },
	};
	const deps = {
		importer,
		dispatchPage: async (input: GmailHistoryImportPage) => { dispatched.push(input); },
		publishEvent: (async (event, detail) => { published.push({ event, detail }); }) as PublishEvent,
		logger: capture.logger,
		recordDiagnostic: capture.recordDiagnostic,
		now: () => new Date(clock),
	};
	return { deps, published, dispatched, calls, capture };
}

function attemptOf(operation: "messages.list" | "messages.get", result: GmailHistoryResult<unknown>): GmailHttpAttempt {
	const requestedEndpoint = operation === "messages.list" ? "gmail.messages.list" : "gmail.messages.get";
	return {
		operation,
		attempt: 1,
		request: operation === "messages.list"
			? { operation, fieldMask: "messages/id,nextPageToken", pageSize: 25, includeSpamTrash: false, pageTokenPresent: false }
			: { operation, fieldMask: "raw,internalDate,labelIds", format: "raw" },
		requestedEndpoint,
		durationMs: 25,
		response: {
			status: result.ok ? 200 : "status" in result ? result.status : 401,
			redirected: false,
			finalEndpoint: requestedEndpoint,
			finalOriginExpected: true,
			bodyNull: false,
			headers: {
				contentType: "application/json; charset=UTF-8",
				declaredContentLength: undefined,
				contentEncoding: "gzip",
				date: "Mon, 05 Oct 2026 03:00:00 GMT",
				retryAfter: undefined,
				googRequestId: undefined,
				guploaderUploadId: undefined,
				cloudTraceContext: undefined,
			},
			bodyReads: [],
		},
		transportFailure: undefined,
		classification: result.ok ? "ok" : result.reason,
	};
}

async function wiredHarness(options: { recordDiagnostic?: (now: () => Date) => RecordGmailDiagnostic } = {}) {
	const now = () => NOW;
	const capture = captureGmailDiagnostics({ now });
	const gmail = initInMemoryGmailHistory();
	const store = initInMemoryGmailHistoryImport();
	const connections = initInMemoryGmailConnection({ now });
	const mappings = initInMemoryGmailMapping({ now });
	const bucket = initInMemoryRawEmailBucket();
	const published: { event: unknown; detail: unknown }[] = [];
	const dispatched: GmailHistoryImportPage[] = [];
	const publishEvent = (async (event, detail) => { published.push({ event, detail }); }) as PublishEvent;
	const history: GmailHistory = {
		listUnreadMessageIds: async (input) => {
			const listed = await gmail.history.listUnreadMessageIds({ ...input, pageToken: input.pageToken?.replace(SENTINEL_PAGE_TOKEN, "") });
			input.observe(attemptOf("messages.list", listed));
			if (!listed.ok) return listed;
			const nextPageToken = listed.value.nextPageToken === undefined ? undefined : `${SENTINEL_PAGE_TOKEN}${listed.value.nextPageToken}`;
			return { ok: true, value: { messageIds: listed.value.messageIds, nextPageToken } };
		},
		fetchRawMessage: async (input) => {
			const fetched = await gmail.history.fetchRawMessage(input);
			input.observe(attemptOf("messages.get", fetched));
			return fetched;
		},
	};
	const importer = initGmailHistoryImport({
		history,
		imports: store,
		connections,
		mappings,
		putRaw: bucket.put,
		publishFetched: async (detail) => {
			await publishEvent(GmailHistoryImportMessageFetchedEvent, detail);
		},
		now,
	});
	const handler = initGmailHistoryImportHandler({
		importer,
		dispatchPage: async (input) => { dispatched.push(input); },
		publishEvent,
		logger: capture.logger,
		recordDiagnostic: options.recordDiagnostic?.(now) ?? capture.recordDiagnostic,
		now,
	});

	const addReader = async (reader: { userId: UserId; jobId: GmailHistoryImportJobId }) => {
		await connections.createConnection({ userId: reader.userId, gatewayAddress: GATEWAY });
		await connections.recordAccountEmail({ userId: reader.userId, accountEmail: SENTINEL_ACCOUNT });
		await mappings.addSenderToFilter({ userId: reader.userId, accountEmail: SENTINEL_ACCOUNT, senderEmail: SENTINEL_SENDER });
		await mappings.mapSenderToAddress({ userId: reader.userId, accountEmail: SENTINEL_ACCOUNT, senderEmail: SENTINEL_SENDER, mappedAddresses: [READLIST], deliveryMode: "links" });
		await store.createJob({
			...reader,
			senderEmail: SENTINEL_SENDER,
			destinationAddresses: [READLIST],
			connection: { gatewayAddress: GATEWAY, accountEmail: SENTINEL_ACCOUNT },
			window: undefined,
			generation: "generation-0",
			page: 0,
			pageToken: undefined,
			listingCompletedAt: undefined,
			state: "awaiting-permission",
			counts: ZERO,
			failureReason: undefined,
			cancelReason: undefined,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
			completedAt: undefined,
		});
		await store.startJob({ ...reader, generation: "generation-1", now: NOW });
	};

	const addUnread = (input: { userId: UserId; ids: string[] }) => {
		for (const [index, id] of input.ids.entries()) {
			gmail.addMessage({
				userId: input.userId,
				sender: SENTINEL_SENDER,
				messageId: GmailMessageIdSchema.parse(id),
				raw: Buffer.from(`Message-ID: <${id}@leak-check.example>\r\nFrom: ${SENTINEL_SENDER}\r\n\r\n${id}`),
				internalDate: new Date(NOW.getTime() - (index + 1) * 60_000).toISOString(),
				labelIds: ["INBOX", "UNREAD"],
			});
		}
	};

	const jobState = async (reader: { userId: UserId; jobId: GmailHistoryImportJobId }) => (await store.findJob(reader))?.state;

	return { capture, gmail, store, mappings, bucket, published, dispatched, handler, addReader, addUnread, jobState };
}

const READER_1 = { userId: USER, jobId: JOB };
const READER_2 = { userId: UserIdSchema.parse("reader-2"), jobId: GmailHistoryImportJobIdSchema.parse("2".repeat(32)) };

function start(reader: { userId: UserId; jobId: GmailHistoryImportJobId }) {
	return body(StartGmailHistoryImportCommand, { ...reader, generation: "generation-1" });
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
		assert.deepEqual(trail(h.capture.diagnostics()), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.publication", "INFO", "GmailHistoryImportCompleted published"],
			[2, "gmail.import.publication", "INFO", "GmailHistoryImportPageProcessed published"],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
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
		const lines = h.capture.diagnostics();
		assert.deepEqual(trail(linesOf(lines, "progress")), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.publication", "INFO", "ProcessGmailHistoryImportPage published"],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.deepEqual(identities(linesOf(lines, "progress").slice(1)), [
			["progress", USER, JOB, "generation-1", 1],
			["progress", USER, JOB, "generation-1", 1],
		]);
		assert.deepEqual(trail(linesOf(lines, "done")), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[undefined, "gmail.import.record.finished", "INFO", "acked"],
		]);
		assert.deepEqual(identities(linesOf(lines, "done").slice(1)), [["progress", USER, JOB, undefined, undefined]]);
		assert.deepEqual(identities(linesOf(lines, "command").slice(1)), [
			["page", USER, JOB, "generation-1", 1],
			["page", USER, JOB, "generation-1", 1],
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

	it("records a refused announcement and returns the record for retry with the error it already logs", async () => {
		const h = harness({
			start: { next: undefined, completed: COMPLETED_JOB, failed: undefined },
			page: { next: undefined, completed: undefined, failed: undefined },
			tookMs: 250,
		});
		const refused = new TypeError("EventBridge refused the entry");

		const response = await runEvent(
			initGmailHistoryImportHandler({ ...h.deps, publishEvent: async () => { throw refused; } }),
			sqsEvent([{ messageId: "start", body: start(READER_1) }]),
		);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "start" }] });
		const lines = h.capture.diagnostics();
		assert.deepEqual(trail(lines), [
			[undefined, "gmail.import.record.started", "INFO", undefined],
			[1, "gmail.import.publication", "ERROR", "GmailHistoryImportCompleted failed"],
			[undefined, "gmail.import.record.finished", "ERROR", "retry-requested"],
		]);
		assert.deepEqual([lines[1].errorName, lines[2].errorName, lines[2].durationMs], ["TypeError", "TypeError", 250]);
		assert.deepEqual(h.capture.otherLines(), [
			{ method: "error", args: ["[gmail-history-import] record failed", { messageId: "start", error: refused }] },
		]);
		assert.equal(JSON.stringify(lines).includes("EventBridge refused"), false);
	});

	describe("diagnostics of a real import", () => {
		it("traces a page of messages from receipt to acknowledgement in one numbered sequence, leaving announcements unchanged", async () => {
			const w = await wiredHarness();
			await w.addReader(READER_1);
			w.addUnread({ userId: USER, ids: ["SentinelMessageA1", "SentinelMessageB2", "SentinelMessageC3"] });

			const response = await runEvent(w.handler, sqsEvent([{ messageId: "sqs-start", body: start(READER_1) }]));

			assert.deepEqual(response, { batchItemFailures: [] });
			const lines = w.capture.diagnostics();
			assert.deepEqual(trail(lines), [
				[undefined, "gmail.import.record.started", "INFO", undefined],
				[1, "gmail.import.step", "INFO", "page-claimed"],
				[2, "gmail.http.attempt", "INFO", "ok"],
				[3, "gmail.import.step", "INFO", "page-listed"],
				[4, "gmail.http.attempt", "INFO", "ok"],
				[5, "gmail.import.step", "INFO", "message-processed"],
				[6, "gmail.http.attempt", "INFO", "ok"],
				[7, "gmail.import.step", "INFO", "message-processed"],
				[8, "gmail.http.attempt", "INFO", "ok"],
				[9, "gmail.import.step", "INFO", "message-processed"],
				[10, "gmail.import.step", "INFO", "page-saved"],
				[11, "gmail.import.step", "INFO", "job-completed"],
				[12, "gmail.import.publication", "INFO", "GmailHistoryImportPageProcessed published"],
				[undefined, "gmail.import.record.finished", "INFO", "acked"],
			]);
			assert.deepEqual(lines[0], {
				version: 1,
				timestamp: NOW.toISOString(),
				handler: "history-import",
				invocationId: INVOCATION,
				sqsMessageId: "sqs-start",
				receiveCount: 1,
				sourceQueue: "gmail-history-import-q",
				event: "gmail.import.record.started",
				level: "INFO",
			});
			assert.deepEqual(new Set(identities(lines.slice(1)).map((identity) => JSON.stringify(identity))), new Set([JSON.stringify(["start", USER, JOB, "generation-1", 0])]));
			assert.deepEqual(lines.filter((line) => line.step !== undefined).map((line) => line.step), [
				{ kind: "page-claimed" },
				{ kind: "page-listed", messageCount: 3, nextPagePresent: false },
				{ kind: "message-processed", index: 0, outcome: "published" },
				{ kind: "message-processed", index: 1, outcome: "published" },
				{ kind: "message-processed", index: 2, outcome: "published" },
				{ kind: "page-saved", nextPagePresent: false },
				{ kind: "job-completed", persisted: false },
			]);
			assert.deepEqual(lines[2].response, JSON.parse(JSON.stringify(attemptOf("messages.list", { ok: true, value: undefined }).response)));
			assert.deepEqual([lines.at(-1)?.outcome, lines.at(-1)?.durationMs, lines.at(-1)?.errorName], ["acked", 0, undefined]);
			assert.deepEqual(w.published.map((entry) => entry.event), [
				GmailHistoryImportMessageFetchedEvent,
				GmailHistoryImportMessageFetchedEvent,
				GmailHistoryImportMessageFetchedEvent,
				GmailHistoryImportPageProcessedEvent,
			]);
			assert.deepEqual(w.published[0].detail, {
				userId: USER,
				jobId: JOB,
				generation: "generation-1",
				gmailMessageId: "SentinelMessageA1",
				accountEmail: SENTINEL_ACCOUNT,
				senderEmail: SENTINEL_SENDER,
				destinationAddresses: [READLIST],
				deliveryMode: "links",
				rawEmailS3Key: `gmail-import/${USER}/${JOB}/SentinelMessageA1.eml`,
				internalDate: new Date(NOW.getTime() - 60_000).toISOString(),
			});
			assert.deepEqual(w.published[3].detail, { userId: USER, jobId: JOB, nextPage: undefined });
			assertNothingSensitive(w.capture.everythingLogged());
		});

		it("says a further page exists without logging its page token", async () => {
			const w = await wiredHarness();
			await w.addReader(READER_1);
			w.addUnread({ userId: USER, ids: Array.from({ length: 26 }, (_, index) => `SentinelMessage${index}`) });

			await runEvent(w.handler, sqsEvent([{ messageId: "sqs-start", body: start(READER_1) }]));
			await runEvent(w.handler, sqsEvent([{ messageId: "sqs-page", body: body(ProcessGmailHistoryImportPageCommand, { ...READER_1, generation: "generation-1", page: 1 }) }]));

			const steps = w.capture.diagnostics().filter((line) => line.step?.kind === "page-listed" || line.step?.kind === "page-saved");
			assert.deepEqual(steps.map((line) => [line.sqsMessageId, line.step]), [
				["sqs-start", { kind: "page-listed", messageCount: 25, nextPagePresent: true }],
				["sqs-start", { kind: "page-saved", nextPagePresent: true }],
				["sqs-page", { kind: "page-listed", messageCount: 1, nextPagePresent: false }],
				["sqs-page", { kind: "page-saved", nextPagePresent: false }],
			]);
			assert.equal((await w.store.findJob(READER_1))?.listingCompletedAt, NOW.toISOString());
			assertNothingSensitive(w.capture.everythingLogged());
		});

		it("carries a retried record's receive count and names only the error class when Gmail is unavailable", async () => {
			const w = await wiredHarness();
			await w.addReader(READER_1);
			w.addUnread({ userId: USER, ids: ["SentinelMessageA1"] });
			w.gmail.failNext({ method: "listUnreadMessageIds", failure: { ok: false, reason: "unavailable", status: 503 } });

			const response = await runEvent(w.handler, sqsEvent([{ messageId: "sqs-retry", body: start(READER_1), receiveCount: "4" }]));

			assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "sqs-retry" }] });
			const lines = w.capture.diagnostics();
			assert.deepEqual(trail(lines), [
				[undefined, "gmail.import.record.started", "INFO", undefined],
				[1, "gmail.import.step", "INFO", "page-claimed"],
				[2, "gmail.http.attempt", "ERROR", "unavailable"],
				[3, "gmail.import.step", "ERROR", "gmail-call-failed"],
				[undefined, "gmail.import.record.finished", "ERROR", "retry-requested"],
			]);
			assert.deepEqual(lines.map((line) => line.receiveCount), [4, 4, 4, 4, 4]);
			assert.deepEqual(lines[3].step, { kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: "messages.list", reason: "unavailable", status: 503 });
			assert.deepEqual(Object.keys(lines[4]).filter((key) => ["errorName", "message", "stack", "error"].includes(key)), ["errorName"]);
			assert.equal(lines[4].errorName, "Error");
			assert.equal(JSON.stringify(lines).includes("Gmail history import unavailable"), false);
			const [logged] = w.capture.otherLines();
			assert.equal(logged.args[0], "[gmail-history-import] record failed");
			assert.match(String(Object(logged.args[1]).error), /unavailable \(503\)/);
			assert.equal(await w.jobState(READER_1), "running");
			assert.deepEqual(w.published, []);
		});

		it("traces a refused grant through the revoked connection, the failed job and its announcements", async () => {
			const w = await wiredHarness();
			await w.addReader(READER_1);
			w.gmail.failNext({ method: "listUnreadMessageIds", failure: { ok: false, reason: "reauth-required" } });

			const response = await runEvent(w.handler, sqsEvent([{ messageId: "sqs-start", body: start(READER_1) }]));

			assert.deepEqual(response, { batchItemFailures: [] });
			const lines = w.capture.diagnostics();
			assert.deepEqual(trail(lines), [
				[undefined, "gmail.import.record.started", "INFO", undefined],
				[1, "gmail.import.step", "INFO", "page-claimed"],
				[2, "gmail.http.attempt", "INFO", "reauth-required"],
				[3, "gmail.import.step", "ERROR", "gmail-call-failed"],
				[4, "gmail.import.step", "INFO", "connection-revoked"],
				[5, "gmail.import.step", "ERROR", "job-failed"],
				[6, "gmail.import.publication", "INFO", "GmailHistoryImportFailed published"],
				[7, "gmail.import.publication", "INFO", "GmailHistoryImportPageProcessed published"],
				[undefined, "gmail.import.record.finished", "INFO", "acked"],
			]);
			assert.deepEqual(lines.slice(3, 6).map((line) => line.step), [
				{ kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: "messages.list", reason: "reauth-required" },
				{ kind: "connection-revoked", persisted: true },
				{ kind: "job-failed", reason: "permission-revoked", persisted: true },
			]);
			assert.deepEqual(w.published, [
				{ event: GmailHistoryImportFailedEvent, detail: { userId: USER, jobId: JOB, reason: "permission-revoked" } },
				{ event: GmailHistoryImportPageProcessedEvent, detail: { userId: USER, jobId: JOB, nextPage: undefined } },
			]);
		});

		it("records why redelivered or superseded pages did nothing, numbering each record from one", async () => {
			const w = await wiredHarness();
			await w.addReader(READER_1);
			const page = (detail: { jobId: GmailHistoryImportJobId; generation: string; page: number }) =>
				body(ProcessGmailHistoryImportPageCommand, { userId: USER, ...detail });

			const response = await runEvent(w.handler, sqsEvent([
				{ messageId: "stale", body: page({ jobId: JOB, generation: "generation-0", page: 0 }) },
				{ messageId: "missing", body: page({ jobId: READER_2.jobId, generation: "generation-1", page: 0 }) },
				{ messageId: "ahead", body: page({ jobId: JOB, generation: "generation-1", page: 3 }) },
			]));

			assert.deepEqual(response, { batchItemFailures: [] });
			const lines = w.capture.diagnostics();
			for (const sqsMessageId of ["stale", "missing", "ahead"]) {
				assert.deepEqual(trail(linesOf(lines, sqsMessageId)), [
					[undefined, "gmail.import.record.started", "INFO", undefined],
					[1, "gmail.import.step", "INFO", "page-skipped"],
					[2, "gmail.import.publication", "INFO", "GmailHistoryImportPageProcessed published"],
					[undefined, "gmail.import.record.finished", "INFO", "acked"],
				]);
			}
			assert.deepEqual(lines.filter((line) => line.step !== undefined).map((line) => [line.sqsMessageId, line.step?.reason]), [
				["stale", "generation-stale"],
				["missing", "job-missing"],
				["ahead", "page-mismatch"],
			]);
			assert.deepEqual(w.gmail.listRequests, []);
		});

		it("keeps every record's correlation to itself across a batch for different readers", async () => {
			const w = await wiredHarness();
			await w.addReader(READER_1);
			await w.addReader(READER_2);
			w.addUnread({ userId: USER, ids: ["SentinelMessageA1", "SentinelMessageB2"] });
			await w.mappings.removeMapping({ userId: READER_2.userId, accountEmail: SENTINEL_ACCOUNT, senderEmail: SENTINEL_SENDER });

			const response = await runEvent(w.handler, sqsEvent([
				{ messageId: "sqs-reader-1", body: start(READER_1) },
				{ messageId: "sqs-malformed", body: "not json" },
				{ messageId: "sqs-reader-2", body: start(READER_2), receiveCount: "2" },
				{ messageId: "sqs-progress", body: body(GmailHistoryImportPageProcessedEvent, { ...READER_2, nextPage: { generation: "generation-1", page: 1 } }) },
			]));

			assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "sqs-malformed" }] });
			const lines = w.capture.diagnostics();
			const readerOne = linesOf(lines, "sqs-reader-1");
			const malformed = linesOf(lines, "sqs-malformed");
			const readerTwo = linesOf(lines, "sqs-reader-2");
			const progress = linesOf(lines, "sqs-progress");
			assert.equal(readerOne.length + malformed.length + readerTwo.length + progress.length, lines.length);
			assert.deepEqual(new Set(identities(readerOne.slice(1)).map((identity) => JSON.stringify(identity))), new Set([JSON.stringify(["start", USER, JOB, "generation-1", 0])]));
			assert.deepEqual(malformed, [
				{
					version: 1,
					timestamp: NOW.toISOString(),
					handler: "history-import",
					invocationId: INVOCATION,
					sqsMessageId: "sqs-malformed",
					receiveCount: 1,
					sourceQueue: "gmail-history-import-q",
					event: "gmail.import.record.started",
					level: "INFO",
				},
				{
					version: 1,
					timestamp: NOW.toISOString(),
					handler: "history-import",
					invocationId: INVOCATION,
					sqsMessageId: "sqs-malformed",
					receiveCount: 1,
					sourceQueue: "gmail-history-import-q",
					event: "gmail.import.record.finished",
					level: "ERROR",
					outcome: "retry-requested",
					errorName: "SyntaxError",
					durationMs: 0,
				},
			]);
			assert.deepEqual(trail(readerTwo), [
				[undefined, "gmail.import.record.started", "INFO", undefined],
				[1, "gmail.import.step", "INFO", "job-cancelled"],
				[2, "gmail.import.publication", "INFO", "GmailHistoryImportPageProcessed published"],
				[undefined, "gmail.import.record.finished", "INFO", "acked"],
			]);
			assert.deepEqual(readerTwo[1].step, { kind: "job-cancelled", reason: "mapping-removed", cancelledJobs: 1 });
			assert.deepEqual(readerTwo.map((line) => [line.userId, line.jobId, line.receiveCount]), [
				[undefined, undefined, 2],
				[READER_2.userId, READER_2.jobId, 2],
				[READER_2.userId, READER_2.jobId, 2],
				[READER_2.userId, READER_2.jobId, 2],
			]);
			assert.deepEqual(trail(progress), [
				[undefined, "gmail.import.record.started", "INFO", undefined],
				[1, "gmail.import.publication", "INFO", "ProcessGmailHistoryImportPage published"],
				[undefined, "gmail.import.record.finished", "INFO", "acked"],
			]);
			assert.deepEqual(identities(progress.slice(1)), [
				["progress", READER_2.userId, READER_2.jobId, "generation-1", 1],
				["progress", READER_2.userId, READER_2.jobId, "generation-1", 1],
			]);
			assert.deepEqual(w.dispatched, [{ ...READER_2, generation: "generation-1", page: 1 }]);
			assert.equal(await w.jobState(READER_2), "cancelled");
			assertNothingSensitive(w.capture.everythingLogged());
		});

		it("leaves batch responses, job state and announcements unchanged when the diagnostic sink throws", async () => {
			const scenario = async (recordDiagnostic?: (now: () => Date) => RecordGmailDiagnostic) => {
				const w = await wiredHarness({ recordDiagnostic });
				await w.addReader(READER_1);
				await w.addReader(READER_2);
				w.addUnread({ userId: USER, ids: ["SentinelMessageA1", "SentinelMessageB2"] });
				await w.mappings.removeMapping({ userId: READER_2.userId, accountEmail: SENTINEL_ACCOUNT, senderEmail: SENTINEL_SENDER });
				const response = await runEvent(w.handler, sqsEvent([
					{ messageId: "sqs-reader-1", body: start(READER_1) },
					{ messageId: "sqs-malformed", body: "not json" },
					{ messageId: "sqs-reader-2", body: start(READER_2) },
					{ messageId: "sqs-progress", body: body(GmailHistoryImportPageProcessedEvent, { ...READER_1, nextPage: { generation: "generation-1", page: 1 } }) },
				]));
				return {
					response,
					jobs: [await w.store.findJob(READER_1), await w.store.findJob(READER_2)],
					published: w.published,
					dispatched: w.dispatched,
					stored: w.bucket.keys(),
					diagnostics: w.capture.diagnostics().length,
					otherLines: w.capture.otherLines().length,
				};
			};

			const recorded = await scenario();
			const unrecorded = await scenario((now) => throwingGmailDiagnosticSink({ now }));

			assert.deepEqual({ ...unrecorded, diagnostics: recorded.diagnostics }, recorded);
			assert.equal(unrecorded.diagnostics, 0);
			assert.equal(recorded.otherLines, 1);
		});
	});
});
