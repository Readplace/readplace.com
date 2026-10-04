import assert from "node:assert/strict";
import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJob,
	GmailHistoryImportJobIdSchema,
	GmailMessageIdSchema,
	type GmailHistoryImportStore,
} from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailHistoryImport } from "./in-memory-gmail-history-import";

const READER = UserIdSchema.parse("user-1");
const OTHER_READER = UserIdSchema.parse("user-2");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const JOB_ID = GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef");
const SECOND_JOB_ID = GmailHistoryImportJobIdSchema.parse("fedcba9876543210fedcba9876543210");
const REF = { userId: READER, jobId: JOB_ID };
const CREATED_AT = new Date("2026-09-30T00:00:00.000Z");
const STARTED_AT = new Date("2026-09-30T01:00:00.000Z");
const LATER = new Date("2026-09-30T02:00:00.000Z");

function awaitingJob(overrides: Partial<GmailHistoryImportJob> = {}): GmailHistoryImportJob {
	return {
		userId: READER,
		jobId: JOB_ID,
		senderEmail: TLDR,
		destinationAddresses: [InboxAddressSchema.parse("gmail-a7b2c9@read.place")],
		connection: {
			gatewayAddress: InboxAddressSchema.parse("gmail-x1y2z3@read.place"),
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		},
		window: undefined,
		generation: "gen-0",
		page: 0,
		pageToken: undefined,
		listingCompletedAt: undefined,
		state: "awaiting-permission",
		counts: {
			listed: 0,
			imported: 0,
			alreadyImported: 0,
			skippedNoMessageId: 0,
			skippedSenderMismatch: 0,
			failed: 0,
			cancelled: 0,
		},
		failureReason: undefined,
		cancelReason: undefined,
		createdAt: CREATED_AT.toISOString(),
		updatedAt: CREATED_AT.toISOString(),
		completedAt: undefined,
		...overrides,
	};
}

function gmailMessage(id: string) {
	return GmailMessageIdSchema.parse(id);
}

async function runningJob(store: GmailHistoryImportStore, generation: string): Promise<GmailHistoryImportJob> {
	await store.createJob(awaitingJob());
	await store.startJob({ ...REF, generation, now: STARTED_AT });
	assert.equal(await store.claimPage({ ...REF, generation, page: 0, now: STARTED_AT }), true);
	const job = await store.findJob(REF);
	assert(job);
	return job;
}

async function fetchMessage(store: GmailHistoryImportStore, input: { generation: string; id: string }) {
	return store.recordFetched({
		...REF,
		generation: input.generation,
		gmailMessageId: gmailMessage(input.id),
		rawS3Key: `gmail-import/user-1/${JOB_ID}/${input.id}.eml`,
		now: STARTED_AT,
	});
}

async function lastPage(store: GmailHistoryImportStore): Promise<void> {
	const job = await store.findJob(REF);
	assert(job);
	assert.equal(await store.savePage({ previous: job, pageToken: undefined, now: LATER }), true);
}

