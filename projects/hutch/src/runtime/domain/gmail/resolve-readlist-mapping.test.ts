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

function queuedJob(destinationAddress: GmailHistoryImportJob["destinationAddresses"][0]): GmailHistoryImportJob {
	return {
		userId: READER,
		jobId: GmailHistoryImportJobIdSchema.parse("00000000000000000000000000000001"),
		senderEmail: TLDR,
		destinationAddresses: [destinationAddress],
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

		const first = await mapSenderToReadlist({ userId: READER, sender: TLDR, readlists: [TECH] });
		const second = await mapSenderToReadlist({ userId: READER, sender: BREW, readlists: [TECH] });

		expect(second.destinations[0]).toBe(first.destinations[0]);
		const tldr = await senders.findSender({ userId: READER, senderEmail: TLDR });
		assert(tldr);
		expect([tldr.mappedAddresses, tldr.addedToFilterAt]).toEqual([[first.destinations[0]], NOW.toISOString()]);
		const address = await addresses.findByAddress(first.destinations[0]);
		expect([address?.purpose, address?.readlist]).toEqual(["gmail-readlist", TECH]);
	});

	it("always retains All implicitly and maps only distinct selected custom readlists", async () => {
		const { senders, addresses, mapSenderToReadlist } = setup();
		const travel = ReadlistSlugSchema.parse("travel");
		const allAddress = await addresses.getOrCreateReadlistAddress({ userId: READER, domain: "read.place", readlist: DEFAULT_READLIST_SLUG });

		const selected = await mapSenderToReadlist({ userId: READER, sender: TLDR, readlists: [DEFAULT_READLIST_SLUG, TECH, travel, TECH] });
		const destinations = await Promise.all(selected.destinations.map((address) => addresses.findByAddress(address)));

		expect(destinations.map((address) => address?.readlist)).toEqual([TECH, travel]);
		expect((await senders.findSender({ userId: READER, senderEmail: TLDR }))?.mappedAddresses).toEqual(selected.destinations);
		const all = await mapSenderToReadlist({ userId: READER, sender: BREW, readlists: [] });
		expect(all.destinations).toEqual([allAddress.address]);
		expect(await addresses.findByAddress(all.destinations[0])).toEqual(allAddress);
		expect([allAddress.purpose, allAddress.readlist]).toEqual(["gmail-readlist", undefined]);
		expect((await senders.findSender({ userId: READER, senderEmail: BREW }))?.mappedAddresses).toEqual([allAddress.address]);
	});

	it("treats reordering destinations as a no-op and cancels imports when a secondary destination changes", async () => {
		const { senders, imports, mapSenderToReadlist } = setup();
		const travel = ReadlistSlugSchema.parse("travel");
		const work = ReadlistSlugSchema.parse("work");
		const first = await mapSenderToReadlist({ userId: READER, sender: TLDR, readlists: [TECH, travel] });
		await imports.createJob({ ...queuedJob(first.destinations[0]), destinationAddresses: first.destinations });
		const before = await senders.findSender({ userId: READER, senderEmail: TLDR });

		await mapSenderToReadlist({ userId: READER, sender: TLDR, readlists: [travel, TECH] });

		expect(await senders.findSender({ userId: READER, senderEmail: TLDR })).toEqual(before);
		expect((await imports.listJobsByUserId(READER)).map((job) => job.state)).toEqual(["queued"]);
		await mapSenderToReadlist({ userId: READER, sender: TLDR, readlists: [TECH, work] });
		expect((await imports.listJobsByUserId(READER)).map((job) => [job.state, job.cancelReason])).toEqual([["cancelled", "destination-changed"]]);
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
			await senders.mapSenderToAddress({ userId: READER, senderEmail: sender, mappedAddresses: [shared.address] });
			await senders.addSenderToFilter({ userId: READER, senderEmail: sender });
		}
		await imports.createJob(queuedJob(shared.address));

		await mapSenderToReadlist({ userId: READER, sender: TLDR, readlists: [DEFAULT_READLIST_SLUG] });

		expect((await senders.findSender({ userId: READER, senderEmail: BREW }))?.mappedAddresses).toEqual([shared.address]);
		expect((await addresses.findByAddress(shared.address))?.readlist).toBe(TECH);
		const [job] = await imports.listJobsByUserId(READER);
		expect([job?.state, job?.cancelReason]).toEqual(["cancelled", "destination-changed"]);
	});

	it("leaves imports running when a sender is saved to the readlist it already uses", async () => {
		const { imports, mapSenderToReadlist } = setup();
		const first = await mapSenderToReadlist({ userId: READER, sender: TLDR, readlists: [TECH] });
		await imports.createJob(queuedJob(first.destinations[0]));

		const again = await mapSenderToReadlist({ userId: READER, sender: TLDR, readlists: [TECH] });

		expect(again).toEqual({ destinations: first.destinations });
		expect((await imports.listJobsByUserId(READER)).map((job) => job.state)).toEqual(["queued"]);
	});
});
