import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailConnectionStore,
	type GmailHistoryImportJob,
	GmailHistoryImportJobIdSchema,
	type GmailHistoryImportMessageOutcome,
	type GmailHistoryImportStore,
	type GmailMessageId,
	GmailMessageIdSchema,
	summarizeGmailHistoryImport,
} from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailHistoryImportMessageFetchedDetail } from "@packages/hutch-infra-components";
import type { GmailHistory, GmailHttpAttempt, GmailHttpClassification, GmailHttpOperation, PutGmailImportRaw } from "@packages/provider-contracts/gmail-history";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailHistory, initInMemoryRawEmailBucket } from "@packages/test-fixtures/providers/gmail-history";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { type GmailHistoryImportPage, type GmailHistoryImportStep, initGmailHistoryImport } from "./gmail-history-import";
import type { GmailHistoryImportObservation } from "./gmail-history-import-observation.types";

const READER = UserIdSchema.parse("reader-1");
const JOB = GmailHistoryImportJobIdSchema.parse("a".repeat(32));
const TLDR = ForwardableSenderSchema.parse("dan@tldrnewsletter.com");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const GATEWAY = InboxAddressSchema.parse("gmail-def456@read.place");
const WORK_READLIST = InboxAddressSchema.parse("gmail-abc123@read.place");
const ALL_READLIST = InboxAddressSchema.parse("gmail-aaa111@read.place");
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const DAY_MS = 86_400_000;
const NOTHING: GmailHistoryImportStep = { next: undefined, completed: undefined, failed: undefined };
const NO_COUNTS = { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 };

function messageId(id: string): GmailMessageId {
	return GmailMessageIdSchema.parse(id);
}

function awaitingPermissionJob(): GmailHistoryImportJob {
	return {
		userId: READER,
		jobId: JOB,
		senderEmail: TLDR,
		destinationAddresses: [WORK_READLIST],
		connection: { gatewayAddress: GATEWAY, accountEmail: ACCOUNT },
		window: undefined,
		generation: "generation-0",
		page: 0,
		pageToken: undefined,
		listingCompletedAt: undefined,
		state: "awaiting-permission",
		counts: NO_COUNTS,
		failureReason: undefined,
		cancelReason: undefined,
		createdAt: CREATED_AT.toISOString(),
		updatedAt: CREATED_AT.toISOString(),
		completedAt: undefined,
	};
}

interface HarnessContext {
	store: GmailHistoryImportStore;
	connections: GmailConnectionStore;
	advance: (ms: number) => void;
	now: () => Date;
}

async function harness(overrides: {
	destinationAddresses?: GmailHistoryImportJob["destinationAddresses"];
	history?: (history: GmailHistory, context: HarnessContext) => GmailHistory;
	imports?: (imports: GmailHistoryImportStore) => GmailHistoryImportStore;
	putRaw?: (putRaw: PutGmailImportRaw, context: HarnessContext) => PutGmailImportRaw;
	publishFetched?: (detail: GmailHistoryImportMessageFetchedDetail) => Promise<void>;
} = {}) {
	let clock = CREATED_AT;
	const now = () => clock;
	const advance = (ms: number) => {
		clock = new Date(clock.getTime() + ms);
	};
	const gmail = initInMemoryGmailHistory();
	const bucket = initInMemoryRawEmailBucket();
	const store = initInMemoryGmailHistoryImport();
	const connections = initInMemoryGmailConnection({ now });
	const senders = initInMemoryGmailSender({ now });
	const published: GmailHistoryImportMessageFetchedDetail[] = [];
	const observations: GmailHistoryImportObservation[] = [];
	const context: HarnessContext = { store, connections, advance, now };
	const wrapHistory = overrides.history ?? ((history) => history);
	const wrapImports = overrides.imports ?? ((imports) => imports);
	const wrapPutRaw = overrides.putRaw ?? ((putRaw) => putRaw);

	await connections.createConnection({ userId: READER, gatewayAddress: GATEWAY });
	await connections.recordAccountEmail({ userId: READER, accountEmail: ACCOUNT });
	await senders.addSenderToFilter({ userId: READER, senderEmail: TLDR });
	await senders.mapSenderToAddress({ userId: READER, senderEmail: TLDR, mappedAddresses: [WORK_READLIST], deliveryMode: "links" });
	await store.createJob({ ...awaitingPermissionJob(), destinationAddresses: overrides.destinationAddresses ?? [WORK_READLIST] });

	const observed = initGmailHistoryImport({
		history: wrapHistory(gmail.history, context),
		imports: wrapImports(store),
		connections,
		senders,
		putRaw: wrapPutRaw(bucket.put, context),
		publishFetched: overrides.publishFetched ?? (async (detail) => {
			published.push(detail);
		}),
		now,
	});
	const observe = (observation: GmailHistoryImportObservation) => {
		observations.push(observation);
	};
	const importer = {
		start: (input: { userId: typeof READER; jobId: typeof JOB; generation: string }) => observed.start(input, observe),
		page: (input: GmailHistoryImportPage) => observed.page(input, observe),
	};
	const takeObservations = () => observations.splice(0);

	const startJob = async (generation: string) => {
		const started = await store.startJob({ userId: READER, jobId: JOB, generation, now: clock });
		assert(started, "the import can be started");
		return started;
	};

	const addUnread = (id: string, internalDate: string) => {
		gmail.addMessage({
			userId: READER,
			sender: TLDR,
			messageId: messageId(id),
			raw: Buffer.from(`Message-ID: <${id}@tldrnewsletter.com>\r\nFrom: dan@tldrnewsletter.com\r\n\r\n${id}`),
			internalDate,
			labelIds: ["INBOX", "UNREAD"],
		});
	};

	const runAllPages = async (generation: string) => {
		let step = await importer.start({ userId: READER, jobId: JOB, generation });
		while (step.next !== undefined) step = await importer.page(step.next);
		return step;
	};

	const settle = async (input: { id: string; generation: string; outcome: GmailHistoryImportMessageOutcome }) => {
		const recorded = await store.recordOutcome({ userId: READER, jobId: JOB, generation: input.generation, gmailMessageId: messageId(input.id), outcome: input.outcome, now: clock });
		assert.equal(recorded, "recorded");
	};

	const job = async () => {
		const found = await store.findJob({ userId: READER, jobId: JOB });
		assert(found, "the import job exists");
		return found;
	};

	return { gmail, bucket, store, connections, senders, published, importer, takeObservations, advance, now, startJob, addUnread, runAllPages, settle, job };
}

