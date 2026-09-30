import assert from "node:assert/strict";
import { InboxAddressSchema } from "../inbox/inbox-address.schema";
import { UserIdSchema } from "../user";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";
import { GmailAccountEmailSchema } from "./gmail-account-email.schema";
import { GmailHistoryImportJobIdSchema, type GmailHistoryImportCounts } from "./gmail-history-import.schema";
import { summarizeGmailHistoryImport } from "./gmail-history-import-summary";
import type { GmailHistoryImportJob } from "./gmail-history-import.types";

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
		userId: UserIdSchema.parse("user-1"),
		jobId: GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef"),
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

describe("summarizeGmailHistoryImport", () => {
	it("asks for permission while the import waits for Gmail read access", () => {
		assert.deepEqual(summarizeGmailHistoryImport(importJob({ state: "awaiting-permission" })), {
			status: "awaiting-permission",
		});
	});

	it("reports a queued import before its first page runs", () => {
		assert.deepEqual(summarizeGmailHistoryImport(importJob({ state: "queued" })), { status: "queued" });
	});

	it("reports progress counts while running", () => {
		const counts = { ...NO_COUNTS, listed: 10, imported: 4 };

		assert.deepEqual(summarizeGmailHistoryImport(importJob({ state: "running", counts })), {
			status: "running",
			counts,
		});
	});

	it("tells the reader there was nothing unread when a complete import listed no messages", () => {
		assert.deepEqual(summarizeGmailHistoryImport(importJob({ state: "complete", counts: NO_COUNTS })), {
			status: "no-unread",
		});
	});

	it("reports a clean completion when no message failed", () => {
		const counts = { ...NO_COUNTS, listed: 3, imported: 2, alreadyImported: 1 };

		assert.deepEqual(summarizeGmailHistoryImport(importJob({ state: "complete", counts })), {
			status: "complete",
			counts,
		});
	});

	it("reports a partial failure when a complete import has failed messages", () => {
		const counts = { ...NO_COUNTS, listed: 3, imported: 2, failed: 1 };

		assert.deepEqual(summarizeGmailHistoryImport(importJob({ state: "complete", counts })), {
			status: "partial-failure",
			counts,
		});
	});

	it("carries the failure reason of a failed import", () => {
		const counts = { ...NO_COUNTS, listed: 2, imported: 1 };

		assert.deepEqual(
			summarizeGmailHistoryImport(importJob({ state: "failed", failureReason: "permission-revoked", counts })),
			{ status: "failed", reason: "permission-revoked", counts },
		);
	});

	it("carries the cancel reason of a cancelled import", () => {
		assert.deepEqual(
			summarizeGmailHistoryImport(importJob({ state: "cancelled", cancelReason: "mapping-removed" })),
			{ status: "cancelled", reason: "mapping-removed", counts: NO_COUNTS },
		);
	});

	it("refuses a failed import that lost its failure reason", () => {
		assert.throws(() => summarizeGmailHistoryImport(importJob({ state: "failed" })), /failure reason/);
	});

	it("refuses a cancelled import that lost its cancel reason", () => {
		assert.throws(() => summarizeGmailHistoryImport(importJob({ state: "cancelled" })), /cancel reason/);
	});
});
