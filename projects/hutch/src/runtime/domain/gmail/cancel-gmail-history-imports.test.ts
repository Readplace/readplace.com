import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJob,
	GmailHistoryImportJobIdSchema,
} from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initCancelGmailHistoryImports } from "./cancel-gmail-history-imports";

const READER = UserIdSchema.parse("reader-1");
const TLDR = ForwardableSenderSchema.parse("dan@tldrnewsletter.com");
const MORNING = ForwardableSenderSchema.parse("crew@morningbrew.com");
const CREATED = "2026-09-29T00:00:00.000Z";
const NOW = new Date("2026-09-30T00:00:00.000Z");

function awaitingJob(input: { jobId: string; senderEmail: typeof TLDR }): GmailHistoryImportJob {
	return {
		userId: READER,
		jobId: GmailHistoryImportJobIdSchema.parse(input.jobId),
		senderEmail: input.senderEmail,
		destinationAddress: InboxAddressSchema.parse("gmail-abc123@read.place"),
		connection: {
			gatewayAddress: InboxAddressSchema.parse("gmail-def456@read.place"),
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		},
		window: undefined,
		generation: "generation-1",
		page: 0,
		pageToken: undefined,
		listingCompletedAt: undefined,
		state: "awaiting-permission",
		counts: { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 },
		failureReason: undefined,
		cancelReason: undefined,
		createdAt: CREATED,
		updatedAt: CREATED,
		completedAt: undefined,
	};
}

describe("initCancelGmailHistoryImports", () => {
	it("cancels the sender's unfinished imports at the current time and leaves other senders running", async () => {
		const imports = initInMemoryGmailHistoryImport();
		const tldrJob = awaitingJob({ jobId: "0".repeat(31).concat("1"), senderEmail: TLDR });
		const morningJob = awaitingJob({ jobId: "0".repeat(31).concat("2"), senderEmail: MORNING });
		await imports.createJob(tldrJob);
		await imports.createJob(morningJob);
		const cancel = initCancelGmailHistoryImports({ imports, now: () => NOW });

		const cancelled = await cancel({ userId: READER, senderEmail: TLDR, reason: "mapping-removed" });

		assert.deepEqual(
			cancelled.map((job) => [job.jobId, job.state, job.cancelReason, job.updatedAt]),
			[[tldrJob.jobId, "cancelled", "mapping-removed", NOW.toISOString()]],
		);
		assert.equal((await imports.findJob({ userId: READER, jobId: morningJob.jobId }))?.state, "awaiting-permission");
	});
});
