import assert from "node:assert/strict";
import { InboxAddressSchema } from "../inbox/inbox-address.schema";
import { UserIdSchema } from "../user";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";
import { groupSendersByDestination } from "./group-senders-by-destination";
import type { GmailSenderEntry } from "./gmail-sender.types";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const TECH = InboxAddressSchema.parse("tech-b3d4e5@read.place");
const ADDED_AT = "2026-08-27T00:00:00.000Z";

function sender(
	email: string,
	overrides: { addedToFilterAt?: string; mappedAddress?: string } = {},
): GmailSenderEntry {
	return {
		userId: USER,
		senderEmail: ForwardableSenderSchema.parse(email),
		addedToFilterAt: "addedToFilterAt" in overrides ? overrides.addedToFilterAt : ADDED_AT,
		firstSeenAt: undefined,
		lastSeenAt: undefined,
		seenCount: undefined,
		lastSubject: undefined,
		mappedAddress: overrides.mappedAddress
			? InboxAddressSchema.parse(overrides.mappedAddress)
			: undefined,
		mappedAt: undefined,
	};
}

describe("groupSendersByDestination", () => {
	it("groups senders with no mapped inbox under the gateway", () => {
		const groups = groupSendersByDestination({
			senders: [sender("dan@tldr.tech"), sender("crew@morningbrew.com")],
			gateway: GATEWAY,
		});
		assert.deepEqual(groups, [
			{ forwardTo: GATEWAY, senders: ["dan@tldr.tech", "crew@morningbrew.com"] },
		]);
	});

	it("gives a mapped sender its own inbox group alongside the gateway", () => {
		const groups = groupSendersByDestination({
			senders: [
				sender("dan@tldr.tech", { mappedAddress: TECH }),
				sender("crew@morningbrew.com"),
			],
			gateway: GATEWAY,
		});
		assert.deepEqual(groups, [
			{ forwardTo: TECH, senders: ["dan@tldr.tech"] },
			{ forwardTo: GATEWAY, senders: ["crew@morningbrew.com"] },
		]);
	});

	it("keeps several senders mapped to one inbox together", () => {
		const groups = groupSendersByDestination({
			senders: [
				sender("dan@tldr.tech", { mappedAddress: TECH }),
				sender("hn@hackernewsletter.com", { mappedAddress: TECH }),
			],
			gateway: GATEWAY,
		});
		assert.deepEqual(groups, [
			{ forwardTo: TECH, senders: ["dan@tldr.tech", "hn@hackernewsletter.com"] },
		]);
	});

	it("excludes a sender that is only seen and not yet on the filter", () => {
		const groups = groupSendersByDestination({
			senders: [sender("dan@tldr.tech", { addedToFilterAt: undefined })],
			gateway: GATEWAY,
		});
		assert.deepEqual(groups, []);
	});

	it("returns no groups when there are no senders", () => {
		assert.deepEqual(groupSendersByDestination({ senders: [], gateway: GATEWAY }), []);
	});
});