function publishedIds(published: GmailHistoryImportMessageFetchedDetail[]): string[] {
	return published.map((detail) => detail.gmailMessageId);
}

function publishedAt(count: number): GmailHistoryImportObservation[] {
	return Array.from({ length: count }, (_, index): GmailHistoryImportObservation => ({ kind: "message-processed", index, outcome: "published" }));
}

const ATTEMPTED: { [Operation in GmailHttpOperation]: Pick<GmailHttpAttempt, "request" | "requestedEndpoint"> } = {
	"messages.list": {
		request: { operation: "messages.list", fieldMask: "messages/id,nextPageToken", pageSize: 25, includeSpamTrash: false, pageTokenPresent: false },
		requestedEndpoint: "gmail.messages.list",
	},
	"messages.get": { request: { operation: "messages.get", fieldMask: "raw,internalDate,labelIds", format: "raw" }, requestedEndpoint: "gmail.messages.get" },
	"oauth.refresh": { request: { operation: "oauth.refresh", forceRefresh: false }, requestedEndpoint: "oauth.token" },
};

function attemptFor(operation: GmailHttpOperation, classification: GmailHttpClassification = "ok"): GmailHttpAttempt {
	return {
		operation,
		attempt: 1,
		...ATTEMPTED[operation],
		durationMs: 30,
		response: undefined,
		transportFailure: undefined,
		classification,
	};
}

