import assert from "node:assert/strict";
import type { GmailConnection, GmailSenderEntry } from "@packages/domain/gmail";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { GMAIL_CONFIRM_MAX_POLLS } from "./gmail.url";
import {
	GMAIL_GATEWAY_DISABLED_MESSAGE,
	toGmailPageViewModel,
	toGmailPollViewModel,
} from "./gmail.viewmodel";

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
			gatewayLive: true,
			connection: connection({ forwardingConfirmedAt: undefined }),
			senders: [],
		});

		assert.equal(vm.state, "awaiting-confirmation");
		assert.equal(vm.statusLabel, "Step 2 of 2");
		assert.equal(vm.showStep, true);
		assert.equal(vm.showSenders, false);
		assert.equal(vm.showReconnect, false);
		assert.equal(vm.gatewayAddress, GATEWAY);
		assert.equal(vm.integrationsPath, "/integrations");
	});

	it("shows the sender list once the address is confirmed", () => {
		const vm = toGmailPageViewModel({ connection: connection(), senders: [sender()], gatewayLive: true });

		assert.equal(vm.state, "ready-to-filter");
		assert.equal(vm.showStep, false);
		assert.equal(vm.showSenders, true);
		assert.deepEqual(
			vm.senders.map((row) => row.email),
			[TLDR],
		);
		assert.equal(vm.hasSenders, true);
	});

	it("offers only a reconnect once Google ends the grant", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: true,
			connection: connection({ revokedAt: "2026-08-27T01:00:00.000Z", revokedReason: "invalid-grant" }),
			senders: [sender()],
		});

		assert.equal(vm.state, "revoked");
		assert.equal(vm.showReconnect, true);
		assert.equal(vm.showSenders, false);
		assert.equal(vm.showStep, false);
	});

	it("surfaces the alias a sender's mail lands in", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: true,
			connection: connection(),
			senders: [sender({ mappedAddress: ALIAS, lastSubject: "TLDR 2026-08-27" })],
		});

		assert.equal(vm.senders[0].mappedAddress, ALIAS);
		assert.equal(vm.senders[0].detail, "Last: TLDR 2026-08-27");
	});

	it("leaves the alias undefined for a sender that has none yet", () => {
		const vm = toGmailPageViewModel({ connection: connection(), senders: [sender()], gatewayLive: true });

		assert.equal(vm.senders[0].mappedAddress, undefined);
		assert.equal(vm.senders[0].detail, "No mail yet.");
	});

	it("lists a seen-but-unclaimed sender under unsorted", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: true,
			connection: connection(),
			senders: [
				sender({ addedToFilterAt: undefined, seenCount: 2, lastSubject: "Morning Brew" }),
			],
		});

		assert.equal(vm.hasSenders, false);
		assert.equal(vm.hasUnsorted, true);
		assert.deepEqual(
			vm.unsorted.map((row) => row.email),
			[TLDR],
		);
	});

	it("keeps a mapped sender out of unsorted even before it reaches the filter", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: true,
			connection: connection(),
			senders: [sender({ addedToFilterAt: undefined, mappedAddress: ALIAS })],
		});

		assert.equal(vm.hasUnsorted, false);
	});

	it("shows the reason the last filter write failed", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: true,
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
		assert.deepEqual(vm.alerts, [
			{ key: "filter", message: "40 senders produce a 2396-character query" },
		]);
	});

	it("renders a known flash message and ignores one it does not know", () => {
		const known = toGmailPageViewModel({
			gatewayLive: true,
			connection: connection(),
			senders: [],
			error: "sender_duplicate",
			notice: "sender_added",
		});
		const unknown = toGmailPageViewModel({
			gatewayLive: true,
			connection: connection(),
			senders: [],
			error: "made_up",
			notice: "made_up",
		});

		assert.equal(known.alerts[0].key, "sender_duplicate");
		assert.equal(known.notices[0].key, "sender_added");
		assert.deepEqual(unknown.alerts, []);
		assert.deepEqual(unknown.notices, []);
	});

	it("greets a confirmed connection with the forwarding-confirmed notice", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: true,
			connection: connection(),
			senders: [],
			notice: "confirmed",
		});

		assert.deepEqual(
			vm.notices.map((banner) => banner.message),
			["Forwarding confirmed."],
		);
	});

	it("hides step 2 and says how to recover when the gateway address is switched off", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: false,
			connection: connection({ forwardingConfirmedAt: undefined }),
			senders: [],
		});

		assert.equal(vm.showStep, false);
		assert.deepEqual(
			vm.alerts.map((banner) => banner.key),
			["gateway_disabled"],
		);
		assert.equal(vm.alerts[0].message, GMAIL_GATEWAY_DISABLED_MESSAGE);
	});

	it("warns about a switched-off gateway even after forwarding was confirmed", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: false,
			connection: connection({ filterId: "f-1", filterQuery: "from:(dan@tldr.tech)" }),
			senders: [sender()],
		});

		assert.equal(vm.state, "filtering");
		assert.deepEqual(
			vm.alerts.map((banner) => banner.key),
			["gateway_disabled"],
		);
	});

	it("reports the filtering state once a filter is live", () => {
		const vm = toGmailPageViewModel({
			gatewayLive: true,
			connection: connection({ filterId: "f-1", filterQuery: "from:(dan@tldr.tech)" }),
			senders: [sender()],
		});

		assert.equal(vm.state, "filtering");
		assert.equal(vm.statusLabel, "Forwarding");
		assert.equal(vm.stateModifier, "gmail__status--filtering");
	});
});

describe("toGmailPollViewModel", () => {
	it("keeps polling with the next cursor while under the confirmation budget", () => {
		const vm = toGmailPollViewModel({ pollCount: 0 });

		assert.equal(vm.pollUrl, "/integrations/gmail/status?poll=1");
		assert.equal(vm.message, "Watching for Gmail to confirm the forwarding address.");
	});

	it("stops polling and asks the reader to refresh once the budget is spent", () => {
		const vm = toGmailPollViewModel({ pollCount: GMAIL_CONFIRM_MAX_POLLS });

		assert.equal(vm.pollUrl, undefined);
		assert.equal(vm.message, "Still waiting. Once you've added the address in Gmail, refresh this page.");
	});
});
