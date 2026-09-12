import assert from "node:assert/strict";
import type { GmailConnection, GmailSenderEntry } from "@packages/domain/gmail";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { AliasNameSchema, INBOX_ADDRESS_MAX_PER_USER, type InboxAddressEntry, type InboxAddressPurpose, InboxAddressSchema, InboxTokenSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { GMAIL_CONFIRM_MAX_POLLS } from "./gmail.url";
import { GMAIL_GATEWAY_DISABLED_MESSAGE, type GmailPageInput, toGmailPageViewModel, toGmailPollViewModel } from "./gmail.viewmodel";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const ALIAS = InboxAddressSchema.parse("tech-b8c3d0@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");

function connection(overrides: Partial<GmailConnection> = {}): GmailConnection {
	return {
		userId: USER, gatewayAddress: GATEWAY, accountEmail: undefined,
		connectedAt: "2026-08-27T00:00:00.000Z", forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
		filterCount: undefined, filterSenderCount: undefined, filterUpdatedAt: undefined,
		lastFilterError: undefined, revokedAt: undefined, revokedReason: undefined,
		disconnectRequestedAt: undefined, ...overrides,
	};
}

function sender(overrides: Partial<GmailSenderEntry> = {}): GmailSenderEntry {
	return {
		userId: USER, senderEmail: TLDR, addedToFilterAt: "2026-08-27T00:06:00.000Z",
		firstSeenAt: undefined, lastSeenAt: undefined, seenCount: undefined,
		lastSubject: undefined, mappedAddress: undefined, mappedAt: undefined, ...overrides,
	};
}

function inbox(input: { name: string; address: string; disabled?: boolean; purpose?: InboxAddressPurpose }): InboxAddressEntry {
	return {
		address: InboxAddressSchema.parse(input.address), userId: USER,
		name: AliasNameSchema.parse(input.name),
		token: InboxTokenSchema.parse(input.address.replace(/^[^-]+-/, "").replace(/@.*$/, "")),
		createdAt: "2026-08-27T00:00:00.000Z", disabledAt: input.disabled ? "2026-08-27T01:00:00.000Z" : undefined,
		purpose: input.purpose ?? "gmail-mapped", gmailConfirmedAt: undefined,
	};
}

function input(overrides: Partial<GmailPageInput> = {}): GmailPageInput {
	return {
		connection: connection(), gatewayLive: true, metadataScopeGranted: true,
		senders: [], inboxes: [], discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW }],
		discovery: { state: "complete", scannedCount: 6 }, discoveryStarted: false, discoveryPending: false, search: "", ...overrides,
	};
}

