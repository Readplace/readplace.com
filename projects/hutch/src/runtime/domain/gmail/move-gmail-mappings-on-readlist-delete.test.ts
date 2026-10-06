import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJob,
	GmailHistoryImportJobIdSchema,
} from "@packages/domain/gmail";
import { InboxAddressSchema, type InboxAddress } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { DeleteReadlistDefinition } from "@packages/provider-contracts/article-store";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initCancelGmailHistoryImports } from "./cancel-gmail-history-imports";
import { initMoveGmailMappingsOnReadlistDelete } from "./move-gmail-mappings-on-readlist-delete";

const READER = UserIdSchema.parse("reader-1");
const WORK = ReadlistSlugSchema.parse("work");
const TRAVEL = ReadlistSlugSchema.parse("travel");
const TLDR = ForwardableSenderSchema.parse("dan@tldrnewsletter.com");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const PRAGMATIC = ForwardableSenderSchema.parse("pragmaticengineer@substack.com");
const NOW = new Date("2026-09-30T00:00:00.000Z");
const NO_COUNTS = { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 };

function queuedImport(input: { jobId: string; senderEmail: typeof TLDR; destinationAddress: InboxAddress }): GmailHistoryImportJob {
	return {
		userId: READER,
		jobId: GmailHistoryImportJobIdSchema.parse(input.jobId),
		senderEmail: input.senderEmail,
		destinationAddresses: [input.destinationAddress],
		connection: {
			gatewayAddress: InboxAddressSchema.parse("gmail-def456@read.place"),
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		},
		window: { start: "2026-08-31T00:00:00.000Z", end: NOW.toISOString() },
		generation: "generation-1",
		page: 0,
		pageToken: undefined,
		listingCompletedAt: undefined,
		state: "queued",
		counts: NO_COUNTS,
		failureReason: undefined,
		cancelReason: undefined,
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
		completedAt: undefined,
	};
}

function harness() {
	const addresses = initInMemoryInboxAddress({ now: () => NOW });
	const senders = initInMemoryGmailSender({ now: () => NOW });
	const imports = initInMemoryGmailHistoryImport();
	const deleted: Parameters<DeleteReadlistDefinition>[0][] = [];
	const mappingsWhenRetired: ([InboxAddress, ...InboxAddress[]] | undefined)[][] = [];
	const rewrites: { userId: typeof READER; reason: "readlist-deleted" }[] = [];
	const getOrCreateReadlistAddress = (input: { userId: typeof READER; readlist: typeof WORK }) =>
		addresses.getOrCreateReadlistAddress({ ...input, domain: "read.place" });
	const deleteReadlist = initMoveGmailMappingsOnReadlistDelete({
		deleteReadlistDefinition: async (params) => {
			deleted.push(params);
			return { deleted: true };
		},
		senders,
		findReadlistAddress: addresses.findReadlistAddress,
		getOrCreateReadlistAddress,
		retireReadlistAddress: async (input) => {
			mappingsWhenRetired.push((await senders.listSendersByUserId(READER)).map((sender) => sender.mappedAddresses));
			return addresses.retireReadlistAddress(input);
		},
		cancelGmailHistoryImports: initCancelGmailHistoryImports({ imports, now: () => NOW }),
		publishRewriteGmailFilter: async (input) => {
			rewrites.push(input);
		},
	});
	const mapSender = async (senderEmail: typeof TLDR, mappedAddress: InboxAddress) => {
		await senders.addSenderToFilter({ userId: READER, senderEmail });
		await senders.mapSenderToAddress({ userId: READER, senderEmail, mappedAddresses: [mappedAddress], deliveryMode: "links" });
	};
	return { addresses, senders, imports, deleted, mappingsWhenRetired, rewrites, getOrCreateReadlistAddress, deleteReadlist, mapSender };
}

