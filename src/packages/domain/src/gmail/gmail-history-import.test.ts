import assert from "node:assert/strict";
import { InboxAddressSchema } from "../inbox/inbox-address.schema";
import { UserIdSchema } from "../user";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";
import { GmailAccountEmailSchema } from "./gmail-account-email.schema";
import { type GmailHistoryImportCounts, GmailHistoryImportJobIdSchema, GmailMessageIdSchema } from "./gmail-history-import.schema";
import {
	canRestartGmailHistoryImport,
	gmailHistoryImportRawKey,
	planFetchedRecording,
	restartedCounts,
	settledCount,
} from "./gmail-history-import";
import type { GmailHistoryImportJob, GmailHistoryImportMessage } from "./gmail-history-import.types";

const USER = UserIdSchema.parse("user-1");
const JOB_ID = GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef");
const MESSAGE_ID = GmailMessageIdSchema.parse("18c2f0a1b2c3d4e5");
const NO_COUNTS: GmailHistoryImportCounts = {
	listed: 0,
	imported: 0,
	alreadyImported: 0,
	skippedNoMessageId: 0,
	skippedSenderMismatch: 0,
	failed: 0,
	cancelled: 0,
};

function importJob(overrides: Partial<GmailHistoryImportJob>): GmailHistoryImportJob {
	return {
		userId: USER,
		jobId: JOB_ID,
		senderEmail: ForwardableSenderSchema.parse("dan@tldr.tech"),
		destinationAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place"),
		connection: {
			gatewayAddress: InboxAddressSchema.parse("gmail-x1y2z3@read.place"),
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		},
		window: undefined,
		generation: "gen-1",
		page: 0,
		pageToken: undefined,
		listingCompletedAt: undefined,
		state: "queued",
		counts: NO_COUNTS,
		failureReason: undefined,
		cancelReason: undefined,
		createdAt: "2026-09-30T00:00:00.000Z",
		updatedAt: "2026-09-30T00:00:00.000Z",
		completedAt: undefined,
		...overrides,
	};
}

function recorded(overrides: Pick<GmailHistoryImportMessage, "generation" | "status">): GmailHistoryImportMessage {
	return {
		userId: USER,
		jobId: JOB_ID,
		gmailMessageId: MESSAGE_ID,
		rawS3Key: "gmail-import/user-1/0123456789abcdef0123456789abcdef/18c2f0a1b2c3d4e5.eml",
		recordedAt: "2026-09-30T00:00:00.000Z",
		...overrides,
	};
}

describe("gmailHistoryImportRawKey", () => {
	it("places each imported message under the import prefix, scoped by user and job", () => {
		const key = gmailHistoryImportRawKey({
			userId: USER,
			jobId: JOB_ID,
			gmailMessageId: MESSAGE_ID,
		});

		assert.equal(key, "gmail-import/user-1/0123456789abcdef0123456789abcdef/18c2f0a1b2c3d4e5.eml");
	});
});

describe("settledCount", () => {
	it("sums every message outcome and leaves out the listed total", () => {
		const settled = settledCount({
			listed: 100,
			imported: 1,
			alreadyImported: 2,
			skippedNoMessageId: 3,
			skippedSenderMismatch: 4,
			failed: 5,
			cancelled: 6,
		});

		assert.equal(settled, 21);
	});
});

describe("planFetchedRecording", () => {
	it("counts a message the import has never recorded", () => {
		assert.equal(planFetchedRecording({ existing: undefined, generation: "gen-1" }), "count-new");
	});

	it("refreshes a message this run already counted but has not settled, so a replayed page republishes it", () => {
		assert.equal(planFetchedRecording({ existing: recorded({ generation: "gen-1", status: "fetched" }), generation: "gen-1" }), "refresh");
	});

	it("leaves alone a message this run already settled, whatever its outcome", () => {
		for (const status of ["imported", "failed", "cancelled"] as const) {
			assert.equal(planFetchedRecording({ existing: recorded({ generation: "gen-1", status }), generation: "gen-1" }), "already-settled");
		}
	});

	it("counts again, in a retry, a message an earlier run left unsettled, failed or cancelled", () => {
		for (const status of ["fetched", "failed", "cancelled"] as const) {
			assert.equal(planFetchedRecording({ existing: recorded({ generation: "gen-1", status }), generation: "gen-2" }), "count-new");
		}
	});

	it("keeps, in a retry, what an earlier run imported or skipped", () => {
		for (const status of ["imported", "already-imported", "skipped-no-message-id", "skipped-sender-mismatch"] as const) {
			assert.equal(planFetchedRecording({ existing: recorded({ generation: "gen-1", status }), generation: "gen-2" }), "already-settled");
		}
	});
});

describe("canRestartGmailHistoryImport", () => {
	it("starts an import still waiting for read permission", () => {
		assert.equal(canRestartGmailHistoryImport(importJob({ state: "awaiting-permission" })), true);
	});

	it("retries a failed import", () => {
		assert.equal(canRestartGmailHistoryImport(importJob({ state: "failed", failureReason: "gmail-rejected" })), true);
	});

	it("retries a complete import only when some messages failed", () => {
		assert.equal(canRestartGmailHistoryImport(importJob({ state: "complete", counts: { ...NO_COUNTS, listed: 2, imported: 1, failed: 1 } })), true);
		assert.equal(canRestartGmailHistoryImport(importJob({ state: "complete", counts: { ...NO_COUNTS, listed: 2, imported: 2 } })), false);
	});

	it("never restarts an import that is in flight or was cancelled", () => {
		for (const state of ["queued", "running", "cancelled"] as const) {
			assert.equal(canRestartGmailHistoryImport(importJob({ state })), false);
		}
	});
});

describe("restartedCounts", () => {
	it("keeps what was imported or skipped and drops failed and cancelled messages so the retry lists them again", () => {
		const counts = restartedCounts({
			listed: 20,
			imported: 5,
			alreadyImported: 4,
			skippedNoMessageId: 3,
			skippedSenderMismatch: 2,
			failed: 1,
			cancelled: 1,
		});

		assert.deepEqual(counts, {
			listed: 14,
			imported: 5,
			alreadyImported: 4,
			skippedNoMessageId: 3,
			skippedSenderMismatch: 2,
			failed: 0,
			cancelled: 0,
		});
	});
});