describe("initInMemoryGmailHistoryImport", () => {
	describe("creating and finding jobs", () => {
		it("stores a new job and lists the reader's jobs only", async () => {
			const store = initInMemoryGmailHistoryImport();
			await store.createJob(awaitingJob({ jobId: SECOND_JOB_ID }));
			await store.createJob(awaitingJob());
			await store.createJob(awaitingJob({ userId: OTHER_READER }));

			assert.deepEqual(await store.findJob(REF), awaitingJob());
			assert.deepEqual(
				(await store.listJobsByUserId(READER)).map((job) => job.jobId),
				[JOB_ID, SECOND_JOB_ID],
			);
		});

		it("refuses to create a job id that already exists", async () => {
			const store = initInMemoryGmailHistoryImport();
			await store.createJob(awaitingJob());

			await expect(store.createJob(awaitingJob())).rejects.toBeInstanceOf(ConditionalCheckFailedException);
		});
	});

	describe("startJob", () => {
		it("queues a job waiting for permission with a window ending when it starts", async () => {
			const store = initInMemoryGmailHistoryImport();
			await store.createJob(awaitingJob());

			const started = await store.startJob({ ...REF, generation: "gen-1", now: STARTED_AT });

			assert.deepEqual(started, {
				...awaitingJob(),
				state: "queued",
				generation: "gen-1",
				window: { start: "2026-08-31T01:00:00.000Z", end: "2026-09-30T01:00:00.000Z" },
				updatedAt: STARTED_AT.toISOString(),
			});
			assert.deepEqual(await store.findJob(REF), started);
		});

		it("keeps the original window when a failed import is retried days later", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			await store.failJob({ ...REF, generation: "gen-1", reason: "gmail-rejected", now: LATER });

			const retried = await store.startJob({ ...REF, generation: "gen-2", now: new Date("2026-10-05T00:00:00.000Z") });

			assert.deepEqual(retried?.window, { start: "2026-08-31T01:00:00.000Z", end: "2026-09-30T01:00:00.000Z" });
			assert.equal(retried?.state, "queued");
			assert.equal(retried?.failureReason, undefined);
		});

		it("refuses to restart a job that is queued, running, cleanly complete or cancelled", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			assert.equal(await store.startJob({ ...REF, generation: "gen-2", now: LATER }), undefined);

			await lastPage(store);
			await store.completeIfSettled({ ...REF, now: LATER });
			assert.equal(await store.startJob({ ...REF, generation: "gen-2", now: LATER }), undefined);

			await store.createJob(awaitingJob({ jobId: SECOND_JOB_ID }));
			await store.cancelJobs({ userId: READER, senderEmail: TLDR, reason: "user-cancelled", now: LATER });
			assert.equal(await store.startJob({ userId: READER, jobId: SECOND_JOB_ID, generation: "gen-2", now: LATER }), undefined);
		});

		it("finds nothing to start for an unknown job", async () => {
			const store = initInMemoryGmailHistoryImport();

			assert.equal(await store.startJob({ ...REF, generation: "gen-1", now: STARTED_AT }), undefined);
		});
	});

	describe("claimPage", () => {
		it("lets one worker hold the current page for a minute and marks the job running", async () => {
			const store = initInMemoryGmailHistoryImport();
			await store.createJob(awaitingJob());
			await store.startJob({ ...REF, generation: "gen-1", now: STARTED_AT });

			assert.equal(await store.claimPage({ ...REF, generation: "gen-1", page: 0, now: STARTED_AT }), true);
			assert.equal((await store.findJob(REF))?.state, "running");
			assert.equal(await store.claimPage({ ...REF, generation: "gen-1", page: 0, now: new Date(STARTED_AT.getTime() + 59_000) }), false);
			assert.equal(await store.claimPage({ ...REF, generation: "gen-1", page: 0, now: new Date(STARTED_AT.getTime() + 60_001) }), true);
		});

		it("refuses a page from another run, another page, or a job no longer in flight", async () => {
			const store = initInMemoryGmailHistoryImport();
			assert.equal(await store.claimPage({ ...REF, generation: "gen-1", page: 0, now: STARTED_AT }), false);
			await store.createJob(awaitingJob());
			assert.equal(await store.claimPage({ ...REF, generation: "gen-0", page: 0, now: STARTED_AT }), false);
			await store.startJob({ ...REF, generation: "gen-1", now: STARTED_AT });

			assert.equal(await store.claimPage({ ...REF, generation: "gen-old", page: 0, now: STARTED_AT }), false);
			assert.equal(await store.claimPage({ ...REF, generation: "gen-1", page: 1, now: STARTED_AT }), false);
		});

		it("frees the next page as soon as the current one is saved", async () => {
			const store = initInMemoryGmailHistoryImport();
			const job = await runningJob(store, "gen-1");

			assert.equal(await store.savePage({ previous: job, pageToken: "next", now: STARTED_AT }), true);

			assert.equal(await store.claimPage({ ...REF, generation: "gen-1", page: 1, now: STARTED_AT }), true);
			const saved = await store.findJob(REF);
			assert.equal(saved?.page, 1);
			assert.equal(saved?.pageToken, "next");
			assert.equal(saved?.listingCompletedAt, undefined);
		});
	});

	describe("savePage", () => {
		it("refuses a page save from a stale run or for a page already saved", async () => {
			const store = initInMemoryGmailHistoryImport();
			const job = await runningJob(store, "gen-1");

			assert.equal(await store.savePage({ previous: { ...job, generation: "gen-old" }, pageToken: undefined, now: LATER }), false);
			assert.equal(await store.savePage({ previous: job, pageToken: "next", now: LATER }), true);
			assert.equal(await store.savePage({ previous: job, pageToken: undefined, now: LATER }), false);
		});
	});

	describe("recording messages and outcomes", () => {
		it("counts each listed message once and settles it once, however often it is fetched or its outcome delivered", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");

			assert.equal(await fetchMessage(store, { generation: "gen-1", id: "m1" }), "recorded");
			assert.equal(await fetchMessage(store, { generation: "gen-1", id: "m1" }), "recorded");
			assert.equal((await store.findJob(REF))?.counts.listed, 1);

			const outcome = { ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m1"), outcome: "imported" as const, now: LATER };
			assert.equal(await store.recordOutcome(outcome), "recorded");
			assert.equal(await store.recordOutcome(outcome), "duplicate");
			assert.equal(await store.recordOutcome({ ...outcome, outcome: "already-imported" }), "duplicate");
			assert.equal(await fetchMessage(store, { generation: "gen-1", id: "m1" }), "already-settled");

			const counts = (await store.findJob(REF))?.counts;
			assert.equal(counts?.listed, 1);
			assert.equal(counts?.imported, 1);
			assert.equal(counts?.alreadyImported, 0);
		});

		it("ignores outcomes from an earlier run and outcomes for messages it never fetched", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			await fetchMessage(store, { generation: "gen-1", id: "m1" });

			const outcome = { ...REF, gmailMessageId: gmailMessage("m1"), outcome: "imported" as const, now: LATER };
			assert.equal(await store.recordOutcome({ ...outcome, generation: "gen-old" }), "stale");
			assert.equal(await store.recordOutcome({ ...outcome, generation: "gen-1", gmailMessageId: gmailMessage("never") }), "stale");
			assert.equal((await store.findJob(REF))?.counts.imported, 0);
		});

		it("records nothing for a run that is no longer the job's current one", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");

			assert.equal(await fetchMessage(store, { generation: "gen-old", id: "m1" }), "stale");
			await store.cancelJobs({ userId: READER, senderEmail: undefined, reason: "user-cancelled", now: LATER });
			assert.equal(await fetchMessage(store, { generation: "gen-1", id: "m1" }), "stale");
			assert.equal((await store.findJob(REF))?.counts.listed, 0);
		});

		it("ignores a late outcome of a failed run once the retry is under way", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			await fetchMessage(store, { generation: "gen-1", id: "m1" });
			await store.failJob({ ...REF, generation: "gen-1", reason: "dead-lettered", now: LATER });
			await store.startJob({ ...REF, generation: "gen-2", now: LATER });

			const late = { ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m1"), outcome: "imported" as const, now: LATER };
			assert.equal(await store.recordOutcome(late), "stale");
			assert.equal((await store.findJob(REF))?.counts.imported, 0);
		});
	});

	describe("completeIfSettled", () => {
		it("completes a job whose last page listed nothing new", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			await lastPage(store);

			const completed = await store.completeIfSettled({ ...REF, now: LATER });

			assert.equal(completed?.state, "complete");
			assert.equal(completed?.completedAt, LATER.toISOString());
			assert.equal(completed?.listingCompletedAt, LATER.toISOString());
			assert.equal(await store.completeIfSettled({ ...REF, now: LATER }), undefined);
		});

		it("waits for the listing to finish and for every listed message to settle", async () => {
			const store = initInMemoryGmailHistoryImport();
			assert.equal(await store.completeIfSettled({ ...REF, now: LATER }), undefined);
			await runningJob(store, "gen-1");
			await fetchMessage(store, { generation: "gen-1", id: "m1" });
			await fetchMessage(store, { generation: "gen-1", id: "m2" });
			assert.equal(await store.completeIfSettled({ ...REF, now: LATER }), undefined);

			await lastPage(store);
			await store.recordOutcome({ ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m1"), outcome: "imported", now: LATER });
			assert.equal(await store.completeIfSettled({ ...REF, now: LATER }), undefined);

			await store.recordOutcome({ ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m2"), outcome: "skipped-no-message-id", now: LATER });
			const completed = await store.completeIfSettled({ ...REF, now: LATER });
			assert.deepEqual(completed?.counts, {
				listed: 2,
				imported: 1,
				alreadyImported: 0,
				skippedNoMessageId: 1,
				skippedSenderMismatch: 0,
				failed: 0,
				cancelled: 0,
			});
		});

		it("completes a page replayed after a crash even when an outcome landed before the replay", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			await fetchMessage(store, { generation: "gen-1", id: "m1" });
			await fetchMessage(store, { generation: "gen-1", id: "m2" });
			await store.recordOutcome({ ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m1"), outcome: "imported", now: LATER });

			assert.equal(await fetchMessage(store, { generation: "gen-1", id: "m1" }), "already-settled");
			assert.equal(await fetchMessage(store, { generation: "gen-1", id: "m2" }), "recorded");
			await lastPage(store);
			await store.recordOutcome({ ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m2"), outcome: "imported", now: LATER });

			const completed = await store.completeIfSettled({ ...REF, now: LATER });
			assert.equal(completed?.state, "complete");
			assert.equal(completed?.counts.listed, 2);
			assert.equal(completed?.counts.imported, 2);
		});

		it("retries only the failed messages of a partly failed import and completes with correct counts", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			for (const id of ["m1", "m2", "m3"]) await fetchMessage(store, { generation: "gen-1", id });
			await lastPage(store);
			await store.recordOutcome({ ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m1"), outcome: "imported", now: LATER });
			await store.recordOutcome({ ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m2"), outcome: "already-imported", now: LATER });
			await store.recordOutcome({ ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m3"), outcome: "failed", now: LATER });
			assert.equal((await store.completeIfSettled({ ...REF, now: LATER }))?.counts.failed, 1);

			const retried = await store.startJob({ ...REF, generation: "gen-2", now: LATER });
			assert.equal(retried?.counts.listed, 2);
			assert.equal(retried?.counts.failed, 0);
			assert.equal(retried?.completedAt, undefined);
			assert.equal(await store.claimPage({ ...REF, generation: "gen-2", page: 0, now: LATER }), true);
			assert.equal(await fetchMessage(store, { generation: "gen-2", id: "m1" }), "already-settled");
			assert.equal(await fetchMessage(store, { generation: "gen-2", id: "m2" }), "already-settled");
			assert.equal(await fetchMessage(store, { generation: "gen-2", id: "m3" }), "recorded");
			await lastPage(store);
			await store.recordOutcome({ ...REF, generation: "gen-2", gmailMessageId: gmailMessage("m3"), outcome: "imported", now: LATER });

			const completed = await store.completeIfSettled({ ...REF, now: LATER });
			assert.deepEqual(completed?.counts, {
				listed: 3,
				imported: 2,
				alreadyImported: 1,
				skippedNoMessageId: 0,
				skippedSenderMismatch: 0,
				failed: 0,
				cancelled: 0,
			});
		});

		it("lists again, after a failed run is retried, the messages whose outcome never arrived", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			await fetchMessage(store, { generation: "gen-1", id: "m1" });
			await store.failJob({ ...REF, generation: "gen-1", reason: "dead-lettered", now: LATER });

			await store.startJob({ ...REF, generation: "gen-2", now: LATER });
			await store.claimPage({ ...REF, generation: "gen-2", page: 0, now: LATER });
			assert.equal(await fetchMessage(store, { generation: "gen-2", id: "m1" }), "recorded");
			await lastPage(store);
			await store.recordOutcome({ ...REF, generation: "gen-2", gmailMessageId: gmailMessage("m1"), outcome: "imported", now: LATER });

			const completed = await store.completeIfSettled({ ...REF, now: LATER });
			assert.equal(completed?.counts.listed, 1);
			assert.equal(completed?.counts.imported, 1);
		});
	});

	describe("failJob", () => {
		it("fails the current run with its reason", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");

			const failed = await store.failJob({ ...REF, generation: "gen-1", reason: "permission-revoked", now: LATER });

			assert.equal(failed?.state, "failed");
			assert.equal(failed?.failureReason, "permission-revoked");
			assert.equal(await store.failJob({ ...REF, generation: "gen-1", reason: "gmail-rejected", now: LATER }), undefined);
		});

		it("fails a queued run of the given generation and leaves a missing job alone", async () => {
			const store = initInMemoryGmailHistoryImport();
			assert.equal(await store.failJob({ ...REF, generation: "gen-1", reason: "dead-lettered", now: LATER }), undefined);
			await store.createJob(awaitingJob());
			await store.startJob({ ...REF, generation: "gen-1", now: STARTED_AT });

			assert.equal((await store.failJob({ ...REF, generation: "gen-1", reason: "dead-lettered", now: LATER }))?.state, "failed");
		});

		it("leaves a job alone when the failing run is not its current one", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");

			assert.equal(await store.failJob({ ...REF, generation: "gen-old", reason: "gmail-rejected", now: LATER }), undefined);
			assert.equal((await store.findJob(REF))?.state, "running");
		});
	});

	describe("cancelJobs", () => {
		it("cancels the reader's unfinished imports from one sender and leaves finished ones alone", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			await lastPage(store);
			await store.completeIfSettled({ ...REF, now: LATER });
			await store.createJob(awaitingJob({ jobId: SECOND_JOB_ID }));
			await store.createJob(awaitingJob({ jobId: GmailHistoryImportJobIdSchema.parse("11111111111111111111111111111111"), senderEmail: BREW }));
			await store.createJob(awaitingJob({ userId: OTHER_READER }));

			const cancelled = await store.cancelJobs({ userId: READER, senderEmail: TLDR, reason: "mapping-removed", now: LATER });

			assert.deepEqual(
				cancelled.map((job) => [job.jobId, job.state, job.cancelReason]),
				[[SECOND_JOB_ID, "cancelled", "mapping-removed"]],
			);
			assert.equal((await store.findJob(REF))?.state, "complete");
		});

		it("cancels every unfinished import of the reader when no sender is given", async () => {
			const store = initInMemoryGmailHistoryImport();
			await store.createJob(awaitingJob());
			await store.createJob(awaitingJob({ jobId: SECOND_JOB_ID, senderEmail: BREW }));

			const cancelled = await store.cancelJobs({ userId: READER, senderEmail: undefined, reason: "disconnected", now: LATER });

			assert.equal(cancelled.length, 2);
			assert.deepEqual(
				(await store.listJobsByUserId(READER)).map((job) => job.state),
				["cancelled", "cancelled"],
			);
		});
	});

	describe("deleteAllByUserId", () => {
		it("erases the reader's jobs and messages and keeps other readers' jobs", async () => {
			const store = initInMemoryGmailHistoryImport();
			await runningJob(store, "gen-1");
			await fetchMessage(store, { generation: "gen-1", id: "m1" });
			await store.createJob(awaitingJob({ userId: OTHER_READER, destinationAddresses: [InboxAddressSchema.parse("work-a7b2c9@read.place"), InboxAddressSchema.parse("travel-a7b2c9@read.place")] }));

			await store.deleteAllByUserId(READER);

			assert.deepEqual(await store.listJobsByUserId(READER), []);
			assert.equal(
				await store.recordOutcome({ ...REF, generation: "gen-1", gmailMessageId: gmailMessage("m1"), outcome: "imported", now: LATER }),
				"stale",
			);
			assert.deepEqual((await store.listJobsByUserId(OTHER_READER)).map((job) => job.destinationAddresses), [[InboxAddressSchema.parse("work-a7b2c9@read.place"), InboxAddressSchema.parse("travel-a7b2c9@read.place")]]);
		});
	});
});