describe("initMoveGmailMappingsOnReadlistDelete", () => {
	it("moves the deleted readlist's newsletters to All before retiring its address, cancels their unfinished imports and asks Gmail to record the move", async () => {
		const h = harness();
		const work = await h.getOrCreateReadlistAddress({ userId: READER, readlist: WORK });
		const travel = await h.getOrCreateReadlistAddress({ userId: READER, readlist: TRAVEL });
		await h.mapSender(TLDR, work.address);
		await h.mapSender(BREW, work.address);
		await h.mapSender(PRAGMATIC, travel.address);
		await h.imports.createJob(queuedImport({ jobId: "a".repeat(32), senderEmail: TLDR, destinationAddress: work.address }));
		await h.imports.createJob(queuedImport({ jobId: "b".repeat(32), senderEmail: PRAGMATIC, destinationAddress: travel.address }));

		const answer = await h.deleteReadlist({ userId: READER, slug: WORK });

		const all = await h.addresses.findReadlistAddress({ userId: READER, readlist: DEFAULT_READLIST_SLUG });
		assert(all, "the All readlist address was allocated");
		assert.deepEqual(answer, { deleted: true });
		assert.deepEqual(h.deleted, [{ userId: READER, slug: WORK }]);
		assert.deepEqual(h.mappingsWhenRetired, [[[all.address], [all.address], [travel.address]]]);
		assert.equal(await h.addresses.findReadlistAddress({ userId: READER, readlist: WORK }), undefined);
		assert.equal((await h.addresses.findByAddress(work.address))?.disabledAt, NOW.toISOString());
		const jobs = await h.imports.listJobsByUserId(READER);
		assert.deepEqual(jobs.map((job) => [job.senderEmail, job.state, job.cancelReason]), [
			[TLDR, "cancelled", "destination-changed"],
			[PRAGMATIC, "queued", undefined],
		]);
		assert.deepEqual(h.rewrites, [{ userId: READER, reason: "readlist-deleted" }]);
	});

	it("removes a secondary destination while preserving the remaining list and delivery mode, and cancels that sender's import", async () => {
		const h = harness();
		const work = await h.getOrCreateReadlistAddress({ userId: READER, readlist: WORK });
		const travel = await h.getOrCreateReadlistAddress({ userId: READER, readlist: TRAVEL });
		await h.mapSender(TLDR, travel.address);
		await h.senders.mapSenderToAddress({ userId: READER, senderEmail: TLDR, mappedAddresses: [travel.address, work.address], deliveryMode: "issue" });
		await h.imports.createJob({ ...queuedImport({ jobId: "a".repeat(32), senderEmail: TLDR, destinationAddress: travel.address }), destinationAddresses: [travel.address, work.address] });

		await h.deleteReadlist({ userId: READER, slug: WORK });

		const moved = await h.senders.findSender({ userId: READER, senderEmail: TLDR });
		assert.deepEqual([moved?.mappedAddresses, moved?.deliveryMode], [[travel.address], "issue"]);
		assert.deepEqual(h.mappingsWhenRetired, [[[travel.address]]]);
		assert.deepEqual((await h.imports.listJobsByUserId(READER)).map((job) => [job.state, job.cancelReason]), [["cancelled", "destination-changed"]]);
		assert.equal(await h.addresses.findReadlistAddress({ userId: READER, readlist: DEFAULT_READLIST_SLUG }), undefined);
	});

	it("retires an address no newsletter goes to without allocating All", async () => {
		const h = harness();
		await h.getOrCreateReadlistAddress({ userId: READER, readlist: WORK });
		await h.senders.addSenderToFilter({ userId: READER, senderEmail: TLDR });

		await h.deleteReadlist({ userId: READER, slug: WORK });

		assert.equal(await h.addresses.findReadlistAddress({ userId: READER, readlist: DEFAULT_READLIST_SLUG }), undefined);
		assert.equal(await h.addresses.findReadlistAddress({ userId: READER, readlist: WORK }), undefined);
		assert.deepEqual(h.deleted, [{ userId: READER, slug: WORK }]);
		assert.deepEqual(h.rewrites, []);
		assert.equal((await h.senders.findSender({ userId: READER, senderEmail: TLDR }))?.mappedAddresses, undefined);
	});

	it("only deletes the readlist when Gmail never sent newsletters to it", async () => {
		const h = harness();

		const answer = await h.deleteReadlist({ userId: READER, slug: WORK });

		assert.deepEqual(answer, { deleted: true });
		assert.deepEqual(h.deleted, [{ userId: READER, slug: WORK }]);
		assert.deepEqual(h.mappingsWhenRetired, []);
	});
});
