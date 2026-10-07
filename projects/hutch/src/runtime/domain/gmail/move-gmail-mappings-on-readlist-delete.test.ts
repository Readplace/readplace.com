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
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailMapping } from "@packages/test-fixtures/providers/gmail-mapping";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initCancelGmailHistoryImports } from "./cancel-gmail-history-imports";
import { initMoveGmailMappingsOnReadlistDelete } from "./move-gmail-mappings-on-readlist-delete";

const READER = UserIdSchema.parse("reader-1");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const FORMER_ACCOUNT = GmailAccountEmailSchema.parse("reader@work.example");
const GATEWAY = InboxAddressSchema.parse("gmail-def456@read.place");
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
			gatewayAddress: GATEWAY,
			accountEmail: ACCOUNT,
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
	const mappings = initInMemoryGmailMapping({ now: () => NOW });
	const connections = initInMemoryGmailConnection({ now: () => NOW });
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
		mappings,
		connections,
		findReadlistAddress: addresses.findReadlistAddress,
		getOrCreateReadlistAddress,
		retireReadlistAddress: async (input) => {
			mappingsWhenRetired.push((await mappings.listMappingsByUserId(READER)).map((mapping) => mapping.mappedAddresses));
			return addresses.retireReadlistAddress(input);
		},
		cancelGmailHistoryImports: initCancelGmailHistoryImports({ imports, now: () => NOW }),
		publishRewriteGmailFilter: async (input) => {
			rewrites.push(input);
		},
	});
	const connect = async () => {
		await connections.createConnection({ userId: READER, gatewayAddress: GATEWAY });
		await connections.recordAccountEmail({ userId: READER, accountEmail: ACCOUNT });
	};
	const mapSender = async (senderEmail: typeof TLDR, mappedAddress: InboxAddress) => {
		await mappings.addSenderToFilter({ userId: READER, accountEmail: ACCOUNT, senderEmail });
		await mappings.mapSenderToAddress({ userId: READER, accountEmail: ACCOUNT, senderEmail, mappedAddresses: [mappedAddress], deliveryMode: "links" });
	};
	return { addresses, mappings, connect, imports, deleted, mappingsWhenRetired, rewrites, getOrCreateReadlistAddress, deleteReadlist, mapSender };
}

describe("initMoveGmailMappingsOnReadlistDelete", () => {
	it("moves the deleted readlist's newsletters to All before retiring its address, cancels their unfinished imports and asks Gmail to record the move", async () => {
		const h = harness();
		await h.connect();
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
		await h.connect();
		const work = await h.getOrCreateReadlistAddress({ userId: READER, readlist: WORK });
		const travel = await h.getOrCreateReadlistAddress({ userId: READER, readlist: TRAVEL });
		await h.mapSender(TLDR, travel.address);
		await h.mappings.mapSenderToAddress({ userId: READER, accountEmail: ACCOUNT, senderEmail: TLDR, mappedAddresses: [travel.address, work.address], deliveryMode: "issue" });
		await h.imports.createJob({ ...queuedImport({ jobId: "a".repeat(32), senderEmail: TLDR, destinationAddress: travel.address }), destinationAddresses: [travel.address, work.address] });

		await h.deleteReadlist({ userId: READER, slug: WORK });

		const moved = await h.mappings.findMapping({ userId: READER, accountEmail: ACCOUNT, senderEmail: TLDR });
		assert.deepEqual([moved?.mappedAddresses, moved?.deliveryMode], [[travel.address], "issue"]);
		assert.deepEqual(h.mappingsWhenRetired, [[[travel.address]]]);
		assert.deepEqual((await h.imports.listJobsByUserId(READER)).map((job) => [job.state, job.cancelReason]), [["cancelled", "destination-changed"]]);
		assert.equal(await h.addresses.findReadlistAddress({ userId: READER, readlist: DEFAULT_READLIST_SLUG }), undefined);
	});

	it("moves a newsletter kept for a Gmail account that is no longer connected, leaving the connected account's imports and Gmail filter alone", async () => {
		const h = harness();
		await h.connect();
		const work = await h.getOrCreateReadlistAddress({ userId: READER, readlist: WORK });
		await h.mappings.addSenderToFilter({ userId: READER, accountEmail: FORMER_ACCOUNT, senderEmail: TLDR });
		await h.mappings.mapSenderToAddress({ userId: READER, accountEmail: FORMER_ACCOUNT, senderEmail: TLDR, mappedAddresses: [work.address], deliveryMode: "links" });
		await h.imports.createJob(queuedImport({ jobId: "a".repeat(32), senderEmail: TLDR, destinationAddress: work.address }));

		await h.deleteReadlist({ userId: READER, slug: WORK });

		const all = await h.addresses.findReadlistAddress({ userId: READER, readlist: DEFAULT_READLIST_SLUG });
		assert(all, "the All readlist address was allocated");
		assert.deepEqual((await h.mappings.findMapping({ userId: READER, accountEmail: FORMER_ACCOUNT, senderEmail: TLDR }))?.mappedAddresses, [all.address]);
		assert.deepEqual((await h.imports.listJobsByUserId(READER)).map((job) => job.state), ["queued"]);
		assert.deepEqual(h.rewrites, []);
	});

	it("moves a kept newsletter to All while Gmail is disconnected", async () => {
		const h = harness();
		const work = await h.getOrCreateReadlistAddress({ userId: READER, readlist: WORK });
		await h.mapSender(TLDR, work.address);

		await h.deleteReadlist({ userId: READER, slug: WORK });

		const all = await h.addresses.findReadlistAddress({ userId: READER, readlist: DEFAULT_READLIST_SLUG });
		assert(all, "the All readlist address was allocated");
		assert.deepEqual((await h.mappings.findMapping({ userId: READER, accountEmail: ACCOUNT, senderEmail: TLDR }))?.mappedAddresses, [all.address]);
		assert.deepEqual(h.rewrites, []);
	});

	it("retires an address no newsletter goes to without allocating All", async () => {
		const h = harness();
		await h.getOrCreateReadlistAddress({ userId: READER, readlist: WORK });
		await h.mappings.addSenderToFilter({ userId: READER, accountEmail: ACCOUNT, senderEmail: TLDR });

		await h.deleteReadlist({ userId: READER, slug: WORK });

		assert.equal(await h.addresses.findReadlistAddress({ userId: READER, readlist: DEFAULT_READLIST_SLUG }), undefined);
		assert.equal(await h.addresses.findReadlistAddress({ userId: READER, readlist: WORK }), undefined);
		assert.deepEqual(h.deleted, [{ userId: READER, slug: WORK }]);
		assert.deepEqual(h.rewrites, []);
		assert.equal((await h.mappings.findMapping({ userId: READER, accountEmail: ACCOUNT, senderEmail: TLDR }))?.mappedAddresses, undefined);
	});

	it("only deletes the readlist when Gmail never sent newsletters to it", async () => {
		const h = harness();

		const answer = await h.deleteReadlist({ userId: READER, slug: WORK });

		assert.deepEqual(answer, { deleted: true });
		assert.deepEqual(h.deleted, [{ userId: READER, slug: WORK }]);
		assert.deepEqual(h.mappingsWhenRetired, []);
	});
});
