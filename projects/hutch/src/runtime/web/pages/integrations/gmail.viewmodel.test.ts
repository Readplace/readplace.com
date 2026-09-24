import assert from "node:assert/strict";
import type { GmailConfirmFailureReason, GmailConnection, GmailSenderEntry } from "@packages/domain/gmail";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { AliasNameSchema, INBOX_ADDRESS_MAX_PER_USER, type InboxAddressEntry, type InboxAddressPurpose, InboxAddressSchema, InboxTokenSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { GMAIL_CONFIRM_MAX_POLLS, GMAIL_DISCOVERY_MAX_POLLS } from "./gmail.url";
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
		lastConfirmError: undefined,
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
		purpose: input.purpose ?? "gmail-mapped",
		readlist: undefined,
	};
}

function discovery(overrides: Partial<GmailPageInput["discovery"]> = {}): GmailPageInput["discovery"] {
	return {
		state: "complete", mode: "history", scannedCount: 6, estimatedTotalMessages: undefined, ...overrides,
	};
}

function input(overrides: Partial<GmailPageInput> = {}): GmailPageInput {
	return {
		connection: connection(), gatewayLive: true, metadataScopeGranted: true,
		senders: [], inboxes: [], discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW }],
		discovery: discovery(), discoveryStarted: false, discoveryPending: false, search: "", ...overrides,
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

	it("keeps Open Gmail the only amber CTA while the forwarding step shows", () => {
		const awaiting = toGmailPageViewModel(input({ connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.equal(awaiting.showStep, true);
		assert.equal(awaiting.commitVariant, "neutral");
		const confirmed = toGmailPageViewModel(input());
		assert.equal(confirmed.showStep, false);
		assert.equal(confirmed.commitVariant, "primary");
	});

	it("tells inline inbox creation and sender-access reconnects apart in their tracking", () => {
		const vm = toGmailPageViewModel(input());
		const tracked = (href: string) => {
			const url = new URL(href, "https://readplace.com");
			return [url.pathname, url.searchParams.get("utm_source"), url.searchParams.get("utm_content")];
		};
		assert.deepEqual(tracked(vm.saveAction), ["/integrations/gmail/senders/add", "integrations-gmail", "save-mapping"]);
		assert.deepEqual(tracked(vm.createInboxAction), ["/integrations/gmail/senders/add", "integrations-gmail", "create-inbox"]);
		assert.deepEqual(tracked(vm.reconnectAction), ["/integrations/gmail/connect", "integrations-gmail", "reconnect"]);
		assert.deepEqual(tracked(vm.metadataReconnectAction), ["/integrations/gmail/connect", "integrations-gmail", "grant-sender-access"]);
	});

	it("keeps the discovery Reconnect amber only when no other amber CTA is on screen", () => {
		const requiresReconnect = discovery({ state: "failed", scannedCount: 0, requiresReconnect: true });
		const alone = toGmailPageViewModel(input({ discovery: requiresReconnect }));
		assert.equal(alone.showStep, false);
		assert.equal(alone.canSave, false);
		assert.equal(alone.chooser.reconnectVariant, "primary");
		const besideOpenGmail = toGmailPageViewModel(input({
			discovery: requiresReconnect,
			connection: connection({ forwardingConfirmedAt: undefined }),
		}));
		assert.equal(besideOpenGmail.showStep, true);
		assert.equal(besideOpenGmail.chooser.reconnectVariant, "neutral");
		const besideSave = toGmailPageViewModel(input({
			discovery: requiresReconnect,
			selectedSender: TLDR,
			selectedDestination: ALIAS,
			inboxes: [inbox({ name: "tech", address: ALIAS })],
		}));
		assert.equal(besideSave.showStep, false);
		assert.equal(besideSave.canSave, true);
		assert.equal(besideSave.commitVariant, "primary");
		assert.equal(besideSave.chooser.reconnectVariant, "neutral");
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

	it("keeps mapped and legacy senders searchable without a cached message", () => {
		const legacy = ForwardableSenderSchema.parse("legacy@example.com");
		const senders = [
			sender({ mappedAddress: ALIAS }),
			sender({ senderEmail: BREW, mappedAddress: ALIAS }),
			sender({ senderEmail: legacy }),
			sender({ senderEmail: ForwardableSenderSchema.parse("unmapped@example.com"), addedToFilterAt: undefined }),
		];
		const discoveredSenders = [{ email: TLDR, name: "TLDR" }];
		const vm = toGmailPageViewModel(input({ senders, discoveredSenders }));
		assert.deepEqual(vm.chooser.options.map(({ email, name }) => ({ email, name })), [
			{ email: BREW, name: undefined },
			{ email: TLDR, name: "TLDR" },
			{ email: legacy, name: undefined },
		]);
		assert.equal(vm.chooser.message, "3 Gmail senders available.");
		for (const email of [BREW, legacy]) {
			const searched = toGmailPageViewModel(input({ senders, discoveredSenders, search: email.toUpperCase() }));
			assert.deepEqual(searched.chooser.options.map((option) => option.email), [email]);
			assert.equal(searched.chooser.options[0].fields.find((field) => field.name === "sender")?.value, email);
		}
		const running = toGmailPageViewModel(input({ senders, discoveredSenders: [],
			discovery: discovery({ state: "running", mode: "full" }) }));
		assert.equal(running.chooser.message, "You can select a sender now.");
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

	it("offers enabled owned inboxes and keeps inline creation separate from destination choices", () => {
		const vm = toGmailPageViewModel(input({ selectedSender: TLDR, selectedDestination: ALIAS, inboxes: [
			inbox({ name: "tech", address: ALIAS, purpose: "user-alias" }),
			inbox({ name: "cook", address: "cook-c4e5f6@read.place", disabled: true }),
			inbox({ name: "gmail", address: GATEWAY, purpose: "gmail-forwarding" }),
		] }));
		assert.deepEqual(vm.destinationOptions.map((option) => option.value), [ALIAS]);
		assert.equal(vm.destinationLabel, "tech");
		assert.equal(vm.canSave, true);
		assert.equal(vm.inboxPickerOpen, false);
		assert.equal(vm.canCreateInbox, true);
		const fresh = toGmailPageViewModel(input({ selectedSender: TLDR, selectedDestination: "new", inboxName: "science", error: "inbox_name_invalid" }));
		assert.equal(fresh.inboxPickerOpen, true);
		assert.equal(fresh.inboxName, "science");
		assert.equal(fresh.destinationLabel, "Choose an inbox");
		assert.equal(fresh.canSave, false);
		const invalid = toGmailPageViewModel(input({ selectedSender: TLDR, selectedDestination: GATEWAY }));
		assert.equal(invalid.selectedDestination, undefined);
		assert.equal(invalid.destinationLabel, "Choose an inbox");
		assert.equal(invalid.canSave, false);
	});

	it("opens the inline creation row for every inbox validation error", () => {
		for (const error of ["inbox_name_invalid", "inbox_name_taken", "inbox_limit"]) {
			const vm = toGmailPageViewModel(input({ selectedSender: TLDR, selectedDestination: "new", inboxName: "science", error }));
			assert.equal(vm.inboxPickerOpen, true);
			assert.equal(vm.inboxName, "science");
		}
		const ordinary = toGmailPageViewModel(input({ selectedSender: TLDR, selectedDestination: "new", inboxName: "science" }));
		assert.equal(ordinary.inboxPickerOpen, false);
	});

	it("disables creating at the shared cap while allowing existing destinations", () => {
		const inboxes = Array.from({ length: INBOX_ADDRESS_MAX_PER_USER }, (_, index) => inbox({
			name: `inbox${index}`, address: `inbox${index}-${index.toString(16).padStart(6, "0")}@read.place`,
			purpose: index % 2 === 0 ? "gmail-mapped" : "user-alias",
		}));
		const fresh = toGmailPageViewModel(input({ inboxes, selectedSender: TLDR, selectedDestination: "new" }));
		assert.equal(fresh.inboxLimit, true);
		assert.equal(fresh.destinationOptions.length, INBOX_ADDRESS_MAX_PER_USER);
		assert.equal(fresh.canCreateInbox, false);
		assert.equal(fresh.canSave, false);
		const existing = toGmailPageViewModel(input({ inboxes, selectedSender: TLDR, selectedDestination: inboxes[0].address }));
		assert.equal(existing.canSave, true);
		assert.equal(existing.canCreateInbox, false);
	});

	it("polls progressive discovery with all chooser state preserved", () => {
		const vm = toGmailPageViewModel(input({ discoveryStarted: true, discovery: discovery({ state: "running", mode: "full", scannedCount: 200, estimatedTotalMessages: 500 }),
			search: "tech", selectedSender: TLDR, selectedDestination: "new", pollCount: 4 }));
		assert.equal(vm.autoDiscover, false);
		assert.equal(vm.chooser.message, "You can select a sender now.");
		assert.equal(vm.chooser.loadButtonLabel, "Checking 200 of 500 messages…");
		assert(vm.chooser.pollUrl);
		const url = new URL(vm.chooser.pollUrl, "https://readplace.com");
		assert.equal(url.pathname, "/integrations/gmail/senders");
		assert.equal(url.searchParams.get("poll"), "5");
		assert.equal(url.searchParams.get("search"), "tech");
		assert.equal(url.searchParams.get("sender"), TLDR);
		assert.equal(url.searchParams.get("destination"), "new");
	});

	it("labels full scans before the estimate and incremental refreshes truthfully", () => {
		const full = toGmailPageViewModel(input({ discoveryStarted: true,
			discovery: discovery({ state: "running", mode: "profile", scannedCount: 0 }) }));
		assert.equal(full.chooser.loadButtonLabel, "Checking Gmail messages…");
		const windowed = toGmailPageViewModel(input({ discoveryStarted: true,
			discovery: discovery({ state: "running", mode: "full", scannedCount: 200, estimatedTotalMessages: 48_000 }) }));
		assert.equal(windowed.chooser.loadButtonLabel, "Checking 200 of your 5000 most recent messages…");
		const stillScanningAtWindow = toGmailPageViewModel(input({ discoveryStarted: true,
			discovery: discovery({ state: "running", mode: "full", scannedCount: 5_000, estimatedTotalMessages: 48_000 }) }));
		assert.equal(stillScanningAtWindow.chooser.loadButtonLabel, "Checking 5000 of 48000 messages…");
		const incremental = toGmailPageViewModel(input({ discoveryPending: true,
			discovery: discovery({ state: "complete", mode: "history", scannedCount: 500, estimatedTotalMessages: 500 }) }));
		assert.equal(incremental.chooser.loadButtonLabel, "Checking Gmail for new messages…");
		const catchUp = toGmailPageViewModel(input({
			discovery: discovery({ state: "running", mode: "history", scannedCount: 50, estimatedTotalMessages: 25 }) }));
		assert.equal(catchUp.chooser.loadButtonLabel, "Checking Gmail for new messages…");
		const resumedCatchUp = toGmailPageViewModel(input({ discoveryPending: true,
			discovery: discovery({ state: "failed", mode: "history", scannedCount: 50, estimatedTotalMessages: 25 }) }));
		assert.equal(resumedCatchUp.chooser.loadButtonLabel, "Checking Gmail for new messages…");
	});

	it("backs off polling from three to fifteen seconds and stops honestly at the discovery budget", () => {
		const idle = discovery({ state: "idle", mode: "profile", scannedCount: 0 });
		const running = discovery({ state: "running", mode: "full", scannedCount: 200, estimatedTotalMessages: 500 });
		const initial = toGmailPageViewModel(input({ discovery: idle }));
		assert.equal(initial.chooser.pollUrl, undefined);
		assert.equal(initial.chooser.pollTrigger, undefined);
		assert.match(initial.chooser.message, /Load senders/);
		assert(toGmailPageViewModel(input({ discovery: idle, discoveryStarted: true })).chooser.pollUrl);
		const refresh = toGmailPageViewModel(input({ discoveryPending: true, discoveryAfter: "previous" }));
		assert.match(refresh.chooser.pollUrl ?? "", /discovery_after=previous/);
		const fast = toGmailPageViewModel(input({ discoveryStarted: true, discovery: running, pollCount: 0 }));
		assert.equal(fast.chooser.pollTrigger, "every 3s");
		const slow = toGmailPageViewModel(input({ discoveryStarted: true, discovery: running, pollCount: GMAIL_DISCOVERY_MAX_POLLS - 1 }));
		assert.equal(slow.chooser.pollTrigger, "every 15s");
		const boundary = toGmailPageViewModel(input({ discoveryStarted: true, discovery: running, pollCount: 20 }));
		assert.equal(boundary.chooser.pollTrigger, "every 15s");
		const stopped = toGmailPageViewModel(input({ discoveryStarted: true, discovery: running, pollCount: GMAIL_DISCOVERY_MAX_POLLS }));
		assert.equal(stopped.chooser.pollUrl, undefined);
		assert.equal(stopped.chooser.pollTrigger, undefined);
		assert.equal(stopped.chooser.message, "Still checking your mailbox: 200 of 500 messages so far. Choose a sender from the list, or refresh this page to keep watching.");
		const stoppedHistory = toGmailPageViewModel(input({ discoveryPending: true,
			discovery: discovery({ state: "running", mode: "history", scannedCount: 50, estimatedTotalMessages: undefined }), pollCount: GMAIL_DISCOVERY_MAX_POLLS }));
		assert.equal(stoppedHistory.chooser.message, "Still checking your mailbox. Choose a sender from the list, or refresh this page to keep watching.");
	});

	it("keeps cached choices usable when discovery completes or fails", () => {
		const complete = toGmailPageViewModel(input({ pollCount: GMAIL_CONFIRM_MAX_POLLS }));
		assert.equal(complete.chooser.message, "2 Gmail senders available.");
		assert.equal(complete.chooser.pollUrl, undefined);
		const failed = toGmailPageViewModel(input({ discovery: discovery({ state: "failed", scannedCount: 5 }) }));
		assert.match(failed.chooser.message, /couldn't finish/);
		assert.equal(failed.chooser.hasOptions, true);
		assert.equal(failed.chooser.pollUrl, undefined);
	});

	it("names the finished scan at no senders, one sender and many", () => {
		const none = toGmailPageViewModel(input({ discoveredSenders: [], senders: [] }));
		assert.equal(none.chooser.message, "Readplace didn't find any senders in your Gmail account.");
		const one = toGmailPageViewModel(input({ discoveredSenders: [{ email: TLDR, name: "TLDR" }], senders: [] }));
		assert.equal(one.chooser.message, "1 Gmail sender available.");
		const many = toGmailPageViewModel(input({ discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW }], senders: [] }));
		assert.equal(many.chooser.message, "2 Gmail senders available.");
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
		assert.equal(vm.mappings[0].disabled, true);
		assert.deepEqual(vm.mappings[0].senders.map((row) => row.email), [TLDR, BREW]);
		assert.equal(vm.mappings[1].destination, "legacy");
		assert.equal(vm.mappings[1].name, undefined);
		const missingInbox = toGmailPageViewModel(input({ senders: [sender({ mappedAddress: ALIAS })] }));
		assert.equal(missingInbox.mappings[0].name, ALIAS);
	});

	it("marks senders as pending until Gmail accepts their add or remap", () => {
		const vm = toGmailPageViewModel(input({
			connection: connection({
				filterSenderCount: 1,
				filterUpdatedAt: "2026-08-27T00:07:00.000Z",
			}),
			senders: [
				sender({ mappedAt: "2026-08-27T00:06:00.000Z" }),
				sender({
					senderEmail: BREW,
					addedToFilterAt: "2026-08-27T00:08:00.000Z",
					mappedAt: "2026-08-27T00:06:00.000Z",
				}),
				sender({
					senderEmail: ForwardableSenderSchema.parse("updates@example.com"),
					mappedAt: "2026-08-27T00:08:00.000Z",
				}),
			],
		}));

		assert.deepEqual(vm.mappings[0].senders.map((row) => [row.email, row.state, row.stateLabel]), [
			[TLDR, "live", ""],
			[BREW, "pending", "Waiting for Gmail"],
			["updates@example.com", "pending", "Waiting for Gmail"],
		]);
		assert.equal(vm.filter.state, "updating");
	});

	it("describes the forwarding rule from the state Gmail has accepted", () => {
		const waiting = toGmailPageViewModel(input({
			connection: connection({ forwardingConfirmedAt: undefined }),
		}));
		assert.deepEqual(waiting.filter, {
			state: "waiting-confirmation",
			message: "Forwarding starts once Gmail confirms the forwarding address.",
			messageClass: "gmail__step-copy",
			alert: false,
			actions: [],
		});

		const reconnect = toGmailPageViewModel(input({
			connection: connection({ revokedAt: "2026-08-27T00:08:00.000Z", revokedReason: "invalid-grant" }),
		}));
		assert.deepEqual(reconnect.filter, {
			state: "reconnect",
			message: "Reconnect Gmail to update the forwarding rule.",
			messageClass: "gmail__step-copy",
			alert: false,
			actions: [],
		});

		const tooLong = toGmailPageViewModel(input({
			inboxes: [inbox({ name: "tech", address: ALIAS })],
			connection: connection({ lastFilterError: {
				code: "query-too-long",
				forwardTo: ALIAS,
				senderCount: 40,
				senderCapacity: 36,
				at: "2026-08-27T00:08:00.000Z",
			} }),
		}));
		assert.equal(
			tooLong.filter.message,
			"Gmail's forwarding rule for tech ran out of room at 36 of its 40 senders. Exclude some, or move some to another inbox, then try again.",
		);
		assert.deepEqual(tooLong.filter.actions.map((action) => action.key), ["retry"]);

		const gatewayTooLong = toGmailPageViewModel(input({
			connection: connection({ lastFilterError: {
				code: "query-too-long",
				forwardTo: GATEWAY,
				senderCount: 40,
				senderCapacity: 36,
				at: "2026-08-27T00:08:00.000Z",
			} }),
		}));
		assert.match(gatewayTooLong.filter.message, /for senders without an inbox/);

		const rejected = toGmailPageViewModel(input({
			connection: connection({ lastFilterError: {
				code: "rejected",
				message: "Unrecognized forwarding address",
				at: "2026-08-27T00:08:00.000Z",
			} }),
		}));
		assert.equal(
			rejected.filter.message,
			"Gmail didn't accept the forwarding rule (Unrecognized forwarding address). Try again.",
		);

		const updating = toGmailPageViewModel(input({ senders: [sender()] }));
		assert.equal(updating.filter.state, "updating");
		assert.equal(
			updating.filter.message,
			"Gmail hasn't accepted the latest change yet. Refresh in a moment, or try again.",
		);
		assert.deepEqual(updating.filter.actions.map((action) => action.key), ["retry"]);

		const oneLive = toGmailPageViewModel(input({
			connection: connection({ filterSenderCount: 1, filterUpdatedAt: "2026-08-27T00:07:00.000Z" }),
		}));
		assert.equal(oneLive.filter.message, "Gmail is forwarding 1 sender.");

		const severalLive = toGmailPageViewModel(input({
			connection: connection({ filterSenderCount: 3, filterUpdatedAt: "2026-08-27T00:07:00.000Z" }),
		}));
		assert.equal(severalLive.filter.message, "Gmail is forwarding 3 senders.");

		const none = toGmailPageViewModel(input());
		assert.deepEqual(none.filter, {
			state: "none",
			message: "No forwarding rule in Gmail yet.",
			messageClass: "gmail__step-copy",
			alert: false,
			actions: [],
		});
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
		const denied = toGmailPageViewModel(input({ discovery: discovery({ state: "failed", scannedCount: 0, requiresReconnect: true }) }));
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

	it("shows known operation banners while leaving filter failures in the filter block", () => {
		const vm = toGmailPageViewModel(input({ error: "destination_invalid", notice: "sender_removed",
			connection: connection({ lastFilterError: {
				code: "query-too-long", forwardTo: GATEWAY, senderCount: 40, senderCapacity: 36, at: "2026-08-28",
			} }) }));
		assert.equal(vm.state, "filter-failed");
		assert.deepEqual(vm.alerts.map((entry) => entry.key), ["destination_invalid"]);
		assert.equal(vm.filter.state, "failed");
		assert.equal(vm.filter.messageClass, "gmail__alert");
		assert.equal(vm.filter.alert, true);
		assert.equal(vm.notices[0].key, "sender_removed");
		const unknown = toGmailPageViewModel(input({ error: "unexpected", notice: "unexpected" }));
		assert.deepEqual(unknown.alerts, []);
		assert.deepEqual(unknown.notices, []);
	});

	it("tells the reader when forwarding starts after a save", () => {
		const confirmedMapped = toGmailPageViewModel(input({ notice: "sender_mapped" }));
		assert.equal(confirmedMapped.notices[0].key, "sender_mapped");
		assert.equal(confirmedMapped.notices[0].message, "Mapping saved. Gmail will forward new mail from this sender. Mail already in your mailbox is not forwarded.");
		const confirmedCreated = toGmailPageViewModel(input({ notice: "inbox_created" }));
		assert.equal(confirmedCreated.notices[0].key, "inbox_created");
		assert.equal(confirmedCreated.notices[0].message, "Inbox created and mapping saved. Gmail will forward new mail from this sender. Mail already in your mailbox is not forwarded.");
		const retryRequested = toGmailPageViewModel(input({ notice: "filter_retry_requested" }));
		assert.equal(retryRequested.notices[0].message, "Updating Gmail. Refresh in a moment.");

		const awaiting = { connection: connection({ forwardingConfirmedAt: undefined }) };
		const awaitingMapped = toGmailPageViewModel(input({ ...awaiting, notice: "sender_mapped" }));
		assert.equal(awaitingMapped.state, "awaiting-confirmation");
		assert.equal(awaitingMapped.notices[0].key, "sender_mapped");
		assert.equal(awaitingMapped.notices[0].message, "Mapping saved. New mail from this sender will be forwarded once Gmail confirms the forwarding address.");
		const awaitingCreated = toGmailPageViewModel(input({ ...awaiting, notice: "inbox_created" }));
		assert.equal(awaitingCreated.notices[0].message, "Inbox created and mapping saved. New mail from this sender will be forwarded once Gmail confirms the forwarding address.");

		const awaitingRemoved = toGmailPageViewModel(input({ ...awaiting, notice: "sender_removed" }));
		assert.equal(awaitingRemoved.notices[0].message, "Sender removed from the mapping.");

		const confirmFailed = toGmailPageViewModel(input({ notice: "sender_mapped",
			connection: connection({ forwardingConfirmedAt: undefined, lastConfirmError: { reason: "not-confirmed", at: "2026-08-28T00:00:00.000Z" } }) }));
		assert.equal(confirmFailed.state, "confirm-failed");
		assert.equal(confirmFailed.notices[0].message, "Mapping saved. New mail from this sender will be forwarded once Gmail confirms the forwarding address.");
	});

	it("explains recovery for a disabled gateway", () => {
		const vm = toGmailPageViewModel(input({ gatewayLive: false, connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.equal(vm.showStep, false);
		assert.equal(vm.alerts[0].message, GMAIL_GATEWAY_DISABLED_MESSAGE);
	});

	it("explains a failed confirmation and keeps step 2 on the page", () => {
		const cases: [GmailConfirmFailureReason, RegExp][] = [
			["token-rejected", /already been used or had expired/],
			["not-confirmed", /didn't finish confirming/],
			["invalid-url", /without a link I could use/],
		];
		for (const [reason, expected] of cases) {
			const vm = toGmailPageViewModel(
				input({
					connection: connection({
						forwardingConfirmedAt: undefined,
						lastConfirmError: { reason, at: "2026-08-28T00:00:00.000Z" },
					}),
				}),
			);
			assert.equal(vm.state, "confirm-failed");
			assert.equal(vm.statusLabel, "Needs attention");
			assert.equal(vm.showStep, true);
			assert.equal(vm.pollState, "confirm-failed");
			const alert = vm.alerts.find((entry) => entry.key === "confirm_failed");
			assert(alert, "the confirm-failed alert must render");
			assert.match(alert.message, expected);
		}
	});
});

describe("Gmail forwarding confirmation polling", () => {
	it("keeps polling until its budget is exhausted", () => {
		assert.equal(
			toGmailPollViewModel({ pollCount: 0, state: "awaiting-confirmation" }).pollUrl,
			"/integrations/gmail/status?poll=1&state=awaiting-confirmation",
		);
		const stopped = toGmailPollViewModel({ pollCount: GMAIL_CONFIRM_MAX_POLLS, state: "awaiting-confirmation" });
		assert.equal(stopped.pollUrl, undefined);
		assert.match(stopped.message, /refresh this page/);
	});

	it("changes the watching and exhausted copy after a failure", () => {
		const watching = toGmailPollViewModel({ pollCount: 0, state: "confirm-failed" });
		assert.equal(watching.pollUrl, "/integrations/gmail/status?poll=1&state=confirm-failed");
		assert.match(watching.message, /send a new confirmation/);
		const exhausted = toGmailPollViewModel({ pollCount: GMAIL_CONFIRM_MAX_POLLS, state: "confirm-failed" });
		assert.equal(exhausted.pollUrl, undefined);
		assert.match(exhausted.message, /added the address again/);
	});
});