describe("Gmail sender chooser", () => {
	it("starts discovery while the separate forwarding setup awaits confirmation", () => {
		const vm = toGmailPageViewModel(input({ connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.equal(vm.state, "awaiting-confirmation");
		assert.equal(vm.showStep, true);
		assert.equal(vm.showSenders, true);
		assert.equal(vm.autoDiscover, true);
		assert.equal(vm.showReconnect, false);
		assert.equal(vm.showMetadataReconnect, false);
		assert.equal(vm.gatewayAddress, GATEWAY);
		assert.equal(vm.mailboxUrl, "https://mail.google.com/mail/u/0/");
		assert.equal(vm.canSave, false);
	});

	it("searches cached names and emails without offering an arbitrary address", () => {
		const byName = toGmailPageViewModel(input({ search: " tLdR " }));
		const byEmail = toGmailPageViewModel(input({ search: "MORNINGBREW" }));
		const missing = toGmailPageViewModel(input({ search: "someone@example.com" }));
		assert.deepEqual(byName.chooser.options.map((entry) => entry.email), [TLDR]);
		assert.deepEqual(byEmail.chooser.options.map((entry) => entry.email), [BREW]);
		assert.equal(missing.chooser.hasOptions, false);
		assert.equal(missing.chooser.options.length, 0);
	});

	it("bounds rendered options but searches the entire sorted cache", () => {
		const discoveredSenders = Array.from({ length: 150 }, (_, index) => ({ email: `sender${String(index).padStart(3, "0")}@example.com` })).reverse();
		const vm = toGmailPageViewModel(input({ discoveredSenders }));
		assert.equal(vm.chooser.options.length, 100);
		assert.equal(vm.chooser.options[0].email, "sender000@example.com");
		assert.match(vm.chooser.refineMessage ?? "", /100 of 150/);
		const searched = toGmailPageViewModel(input({ discoveredSenders, search: "sender149" }));
		assert.equal(searched.chooser.options[0].email, "sender149@example.com");
		assert.equal(searched.chooser.refineMessage, undefined);
	});

	it("keeps chooser state and tracking in server-rendered GET choices", () => {
		const vm = toGmailPageViewModel(input({ search: "tech", selectedSender: TLDR, selectedDestination: ALIAS,
			discoveryAfter: "previous", inboxes: [inbox({ name: "tech", address: ALIAS })] }));
		const fields = Object.fromEntries(vm.chooser.options[0].fields.map((field) => [field.name, field.value]));
		assert.equal(fields.sender, TLDR);
		assert.equal(fields.destination, ALIAS);
		assert.equal(fields.search, "tech");
		assert.equal(fields.discovery, "started");
		assert.equal(fields.discovery_after, "previous");
		assert.equal(fields.utm_source, "integrations-gmail");
		assert.equal(fields.utm_medium, "internal");
		assert.equal(vm.searchFields.some((field) => field.name === "search"), false);
		assert.equal(vm.searchFields.some((field) => field.name === "discovery_after"), false);
		assert.equal(vm.chooser.discoveryAfter, "previous");
	});

	it("offers only enabled owned inboxes and an explicit new inbox choice", () => {
		const vm = toGmailPageViewModel(input({ selectedSender: TLDR, selectedDestination: ALIAS, inboxes: [
			inbox({ name: "tech", address: ALIAS, purpose: "user-alias" }),
			inbox({ name: "cook", address: "cook-c4e5f6@read.place", disabled: true }),
			inbox({ name: "gmail", address: GATEWAY, purpose: "gmail-forwarding" }),
		] }));
		assert.deepEqual(vm.destinationOptions.map((option) => option.value), [ALIAS, "new"]);
		assert.equal(vm.destinationLabel, "tech");
		assert.equal(vm.canSave, true);
		assert.equal(vm.newInbox, false);
		const fresh = toGmailPageViewModel(input({ selectedSender: TLDR, selectedDestination: "new", inboxName: "science" }));
		assert.equal(fresh.newInbox, true);
		assert.equal(fresh.inboxName, "science");
		assert.equal(fresh.destinationLabel, "New inbox");
		assert.equal(fresh.canSave, true);
		const invalid = toGmailPageViewModel(input({ selectedSender: TLDR, selectedDestination: GATEWAY }));
		assert.equal(invalid.selectedDestination, undefined);
		assert.equal(invalid.destinationLabel, "Choose an inbox");
		assert.equal(invalid.canSave, false);
	});

	it("disables creating at the shared cap while allowing existing destinations", () => {
		const inboxes = Array.from({ length: INBOX_ADDRESS_MAX_PER_USER }, (_, index) => inbox({
			name: `inbox${index}`, address: `inbox${index}-${index.toString(16).padStart(6, "0")}@read.place`,
			purpose: index % 2 === 0 ? "gmail-mapped" : "user-alias",
		}));
		const fresh = toGmailPageViewModel(input({ inboxes, selectedSender: TLDR, selectedDestination: "new" }));
		assert.equal(fresh.inboxLimit, true);
		assert.equal(fresh.destinationOptions.at(-1)?.disabled, true);
		assert.equal(fresh.canSave, false);
		const existing = toGmailPageViewModel(input({ inboxes, selectedSender: TLDR, selectedDestination: inboxes[0].address }));
		assert.equal(existing.canSave, true);
		assert.equal(existing.destinationOptions[0].disabled, false);
	});

	it("polls progressive discovery with all chooser state preserved", () => {
		const vm = toGmailPageViewModel(input({ discoveryStarted: true, discovery: { state: "running", scannedCount: 200 },
			search: "tech", selectedSender: TLDR, selectedDestination: "new", pollCount: 4 }));
		assert.equal(vm.autoDiscover, false);
		assert.match(vm.chooser.message, /2 found from 200 messages/);
		assert(vm.chooser.pollUrl);
		const url = new URL(vm.chooser.pollUrl, "https://readplace.com");
		assert.equal(url.pathname, "/integrations/gmail/senders");
		assert.equal(url.searchParams.get("poll"), "5");
		assert.equal(url.searchParams.get("search"), "tech");
		assert.equal(url.searchParams.get("sender"), TLDR);
		assert.equal(url.searchParams.get("destination"), "new");
	});

	it("polls queued initial and refresh jobs until the bounded retry limit", () => {
		const idle = { state: "idle" as const, scannedCount: 0 };
		const initial = toGmailPageViewModel(input({ discovery: idle }));
		assert.equal(initial.chooser.pollUrl, undefined);
		assert.match(initial.chooser.message, /Load senders/);
		assert(toGmailPageViewModel(input({ discovery: idle, discoveryStarted: true })).chooser.pollUrl);
		const refresh = toGmailPageViewModel(input({ discoveryPending: true, discoveryAfter: "previous" }));
		assert.match(refresh.chooser.pollUrl ?? "", /discovery_after=previous/);
		const stopped = toGmailPageViewModel(input({ discovery: idle, discoveryStarted: true, pollCount: GMAIL_CONFIRM_MAX_POLLS }));
		assert.equal(stopped.chooser.pollUrl, undefined);
		assert.match(stopped.chooser.message, /Press Load senders/);
	});

	it("keeps cached choices usable when discovery completes or fails", () => {
		const complete = toGmailPageViewModel(input({ pollCount: GMAIL_CONFIRM_MAX_POLLS }));
		assert.equal(complete.chooser.message, "2 Gmail senders available.");
		assert.equal(complete.chooser.pollUrl, undefined);
		const failed = toGmailPageViewModel(input({ discovery: { state: "failed", scannedCount: 5 } }));
		assert.match(failed.chooser.message, /couldn't finish/);
		assert.equal(failed.chooser.hasOptions, true);
		assert.equal(failed.chooser.pollUrl, undefined);
	});
});

describe("Gmail inbox mappings and connection status", () => {
	it("groups active senders by inbox and keeps legacy mappings visible", () => {
		const vm = toGmailPageViewModel(input({ inboxes: [inbox({ name: "tech", address: ALIAS, disabled: true })], senders: [
			sender({ mappedAddress: ALIAS }), sender({ senderEmail: BREW, mappedAddress: ALIAS }),
			sender({ senderEmail: ForwardableSenderSchema.parse("legacy@example.com") }),
			sender({ addedToFilterAt: undefined, lastSubject: "No longer displayed" }),
		] }));
		assert.equal(vm.mappings.length, 2);
		assert.equal(vm.hasMappings, true);
		assert.equal(vm.mappings[0].name, "tech");
		assert.equal(vm.mappings[0].address, ALIAS);
		assert.equal(vm.mappings[0].disabled, true);
		assert.deepEqual(vm.mappings[0].senders.map((row) => row.email), [TLDR, BREW]);
		assert.equal(vm.mappings[1].destination, "legacy");
		assert.equal(vm.mappings[1].name, "Choose an inbox");
		assert.equal(vm.mappings[1].address, undefined);
		assert.match(vm.mappings[0].senders[0].selectUrl, /sender=dan%40tldr.tech/);
		const missingInbox = toGmailPageViewModel(input({ senders: [sender({ mappedAddress: ALIAS })] }));
		assert.equal(missingInbox.mappings[0].name, ALIAS);
	});

	it("preserves mappings when metadata consent is missing or Google revokes access", () => {
		const metadata = toGmailPageViewModel(input({ metadataScopeGranted: false, senders: [sender()] }));
		assert.equal(metadata.showMetadataReconnect, true);
		assert.equal(metadata.showSenders, false);
		assert.equal(metadata.hasMappings, true);
		const revoked = toGmailPageViewModel(input({ metadataScopeGranted: false, senders: [sender()],
			connection: connection({ revokedAt: "2026-08-28", revokedReason: "invalid-grant" }) }));
		assert.equal(revoked.showReconnect, true);
		assert.equal(revoked.showMetadataReconnect, false);
		assert.equal(revoked.showSenders, false);
		assert.equal(revoked.hasMappings, true);
		const denied = toGmailPageViewModel(input({ discovery: { state: "failed", scannedCount: 0, requiresReconnect: true } }));
		assert.equal(denied.showMetadataReconnect, true);
		assert.equal(denied.showSenders, false);
		assert.match(denied.chooser.message, /Reconnect Gmail/);
		assert.match(denied.chooser.reconnectAction ?? "", /integrations\/gmail\/connect/);
	});

	it("shows the connected mailbox and forwarding status", () => {
		const vm = toGmailPageViewModel(input({ connection: connection({ filterCount: 1,
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") }) }));
		assert.equal(vm.stateModifier, "gmail__status--filtering");
		assert.equal(vm.statusLabel, "Forwarding");
		assert.equal(vm.mailboxUrl, "https://mail.google.com/mail/u/0/?authuser=reader%40gmail.com");
		assert.equal(vm.showStep, false);
	});

	it("shows known operation banners and filter errors but ignores unknown keys", () => {
		const vm = toGmailPageViewModel(input({ error: "destination_invalid", notice: "mapping_removed",
			connection: connection({ lastFilterError: { code: "query-too-long", message: "Too many senders", at: "2026-08-28" } }) }));
		assert.equal(vm.state, "filter-failed");
		assert.deepEqual(vm.alerts.map((entry) => entry.key), ["destination_invalid", "filter"]);
		assert.equal(vm.alerts[1].message, "Too many senders");
		assert.equal(vm.notices[0].key, "mapping_removed");
		const unknown = toGmailPageViewModel(input({ error: "unexpected", notice: "unexpected" }));
		assert.deepEqual(unknown.alerts, []);
		assert.deepEqual(unknown.notices, []);
	});

	it("explains recovery for a disabled gateway", () => {
		const vm = toGmailPageViewModel(input({ gatewayLive: false, connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.equal(vm.showStep, false);
		assert.equal(vm.alerts[0].message, GMAIL_GATEWAY_DISABLED_MESSAGE);
	});
});

describe("Gmail forwarding confirmation polling", () => {
	it("keeps polling until its budget is exhausted", () => {
		assert.equal(toGmailPollViewModel({ pollCount: 0 }).pollUrl, "/integrations/gmail/status?poll=1");
		const stopped = toGmailPollViewModel({ pollCount: GMAIL_CONFIRM_MAX_POLLS });
		assert.equal(stopped.pollUrl, undefined);
		assert.match(stopped.message, /refresh this page/);
	});
});