describe("initGmailHistoryImport", () => {
	it("snapshots every selected destination and accepts mapping reordering", async () => {
		const second = InboxAddressSchema.parse("gmail-bbb222@read.place");
		const h = await harness({ destinationAddresses: [WORK_READLIST, second] });
		await h.senders.mapSenderToAddress({ userId: READER, senderEmail: TLDR, mappedAddresses: [second, WORK_READLIST], deliveryMode: "links" });
		await h.startJob("generation-1");
		h.addUnread("multiple", "2026-08-31T00:00:00.000Z");

		await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(h.published.map((detail) => detail.destinationAddresses), [[WORK_READLIST, second]]);
		assert.equal((await h.job()).state, "running");
	});

	it("cancels before fetching when a secondary destination changes", async () => {
		const second = InboxAddressSchema.parse("gmail-bbb222@read.place");
		const h = await harness({ destinationAddresses: [WORK_READLIST, second] });
		await h.senders.mapSenderToAddress({ userId: READER, senderEmail: TLDR, mappedAddresses: [WORK_READLIST], deliveryMode: "links" });
		await h.startJob("generation-1");
		h.addUnread("changed", "2026-08-31T00:00:00.000Z");

		await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(h.gmail.listRequests, []);
		assert.equal((await h.job()).cancelReason, "destination-changed");
		assert.deepEqual(h.takeObservations(), [{ kind: "job-cancelled", reason: "destination-changed", cancelledJobs: 1 }]);
	});

	it("fixes the 30-day window when permission is granted and keeps it when a partial failure is retried", async () => {
		const h = await harness();
		h.advance(5 * DAY_MS);
		await h.startJob("generation-1");
		h.addUnread("first", "2026-09-05T08:00:00.000Z");
		h.addUnread("second", "2026-09-04T08:00:00.000Z");

		await h.runAllPages("generation-1");
		await h.settle({ id: "first", generation: "generation-1", outcome: "imported" });
		await h.settle({ id: "second", generation: "generation-1", outcome: "failed" });
		const partial = await h.store.completeIfSettled({ userId: READER, jobId: JOB, now: h.now() });
		assert(partial, "the first run completes with a failure");
		assert.equal(summarizeGmailHistoryImport(partial).status, "partial-failure");

		h.advance(4 * DAY_MS);
		await h.startJob("generation-2");
		const retried = await h.runAllPages("generation-2");
		await h.settle({ id: "second", generation: "generation-2", outcome: "imported" });
		const completed = await h.store.completeIfSettled({ userId: READER, jobId: JOB, now: h.now() });

		const grantedAt = new Date(CREATED_AT.getTime() + 5 * DAY_MS);
		const window = { start: new Date(grantedAt.getTime() - 30 * DAY_MS).toISOString(), end: grantedAt.toISOString() };
		assert.deepEqual(h.gmail.listRequests.map((request) => request.window), [window, window]);
		assert.deepEqual(retried, NOTHING);
		assert.deepEqual(publishedIds(h.published), ["first", "second", "second"]);
		assert.equal(completed?.state, "complete");
		assert.deepEqual(completed?.counts, { ...NO_COUNTS, listed: 2, imported: 2 });
	});

	it("lists every page of unread mail and records where each raw message was stored", async () => {
		const h = await harness();
		await h.startJob("generation-1");
		for (let index = 0; index < 60; index++) {
			h.addUnread(`m${String(index).padStart(2, "0")}`, new Date(CREATED_AT.getTime() - (index + 1) * 60_000).toISOString());
		}

		const last = await h.runAllPages("generation-1");

		assert.deepEqual(last, NOTHING);
		assert.equal(h.gmail.listRequests.length, 3);
		assert.equal(h.published.length, 60);
		assert.equal(h.bucket.keys().length, 60);
		assert.deepEqual(h.published[0], {
			userId: READER,
			jobId: JOB,
			generation: "generation-1",
			gmailMessageId: "m00",
			accountEmail: ACCOUNT,
			senderEmail: TLDR,
			destinationAddresses: [WORK_READLIST],
			rawEmailS3Key: `gmail-import/${READER}/${JOB}/m00.eml`,
			internalDate: "2026-09-01T11:59:00.000Z",
		});
		const job = await h.job();
		assert.equal(job.counts.listed, 60);
		assert.equal(job.listingCompletedAt, CREATED_AT.toISOString());
	});

	it("completes at once as no-unread when the sender left nothing unread in the window", async () => {
		const h = await harness();
		await h.startJob("generation-1");

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert(step.completed, "the import completes");
		assert.equal(summarizeGmailHistoryImport(step.completed).status, "no-unread");
		assert.equal(step.next, undefined);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "page-listed", messageCount: 0, nextPagePresent: false },
			{ kind: "page-saved", nextPagePresent: false },
			{ kind: "job-completed", persisted: true },
		]);
	});

	it("leaves out mail that moved to spam or trash, or was deleted, after it was listed", async () => {
		const movedAfterListing: Record<string, "SPAM" | "TRASH" | "deleted"> = { spam: "SPAM", trash: "TRASH", gone: "deleted" };
		const h = await harness({
			history: (history) => ({
				...history,
				fetchRawMessage: async (input) => {
					const moved = movedAfterListing[input.messageId];
					if (moved === undefined) return history.fetchRawMessage(input);
					if (moved === "deleted") return { ok: true, value: { notFound: true } };
					return { ok: true, value: { raw: Buffer.from("moved"), internalDate: "2026-08-30T00:00:00.000Z", labelIds: [moved, "UNREAD"] } };
				},
			}),
		});
		await h.startJob("generation-1");
		h.addUnread("keep", "2026-08-31T00:00:00.000Z");
		h.addUnread("spam", "2026-08-30T00:00:00.000Z");
		h.addUnread("trash", "2026-08-29T00:00:00.000Z");
		h.addUnread("gone", "2026-08-28T00:00:00.000Z");

		await h.runAllPages("generation-1");

		assert.deepEqual(publishedIds(h.published), ["keep"]);
		assert.deepEqual(h.bucket.keys(), [`gmail-import/${READER}/${JOB}/keep.eml`]);
		assert.equal((await h.job()).counts.listed, 1);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "page-listed", messageCount: 4, nextPagePresent: false },
			{ kind: "message-processed", index: 0, outcome: "published" },
			{ kind: "message-processed", index: 1, outcome: "unlisted-label" },
			{ kind: "message-processed", index: 2, outcome: "unlisted-label" },
			{ kind: "message-processed", index: 3, outcome: "not-found" },
			{ kind: "page-saved", nextPagePresent: false },
			{ kind: "job-completed", persisted: false },
		]);
	});

	it("ignores a page from an earlier generation, another page number, a missing job or a job that is no longer running", async () => {
		const h = await harness();
		await h.startJob("generation-1");
		for (let index = 0; index < 30; index++) h.addUnread(`m${String(index).padStart(2, "0")}`, "2026-08-31T00:00:00.000Z");
		await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });
		h.takeObservations();

		const earlierGeneration = await h.importer.page({ userId: READER, jobId: JOB, generation: "generation-0", page: 1 });
		const skippedAhead = await h.importer.page({ userId: READER, jobId: JOB, generation: "generation-1", page: 3 });
		const missingJob = await h.importer.page({ userId: READER, jobId: GmailHistoryImportJobIdSchema.parse("b".repeat(32)), generation: "generation-1", page: 0 });
		await h.store.cancelJobs({ userId: READER, senderEmail: TLDR, reason: "user-cancelled", now: h.now() });
		const cancelled = await h.importer.page({ userId: READER, jobId: JOB, generation: "generation-1", page: 1 });

		assert.deepEqual([earlierGeneration, skippedAhead, missingJob, cancelled], [NOTHING, NOTHING, NOTHING, NOTHING]);
		assert.equal(h.gmail.listRequests.length, 1);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-skipped", reason: "generation-stale" },
			{ kind: "page-skipped", reason: "page-mismatch" },
			{ kind: "page-skipped", reason: "job-missing" },
			{ kind: "page-skipped", reason: "job-not-runnable" },
		]);
	});

	it("re-announces the next page when a saved page is delivered again, and completes a listed import once it has settled", async () => {
		const h = await harness();
		await h.startJob("generation-1");
		for (let index = 0; index < 30; index++) h.addUnread(`m${String(index).padStart(2, "0")}`, "2026-08-31T00:00:00.000Z");

		const first = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });
		const firstObserved = h.takeObservations();
		const redelivered = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });
		const redeliveredObserved = h.takeObservations();
		assert(first.next, "a second page follows");
		const lastPage = await h.importer.page(first.next);
		const lastPageObserved = h.takeObservations();
		for (const id of publishedIds(h.published)) await h.settle({ id, generation: "generation-1", outcome: "imported" });
		const lastPageAgain = await h.importer.page(first.next);

		const nextPage = { userId: READER, jobId: JOB, generation: "generation-1", page: 1 };
		assert.deepEqual(first, { ...NOTHING, next: nextPage });
		assert.deepEqual(redelivered, { ...NOTHING, next: nextPage });
		assert.deepEqual(lastPage, NOTHING);
		assert.equal(h.gmail.listRequests.length, 2);
		assert.equal(h.published.length, 30);
		assert.equal(lastPageAgain.completed?.state, "complete");
		assert.deepEqual(lastPageAgain.completed?.counts, { ...NO_COUNTS, listed: 30, imported: 30 });
		assert.deepEqual(firstObserved, [
			{ kind: "page-claimed" },
			{ kind: "page-listed", messageCount: 25, nextPagePresent: true },
			...publishedAt(25),
			{ kind: "page-saved", nextPagePresent: true },
		]);
		assert.deepEqual(redeliveredObserved, [{ kind: "page-already-processed", listingCompleted: false }]);
		assert.deepEqual(lastPageObserved, [
			{ kind: "page-claimed" },
			{ kind: "page-listed", messageCount: 5, nextPagePresent: false },
			...publishedAt(5),
			{ kind: "page-saved", nextPagePresent: false },
			{ kind: "job-completed", persisted: false },
		]);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-already-processed", listingCompleted: true },
			{ kind: "job-completed", persisted: true },
		]);
	});

	it("completes a retried import whose last page finds only mail that was already settled", async () => {
		const h = await harness();
		await h.startJob("generation-1");
		h.addUnread("only", "2026-08-31T00:00:00.000Z");
		await h.runAllPages("generation-1");
		await h.settle({ id: "only", generation: "generation-1", outcome: "imported" });
		await h.store.failJob({ userId: READER, jobId: JOB, generation: "generation-1", reason: "dead-lettered", now: h.now() });
		await h.startJob("generation-2");
		h.takeObservations();

		const retried = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-2" });

		assert.equal(retried.completed?.state, "complete");
		assert.deepEqual(retried.completed?.counts, { ...NO_COUNTS, listed: 1, imported: 1 });
		assert.deepEqual(publishedIds(h.published), ["only"]);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "page-listed", messageCount: 1, nextPagePresent: false },
			{ kind: "message-processed", index: 0, outcome: "already-settled" },
			{ kind: "page-saved", nextPagePresent: false },
			{ kind: "job-completed", persisted: true },
		]);
	});

	it("publishes the fetched mail again without counting it twice when the page could not be saved after publishing", async () => {
		let failNextSave = true;
		const h = await harness({
			imports: (imports) => ({
				...imports,
				savePage: async (input) => {
					if (!failNextSave) return imports.savePage(input);
					failNextSave = false;
					throw new Error("DynamoDB unavailable");
				},
			}),
		});
		await h.startJob("generation-1");
		h.addUnread("newer", "2026-08-31T00:00:00.000Z");
		h.addUnread("older", "2026-08-30T00:00:00.000Z");

		await assert.rejects(h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" }), /DynamoDB unavailable/);
		h.advance(61_000);
		await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });
		await h.settle({ id: "newer", generation: "generation-1", outcome: "imported" });
		await h.settle({ id: "older", generation: "generation-1", outcome: "already-imported" });
		const completed = await h.store.completeIfSettled({ userId: READER, jobId: JOB, now: h.now() });

		assert.deepEqual(publishedIds(h.published), ["newer", "older", "newer", "older"]);
		assert.deepEqual(completed?.counts, { ...NO_COUNTS, listed: 2, imported: 1, alreadyImported: 1 });
	});

	it("keeps importing when the connected account differs only in letter case", async () => {
		const h = await harness();
		await h.connections.recordAccountEmail({ userId: READER, accountEmail: GmailAccountEmailSchema.parse("Reader@Gmail.com") });
		await h.startJob("generation-1");
		h.addUnread("kept", "2026-08-31T00:00:00.000Z");

		await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(publishedIds(h.published), ["kept"]);
	});

	it("cancels the import when a different Gmail account or gateway is connected", async () => {
		const otherAccount = await harness();
		await otherAccount.connections.recordAccountEmail({ userId: READER, accountEmail: GmailAccountEmailSchema.parse("someone-else@gmail.com") });
		await otherAccount.startJob("generation-1");
		const otherGateway = await harness();
		await otherGateway.connections.createConnection({ userId: READER, gatewayAddress: InboxAddressSchema.parse("gmail-fff999@read.place") });
		await otherGateway.connections.recordAccountEmail({ userId: READER, accountEmail: ACCOUNT });
		await otherGateway.startJob("generation-1");

		const steps = [
			await otherAccount.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" }),
			await otherGateway.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" }),
		];

		assert.deepEqual(steps, [NOTHING, NOTHING]);
		assert.deepEqual([(await otherAccount.job()).state, (await otherAccount.job()).cancelReason], ["cancelled", "account-changed"]);
		assert.deepEqual([(await otherGateway.job()).state, (await otherGateway.job()).cancelReason], ["cancelled", "account-changed"]);
		assert.deepEqual([otherAccount.gmail.listRequests, otherGateway.gmail.listRequests], [[], []]);
		assert.deepEqual([otherAccount.takeObservations(), otherGateway.takeObservations()], [
			[{ kind: "job-cancelled", reason: "account-changed", cancelledJobs: 1 }],
			[{ kind: "job-cancelled", reason: "account-changed", cancelledJobs: 1 }],
		]);
	});

	it("cancels the import when Gmail is being disconnected or is gone", async () => {
		const disconnecting = await harness();
		await disconnecting.connections.markDisconnectRequested({ userId: READER });
		await disconnecting.startJob("generation-1");
		const disconnected = await harness();
		await disconnected.connections.deleteConnection(READER);
		await disconnected.startJob("generation-1");

		await disconnecting.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });
		await disconnected.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.equal((await disconnecting.job()).cancelReason, "disconnected");
		assert.equal((await disconnected.job()).cancelReason, "disconnected");
		assert.deepEqual([disconnecting.takeObservations(), disconnected.takeObservations()], [
			[{ kind: "job-cancelled", reason: "disconnected", cancelledJobs: 1 }],
			[{ kind: "job-cancelled", reason: "disconnected", cancelledJobs: 1 }],
		]);
	});

	it("cancels the import when the sender now goes to another readlist or is no longer mapped", async () => {
		const remapped = await harness();
		await remapped.senders.mapSenderToAddress({ userId: READER, senderEmail: TLDR, mappedAddresses: [ALL_READLIST], deliveryMode: "links" });
		await remapped.startJob("generation-1");
		const removed = await harness();
		await removed.senders.removeSender({ userId: READER, senderEmail: TLDR });
		await removed.startJob("generation-1");

		await remapped.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });
		await removed.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual([(await remapped.job()).state, (await remapped.job()).cancelReason], ["cancelled", "destination-changed"]);
		assert.deepEqual([(await removed.job()).state, (await removed.job()).cancelReason], ["cancelled", "mapping-removed"]);
		assert.deepEqual([remapped.takeObservations(), removed.takeObservations()], [
			[{ kind: "job-cancelled", reason: "destination-changed", cancelledJobs: 1 }],
			[{ kind: "job-cancelled", reason: "mapping-removed", cancelledJobs: 1 }],
		]);
	});

	it("stops when another delivery of the same page holds its claim", async () => {
		const h = await harness();
		await h.startJob("generation-1");
		assert.equal(await h.store.claimPage({ userId: READER, jobId: JOB, generation: "generation-1", page: 0, now: h.now() }), true);

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, NOTHING);
		assert.deepEqual(h.gmail.listRequests, []);
		assert.deepEqual(h.takeObservations(), [{ kind: "page-skipped", reason: "claim-lost" }]);
	});

	it("fails the import as permission-revoked when the read-only permission is missing", async () => {
		const h = await harness();
		await h.startJob("generation-1");
		h.gmail.failNext({ method: "listUnreadMessageIds", failure: { ok: false, reason: "readonly-permission-required" } });

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, { ...NOTHING, failed: "permission-revoked" });
		assert.deepEqual([(await h.job()).state, (await h.job()).failureReason], ["failed", "permission-revoked"]);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: undefined, reason: "readonly-permission-required", status: undefined },
			{ kind: "job-failed", reason: "permission-revoked", persisted: true },
		]);
	});

	it("fails the import as gmail-rejected when Gmail refuses a message fetch, having published only the mail recorded before it", async () => {
		let fetches = 0;
		const h = await harness({
			history: (inner) => ({
				listUnreadMessageIds: async (input) => {
					input.observe(attemptFor("oauth.refresh"));
					input.observe(attemptFor("messages.list"));
					return inner.listUnreadMessageIds(input);
				},
				fetchRawMessage: async (input) => {
					fetches++;
					if (fetches === 2) {
						input.observe(attemptFor("messages.get", "rejected"));
						return { ok: false, reason: "rejected", status: 400, message: "Invalid id" };
					}
					input.observe(attemptFor("messages.get"));
					return inner.fetchRawMessage(input);
				},
			}),
		});
		await h.startJob("generation-1");
		h.addUnread("newer", "2026-08-31T00:00:00.000Z");
		h.addUnread("older", "2026-08-30T00:00:00.000Z");

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, { ...NOTHING, failed: "gmail-rejected" });
		assert.equal((await h.job()).failureReason, "gmail-rejected");
		assert.deepEqual(publishedIds(h.published), ["newer"]);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "http-attempt", attempt: attemptFor("oauth.refresh") },
			{ kind: "http-attempt", attempt: attemptFor("messages.list") },
			{ kind: "page-listed", messageCount: 2, nextPagePresent: false },
			{ kind: "http-attempt", attempt: attemptFor("messages.get") },
			{ kind: "message-processed", index: 0, outcome: "published" },
			{ kind: "http-attempt", attempt: attemptFor("messages.get", "rejected") },
			{ kind: "gmail-call-failed", operation: "messages.get", lastAttemptOperation: "messages.get", reason: "rejected", status: 400 },
			{ kind: "job-failed", reason: "gmail-rejected", persisted: true },
		]);
	});

	it("blames no earlier call's HTTP attempt when a message fetch fails before sending any request", async () => {
		let fetches = 0;
		const h = await harness({
			history: (inner) => ({
				listUnreadMessageIds: async (input) => {
					input.observe(attemptFor("messages.list"));
					return inner.listUnreadMessageIds(input);
				},
				fetchRawMessage: async (input) => {
					fetches++;
					if (fetches === 2) return { ok: false, reason: "reauth-required" };
					input.observe(attemptFor("messages.get"));
					return inner.fetchRawMessage(input);
				},
			}),
		});
		await h.startJob("generation-1");
		h.addUnread("newer", "2026-08-31T00:00:00.000Z");
		h.addUnread("older", "2026-08-30T00:00:00.000Z");

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, { ...NOTHING, failed: "permission-revoked" });
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "http-attempt", attempt: attemptFor("messages.list") },
			{ kind: "page-listed", messageCount: 2, nextPagePresent: false },
			{ kind: "http-attempt", attempt: attemptFor("messages.get") },
			{ kind: "message-processed", index: 0, outcome: "published" },
			{ kind: "gmail-call-failed", operation: "messages.get", lastAttemptOperation: undefined, reason: "reauth-required", status: undefined },
			{ kind: "connection-revoked", persisted: true },
			{ kind: "job-failed", reason: "permission-revoked", persisted: true },
		]);
	});

	it("completes once every recorded message settles when mail recorded before Gmail became unavailable is read before the retry", async () => {
		let fetches = 0;
		const h = await harness({
			history: (inner) => ({
				...inner,
				fetchRawMessage: async (input) => {
					fetches++;
					if (fetches === 2) return { ok: false, reason: "unavailable", status: 429 };
					return inner.fetchRawMessage(input);
				},
			}),
		});
		await h.startJob("generation-1");
		h.addUnread("newer", "2026-08-31T00:00:00.000Z");
		h.addUnread("older", "2026-08-30T00:00:00.000Z");

		await assert.rejects(h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" }), /unavailable \(429\)/);
		h.gmail.addMessage({
			userId: READER,
			sender: TLDR,
			messageId: messageId("newer"),
			raw: Buffer.from("newer"),
			internalDate: "2026-08-31T00:00:00.000Z",
			labelIds: ["INBOX"],
		});
		h.advance(61_000);
		await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });
		await h.settle({ id: "newer", generation: "generation-1", outcome: "imported" });
		await h.settle({ id: "older", generation: "generation-1", outcome: "imported" });
		const completed = await h.store.completeIfSettled({ userId: READER, jobId: JOB, now: h.now() });

		assert.deepEqual(publishedIds(h.published), ["newer", "older"]);
		assert.equal(completed?.state, "complete");
		assert.deepEqual(completed?.counts, { ...NO_COUNTS, listed: 2, imported: 2 });
	});

	it("marks the connection revoked and fails the import when Google no longer accepts the grant", async () => {
		const h = await harness({
			history: (inner) => ({
				...inner,
				listUnreadMessageIds: async (input) => {
					input.observe(attemptFor("oauth.refresh", "reauth-required"));
					return { ok: false, reason: "reauth-required" };
				},
			}),
		});
		await h.startJob("generation-1");

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, { ...NOTHING, failed: "permission-revoked" });
		assert.equal((await h.connections.findConnectionByUserId(READER))?.revokedReason, "invalid-grant");
		assert.equal((await h.job()).failureReason, "permission-revoked");
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "http-attempt", attempt: attemptFor("oauth.refresh", "reauth-required") },
			{ kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: "oauth.refresh", reason: "reauth-required", status: undefined },
			{ kind: "connection-revoked", persisted: true },
			{ kind: "job-failed", reason: "permission-revoked", persisted: true },
		]);
	});

	it("blames no HTTP attempt when the listing fails before any request because no refresh token is stored", async () => {
		const h = await harness();
		await h.startJob("generation-1");
		h.gmail.failNext({ method: "listUnreadMessageIds", failure: { ok: false, reason: "reauth-required" } });

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, { ...NOTHING, failed: "permission-revoked" });
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: undefined, reason: "reauth-required", status: undefined },
			{ kind: "connection-revoked", persisted: true },
			{ kind: "job-failed", reason: "permission-revoked", persisted: true },
		]);
	});

	it("retries instead of failing when the connection was replaced while Google refused the grant", async () => {
		const h = await harness({
			history: (inner, context) => ({
				...inner,
				listUnreadMessageIds: async () => {
					context.advance(1_000);
					await context.connections.clearRevoked({ userId: READER });
					return { ok: false, reason: "reauth-required" };
				},
			}),
		});
		await h.startJob("generation-1");

		await assert.rejects(h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" }), /connection changed/);
		assert.equal((await h.job()).state, "running");
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: undefined, reason: "reauth-required", status: undefined },
			{ kind: "connection-revoked", persisted: false },
		]);
	});

	it("reports no failure when the import was cancelled while Gmail was refusing it", async () => {
		const h = await harness({
			history: (inner, context) => ({
				...inner,
				listUnreadMessageIds: async () => {
					await context.store.cancelJobs({ userId: READER, senderEmail: TLDR, reason: "user-cancelled", now: context.now() });
					return { ok: false, reason: "rejected", status: 400, message: "Bad query" };
				},
			}),
		});
		await h.startJob("generation-1");

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, NOTHING);
		assert.equal((await h.job()).state, "cancelled");
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: undefined, reason: "rejected", status: 400 },
			{ kind: "job-failed", reason: "gmail-rejected", persisted: false },
		]);
	});

	it("throws so the page is retried when Gmail is unavailable", async () => {
		const h = await harness({
			history: (inner) => ({
				...inner,
				listUnreadMessageIds: async (input) => {
					input.observe(attemptFor("oauth.refresh"));
					input.observe(attemptFor("messages.list", "unavailable"));
					return { ok: false, reason: "unavailable", status: 503 };
				},
			}),
		});
		await h.startJob("generation-1");

		await assert.rejects(h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" }), /unavailable \(503\)/);
		assert.equal((await h.job()).state, "running");
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "http-attempt", attempt: attemptFor("oauth.refresh") },
			{ kind: "http-attempt", attempt: attemptFor("messages.list", "unavailable") },
			{ kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: "messages.list", reason: "unavailable", status: 503 },
		]);
	});

	it("blames the token refresh, not the listing, and retries the page when Google's token endpoint is unavailable", async () => {
		const h = await harness({
			history: (inner) => ({
				...inner,
				listUnreadMessageIds: async (input) => {
					input.observe(attemptFor("oauth.refresh", "unavailable"));
					return { ok: false, reason: "unavailable", status: 503 };
				},
			}),
		});
		await h.startJob("generation-1");

		await assert.rejects(h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" }), /unavailable \(503\)/);
		assert.equal((await h.job()).state, "running");
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "http-attempt", attempt: attemptFor("oauth.refresh", "unavailable") },
			{ kind: "gmail-call-failed", operation: "messages.list", lastAttemptOperation: "oauth.refresh", reason: "unavailable", status: 503 },
		]);
	});

	it("stops without publishing when the import is cancelled while its mail is being stored", async () => {
		const h = await harness({
			putRaw: (inner, context) => async (input) => {
				await inner(input);
				await context.store.cancelJobs({ userId: READER, senderEmail: TLDR, reason: "user-cancelled", now: context.now() });
			},
		});
		await h.startJob("generation-1");
		h.addUnread("stored", "2026-08-31T00:00:00.000Z");

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, NOTHING);
		assert.deepEqual(h.published, []);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "page-listed", messageCount: 1, nextPagePresent: false },
			{ kind: "page-skipped", reason: "fetched-stale" },
		]);
	});

	it("asks for no further page when the page can no longer be saved", async () => {
		const h = await harness({ imports: (imports) => ({ ...imports, savePage: async () => false }) });
		await h.startJob("generation-1");
		h.addUnread("published", "2026-08-31T00:00:00.000Z");

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		assert.deepEqual(step, NOTHING);
		assert.deepEqual(publishedIds(h.published), ["published"]);
		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "page-listed", messageCount: 1, nextPagePresent: false },
			{ kind: "message-processed", index: 0, outcome: "published" },
			{ kind: "page-skipped", reason: "save-page-lost" },
		]);
	});

	it("hands each Gmail HTTP attempt to the observer of the page it belongs to, without message ids or addresses", async () => {
		const h = await harness({
			history: (inner) => ({
				listUnreadMessageIds: async (input) => {
					input.observe(attemptFor("messages.list"));
					return inner.listUnreadMessageIds(input);
				},
				fetchRawMessage: async (input) => {
					input.observe(attemptFor("messages.get"));
					return inner.fetchRawMessage(input);
				},
			}),
		});
		await h.startJob("generation-1");
		h.addUnread("SentinelMessageA1", "2026-08-31T00:00:00.000Z");
		h.addUnread("SentinelMessageB2", "2026-08-30T00:00:00.000Z");

		const step = await h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" });

		const observed = h.takeObservations();
		assert.deepEqual(step, NOTHING);
		assert.deepEqual(observed, [
			{ kind: "page-claimed" },
			{ kind: "http-attempt", attempt: attemptFor("messages.list") },
			{ kind: "page-listed", messageCount: 2, nextPagePresent: false },
			{ kind: "http-attempt", attempt: attemptFor("messages.get") },
			{ kind: "message-processed", index: 0, outcome: "published" },
			{ kind: "http-attempt", attempt: attemptFor("messages.get") },
			{ kind: "message-processed", index: 1, outcome: "published" },
			{ kind: "page-saved", nextPagePresent: false },
			{ kind: "job-completed", persisted: false },
		]);
		const serialized = JSON.stringify(observed);
		for (const sensitive of ["SentinelMessage", TLDR, ACCOUNT, GATEWAY]) assert.equal(serialized.includes(sensitive), false, sensitive);
	});

	it("observes a fetched message it could not announce by position and error class, then rethrows the same error", async () => {
		const refused = new TypeError("EventBridge refused SentinelMessageA1 from dan@tldrnewsletter.com");
		const h = await harness({
			publishFetched: async () => {
				throw refused;
			},
		});
		await h.startJob("generation-1");
		h.addUnread("SentinelMessageA1", "2026-08-31T00:00:00.000Z");

		await assert.rejects(h.importer.start({ userId: READER, jobId: JOB, generation: "generation-1" }), (error) => error === refused);

		assert.deepEqual(h.takeObservations(), [
			{ kind: "page-claimed" },
			{ kind: "page-listed", messageCount: 1, nextPagePresent: false },
			{ kind: "message-publication-failed", index: 0, errorName: "TypeError" },
		]);
		assert.equal((await h.job()).state, "running");
	});
});
