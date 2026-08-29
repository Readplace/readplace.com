import assert from "node:assert/strict";
import type { GmailConnection, GmailSenderEntry } from "@packages/domain/gmail";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { toGmailPageViewModel } from "./gmail.viewmodel";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const ALIAS = InboxAddressSchema.parse("tldr-b8c3d0@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");

function connection(overrides: Partial<GmailConnection> = {}): GmailConnection {
	return {
		userId: USER,
		gatewayAddress: GATEWAY,
		connectedAt: "2026-08-27T00:00:00.000Z",
		forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
		filterId: undefined,
		filterQuery: undefined,
		filterSenderCount: undefined,
		filterUpdatedAt: undefined,
		lastFilterError: undefined,
		revokedAt: undefined,
		revokedReason: undefined,
		...overrides,
	};
}

function sender(overrides: Partial<GmailSenderEntry> = {}): GmailSenderEntry {
	return {
		userId: USER,
		senderEmail: TLDR,
		addedToFilterAt: "2026-08-27T00:06:00.000Z",
		firstSeenAt: undefined,
		lastSeenAt: undefined,
		seenCount: undefined,
		lastSubject: undefined,
		mappedAddress: undefined,
		mappedAt: undefined,
		...overrides,
	};
}

describe("toGmailPageViewModel", () => {
	it("shows step 2 and hides the sender list until Google confirms the address", () => {
		const vm = toGmailPageViewModel({
			connection: connection({ forwardingConfirmedAt: undefined }),
			senders: [],
		});

		assert.equal(vm.state, "awaiting-confirmation");
		assert.equal(vm.statusLabel, "Step 2 of 2");
		assert.equal(vm.stepVisibility, "visible");
		assert.equal(vm.sendersVisibility, "hidden");
		assert.equal(vm.reconnectVisibility, "hidden");
		assert.equal(vm.gatewayAddress, GATEWAY);
		assert.equal(vm.integrationsPath, "/integrations");
	});

	it("shows the sender list once the address is confirmed", () => {
		const vm = toGmailPageViewModel({ connection: connection(), senders: [sender()] });

		assert.equal(vm.state, "ready-to-filter");
		assert.equal(vm.stepVisibility, "hidden");
		assert.equal(vm.sendersVisibility, "visible");
		assert.deepEqual(
			vm.senders.map((row) => row.email),
			[TLDR],
		);
		assert.equal(vm.hasSenders, true);
	});

	it("offers only a reconnect once Google ends the grant", () => {
		const vm = toGmailPageViewModel({
			connection: connection({ revokedAt: "2026-08-27T01:00:00.000Z", revokedReason: "invalid-grant" }),
			senders: [sender()],
		});

		assert.equal(vm.state, "revoked");
		assert.equal(vm.reconnectVisibility, "visible");
		assert.equal(vm.sendersVisibility, "hidden");
		assert.equal(vm.stepVisibility, "hidden");
	});

	it("surfaces the alias a sender's mail lands in", () => {
		const vm = toGmailPageViewModel({
			connection: connection(),
			senders: [sender({ mappedAddress: ALIAS, lastSubject: "TLDR 2026-08-27" })],
		});

		assert.equal(vm.senders[0].mappedAddress, ALIAS);
		assert.equal(vm.senders[0].mappedVisibility, "visible");
		assert.equal(vm.senders[0].detail, "Last: TLDR 2026-08-27");
	});

	it("hides the alias line for a sender that has none yet", () => {
		const vm = toGmailPageViewModel({ connection: connection(), senders: [sender()] });

		assert.equal(vm.senders[0].mappedAddress, "");
		assert.equal(vm.senders[0].mappedVisibility, "hidden");
		assert.equal(vm.senders[0].detail, "No mail yet.");
	});

	it("lists a seen-but-unclaimed sender under unsorted", () => {
		const vm = toGmailPageViewModel({
			connection: connection(),
			senders: [
				sender({ addedToFilterAt: undefined, seenCount: 2, lastSubject: "Morning Brew" }),
			],
		});

		assert.equal(vm.hasSenders, false);
		assert.equal(vm.hasUnsorted, true);
		assert.equal(vm.unsortedVisibility, "visible");
		assert.deepEqual(
			vm.unsorted.map((row) => row.email),
			[TLDR],
		);
	});

	it("keeps a mapped sender out of unsorted even before it reaches the filter", () => {
		const vm = toGmailPageViewModel({
			connection: connection(),
			senders: [sender({ addedToFilterAt: undefined, mappedAddress: ALIAS })],
		});

		assert.equal(vm.hasUnsorted, false);
		assert.equal(vm.unsortedVisibility, "hidden");
	});

	it("shows the reason the last filter write failed", () => {
		const vm = toGmailPageViewModel({
			connection: connection({
				lastFilterError: {
					code: "query-too-long",
					message: "40 senders produce a 2396-character query",
					at: "2026-08-27T02:00:00.000Z",
				},
			}),
			senders: [],
		});

		assert.equal(vm.state, "filter-failed");
		assert.equal(vm.alertVisibility, "visible");
		assert.deepEqual(vm.alerts, [
			{ key: "filter", message: "40 senders produce a 2396-character query" },
		]);
	});

	it("renders a known flash message and ignores one it does not know", () => {
		const known = toGmailPageViewModel({
			connection: connection(),
			senders: [],
			error: "sender_duplicate",
			notice: "sender_added",
		});
		const unknown = toGmailPageViewModel({
			connection: connection(),
			senders: [],
			error: "made_up",
			notice: "made_up",
		});

		assert.equal(known.alerts[0].key, "sender_duplicate");
		assert.equal(known.notices[0].key, "sender_added");
		assert.equal(known.noticeVisibility, "visible");
		assert.deepEqual(unknown.alerts, []);
		assert.deepEqual(unknown.notices, []);
		assert.equal(unknown.alertVisibility, "hidden");
		assert.equal(unknown.noticeVisibility, "hidden");
	});

	it("reports the filtering state once a filter is live", () => {
		const vm = toGmailPageViewModel({
			connection: connection({ filterId: "f-1", filterQuery: "from:(dan@tldr.tech)" }),
			senders: [sender()],
		});

		assert.equal(vm.state, "filtering");
		assert.equal(vm.statusLabel, "Forwarding");
		assert.equal(vm.stateModifier, "gmail__status--filtering");
	});
});
