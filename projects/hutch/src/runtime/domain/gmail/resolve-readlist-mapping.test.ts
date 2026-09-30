import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJob,
	GmailHistoryImportJobIdSchema,
} from "@packages/domain/gmail";
import { AliasNameSchema } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initMapSenderToReadlist } from "./resolve-readlist-mapping";

const READER = UserIdSchema.parse("reader-1");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const TECH = ReadlistSlugSchema.parse("tech");
const NOW = new Date("2026-09-30T00:00:00.000Z");

function setup() {
	const now = () => NOW;
	const senders = initInMemoryGmailSender({ now });
	const addresses = initInMemoryInboxAddress({ now });
	const imports = initInMemoryGmailHistoryImport();
	const mapSenderToReadlist = initMapSenderToReadlist({
		senders,
		getOrCreateReadlistAddress: ({ userId, readlist }) =>
			addresses.getOrCreateReadlistAddress({ userId, domain: "read.place", readlist }),
		cancelGmailHistoryImports: (input) => imports.cancelJobs({ ...input, now: NOW }),
	});
	return { senders, addresses, imports, mapSenderToReadlist };
}

function queuedJob(destinationAddress: GmailHistoryImportJob["destinationAddress"]): GmailHistoryImportJob {
	return {
		userId: READER,
		jobId: GmailHistoryImportJobIdSchema.parse("00000000000000000000000000000001"),
		senderEmail: TLDR,
		destinationAddress,
		connection: { gatewayAddress: destinationAddress, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") },
		window: undefined,
		generation: "generation-1",
		page: 0,
		pageToken: undefined,
		listingCompletedAt: undefined,
		state: "queued",
		counts: { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 },
		failureReason: undefined,
		cancelReason: undefined,
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
		completedAt: undefined,
	};
}

describe("initMapSenderToReadlist", () => {
	it("routes two senders for one readlist through the same hidden readlist address", async () => {
		const { senders, addresses, mapSenderToReadlist } = setup();

		const first = await mapSenderToReadlist({ userId: READER, sender: TLDR, readlist: TECH });
		const second = await mapSenderToReadlist({ userId: READER, sender: BREW, readlist: TECH });

		expect(second.destination).toBe(first.destination);
		const tldr = await senders.findSender({ userId: READER, senderEmail: TLDR });
		assert(tldr);
		expect([tldr.mappedAddress, tldr.addedToFilterAt]).toEqual([first.destination, NOW.toISOString()]);
		const address = await addresses.findByAddress(first.destination);
		expect([address?.purpose, address?.readlist]).toEqual(["gmail-readlist", TECH]);
	});

	it("cancels unfinished imports for a sender whose readlist changes and keeps a shared named inbox as it was", async () => {
		const { senders, addresses, imports, mapSenderToReadlist } = setup();
		const shared = await addresses.createAddress({
			userId: READER,
			domain: "read.place",
			name: AliasNameSchema.parse("news"),
			purpose: "gmail-mapped",
		});
		await addresses.setAddressReadlist({ userId: READER, address: shared.address, readlist: TECH });
		for (const sender of [TLDR, BREW]) {
			await senders.mapSenderToAddress({ userId: READER, senderEmail: sender, mappedAddress: shared.address });
			await senders.addSenderToFilter({ userId: READER, senderEmail: sender });
		}
		await imports.createJob(queuedJob(shared.address));

		await mapSenderToReadlist({ userId: READER, sender: TLDR, readlist: DEFAULT_READLIST_SLUG });

		expect((await senders.findSender({ userId: READER, senderEmail: BREW }))?.mappedAddress).toBe(shared.address);
		expect((await addresses.findByAddress(shared.address))?.readlist).toBe(TECH);
		const [job] = await imports.listJobsByUserId(READER);
		expect([job?.state, job?.cancelReason]).toEqual(["cancelled", "destination-changed"]);
	});

	it("leaves imports running when a sender is saved to the readlist it already uses", async () => {
		const { imports, mapSenderToReadlist } = setup();
		const first = await mapSenderToReadlist({ userId: READER, sender: TLDR, readlist: TECH });
		await imports.createJob(queuedJob(first.destination));

		const again = await mapSenderToReadlist({ userId: READER, sender: TLDR, readlist: TECH });

		expect(again).toEqual({ destination: first.destination });
		expect((await imports.listJobsByUserId(READER)).map((job) => job.state)).toEqual(["queued"]);
	});
});
