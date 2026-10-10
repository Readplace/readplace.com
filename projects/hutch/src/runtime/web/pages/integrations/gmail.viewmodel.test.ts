import assert from "node:assert/strict";
import type { GmailConnection, GmailMapping } from "@packages/domain/gmail";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { AliasNameSchema, type InboxAddressEntry, InboxAddressSchema, InboxTokenSchema } from "@packages/domain/inbox";
import { NewsletterNameSchema } from "@packages/domain/newsletter-catalog";
import { DEFAULT_READLIST, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { GMAIL_CONFIRM_MAX_POLLS } from "./gmail.url";
import { type GmailPageInput, toGmailPageViewModel, toGmailPollViewModel } from "./gmail.viewmodel";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const ALL_ADDRESS = InboxAddressSchema.parse("gmail-b8c3d0@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const BREW_DAILY = ForwardableSenderSchema.parse("daily@morningbrew.com");

function connection(overrides: Partial<GmailConnection> = {}): GmailConnection {
	return {
		userId: USER, gatewayAddress: GATEWAY, accountEmail: undefined,
		connectedAt: "2026-08-27T00:00:00.000Z", forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
		lastConfirmError: undefined,
		filterCount: 1, filterSenderCount: 1, filterUpdatedAt: "2026-08-28T00:00:00.000Z",
		lastFilterError: undefined, revokedAt: undefined, revokedReason: undefined,
		disconnectRequestedAt: undefined, ...overrides,
	};
}

function mapped(senderEmail: typeof TLDR): GmailMapping {
	return {
		accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"), senderEmail,
		addedToFilterAt: "2026-08-27T00:06:00.000Z", mappedAddresses: [ALL_ADDRESS], mappedAt: "2026-08-27T00:06:00.000Z",
		deliveryMode: "links",
	};
}

const ALL_ENTRY: InboxAddressEntry = {
	address: ALL_ADDRESS, userId: USER, name: AliasNameSchema.parse("gmail"),
	token: InboxTokenSchema.parse("b8c3d0"), createdAt: "2026-08-27T00:00:00.000Z",
	disabledAt: undefined, purpose: "gmail-readlist", readlist: undefined,
};

function recognised(entries: [typeof TLDR, string][]): GmailPageInput["detection"] {
	return {
		status: "available",
		recognized: new Map(entries.map(([from, name]) => [from, { from, name: NewsletterNameSchema.parse(name), source: "catalog" as const, match: "exact" as const }])),
	};
}

function input(overrides: Partial<GmailPageInput> = {}): GmailPageInput {
	return {
		userId: USER,
		canConnectGmail: true,
		connection: connection(),
		senders: [],
		destinations: new Map(),
		readlists: [DEFAULT_READLIST],
		readlistLimitReached: false,
		gatewayLive: true,
		metadataScopeGranted: true,
		readonlyScopeGranted: false,
		discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW, name: undefined }],
		discovery: { state: "complete", mode: "history", checkedMessageCount: 6 },
		detection: recognised([]),
		imports: [],
		state: {},
		discoveryStarted: false,
		discoveryPending: false,
		pollCount: 0,
		importsPollCount: 0,
		error: undefined,
		notice: undefined,
		...overrides,
	};
}

describe("GMail Newsletters calls to action", () => {
	it("keeps Open Gmail the only amber CTA while the forwarding step shows", () => {
		const awaiting = toGmailPageViewModel(input({ connection: connection({ forwardingConfirmedAt: undefined }), state: { sender: TLDR, readlist: "default" } }));
		assert.equal(awaiting.showStep, true);
		assert.equal(awaiting.save?.variant, "neutral");
		const confirmed = toGmailPageViewModel(input({ state: { sender: TLDR, readlist: "default" } }));
		assert.equal(confirmed.showStep, false);
		assert.equal(confirmed.save?.variant, "primary");
	});

	it("keeps the discovery Reconnect amber only when no other amber CTA is on screen", () => {
		const requiresReconnect: GmailPageInput["discovery"] = { state: "failed", mode: "full", checkedMessageCount: 0, requiresReconnect: true };
		const alone = toGmailPageViewModel(input({ discovery: requiresReconnect }));
		assert.equal(alone.chooser.reconnectActions[0]?.variant, "primary");
		assert.equal(alone.chooser.statusLead, "Reconnect Gmail to continue loading senders. The newsletters you set up stay in place.");
		assert.equal(alone.chooser.checkedLabel, undefined);
		assert.equal(alone.showMetadataReconnect, true);
		assert.equal(alone.showSenders, false);
		const besideOpenGmail = toGmailPageViewModel(input({ discovery: requiresReconnect, connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.equal(besideOpenGmail.chooser.reconnectActions[0]?.variant, "neutral");
		const besideSave = toGmailPageViewModel(input({ discovery: requiresReconnect, state: { sender: TLDR, readlist: "default" } }));
		assert.equal(besideSave.chooser.reconnectActions[0]?.variant, "neutral");
	});

	it("opens the connected mailbox for the account that granted access", () => {
		assert.equal(toGmailPageViewModel(input()).mailboxUrl, "https://mail.google.com/mail/u/0/");
		const withAccount = toGmailPageViewModel(input({ connection: connection({ accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") }) }));
		assert.equal(withAccount.mailboxUrl, "https://mail.google.com/mail/u/0/?authuser=reader%40gmail.com");
	});
});

describe("GMail Newsletters connection status", () => {
	it("reads Not forwarding yet until Gmail holds a filter, then Forwarding", () => {
		const unfiltered = toGmailPageViewModel(input({ connection: connection({ filterCount: undefined, filterSenderCount: undefined, filterUpdatedAt: undefined }) }));
		assert.equal(unfiltered.state, "ready-to-filter");
		assert.equal(unfiltered.statusLabel, "Not forwarding yet");
		const filtering = toGmailPageViewModel(input());
		assert.equal(filtering.state, "filtering");
		assert.equal(filtering.statusLabel, "Forwarding");
	});
});

describe("GMail Newsletters discovery status", () => {
	it("asks the reader to load senders before any discovery", () => {
		const vm = toGmailPageViewModel(input({ discoveredSenders: [], discovery: { state: "idle", mode: "profile", checkedMessageCount: 0 } }));
		assert.equal(vm.chooser.statusLead, "Load senders from your Gmail account to choose one.");
		assert.equal(vm.chooser.checkedLabel, undefined);
		assert.equal(vm.autoDiscoverAction, "/newsletters/gmail/discovery/start");
	});

	it("reports progress from zero while a requested discovery has not started yet", () => {
		const vm = toGmailPageViewModel(input({ discoveredSenders: [], discovery: { state: "idle", mode: "profile", checkedMessageCount: 0 }, discoveryStarted: true }));
		assert.equal(`${vm.chooser.statusLead}${vm.chooser.checkedLabel}`, "Checking… Checked 0 messages");
		assert.equal(vm.chooser.loadButtonLabel, "Checking…");
		assert.equal(vm.autoDiscoverAction, undefined);
	});

	it("keeps cached choices usable when discovery fails", () => {
		const vm = toGmailPageViewModel(input({ discovery: { state: "failed", mode: "full", checkedMessageCount: 40 } }));
		assert.equal(vm.chooser.statusLead, "I couldn't finish loading your Gmail senders. Your saved choices are still available. Try Load senders again.");
		assert.equal(vm.chooser.loadButtonLabel, "Load senders");
		assert.deepEqual(vm.chooser.options.map((option) => option.email), []);
	});

	it("names a finished scan with one sender and one message in the singular", () => {
		const vm = toGmailPageViewModel(input({ discoveredSenders: [{ email: TLDR, name: undefined }], discovery: { state: "complete", mode: "full", checkedMessageCount: 1 } }));
		assert.equal(`${vm.chooser.statusLead}${vm.chooser.checkedLabel}`, "1 sender discovered · Checked 1 message");
	});

	it("checks for new messages when a refresh is pending on a finished discovery", () => {
		const vm = toGmailPageViewModel(input({ discovery: { state: "complete", mode: "full", checkedMessageCount: 1_200 }, discoveryPending: true }));
		assert.equal(`${vm.chooser.statusLead}${vm.chooser.checkedLabel}`, "Checking for new messages · Checked 1,200 messages");
	});
});

describe("GMail Newsletters ordering", () => {
	it("lists recognised newsletters before other senders and breaks name ties by address", () => {
		const vm = toGmailPageViewModel(input({
			discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW_DAILY, name: undefined }, { email: BREW, name: undefined }],
			detection: recognised([[BREW_DAILY, "Morning Brew"], [BREW, "Morning Brew"]]),
			state: { advanced: "1" },
		}));
		assert.deepEqual(vm.chooser.options.map((option) => option.email), [BREW, BREW_DAILY, TLDR]);
		const reversed = toGmailPageViewModel(input({
			discoveredSenders: [{ email: BREW, name: undefined }, { email: TLDR, name: "TLDR" }],
			detection: recognised([[BREW, "Morning Brew"]]),
			state: { advanced: "1" },
		}));
		assert.deepEqual(reversed.chooser.options.map((option) => option.email), [BREW, TLDR]);
	});

	it("leaves a mapped sender out of the chooser while it stays selectable for editing", () => {
		const page = input({
			senders: [mapped(TLDR)],
			destinations: new Map([[ALL_ADDRESS, ALL_ENTRY]]),
			detection: recognised([[TLDR, "TLDR"], [BREW, "Morning Brew"]]),
		});
		assert.deepEqual(toGmailPageViewModel(page).chooser.options.map((option) => option.email), [BREW]);
		const editing = toGmailPageViewModel({ ...page, state: { sender: TLDR, readlist: "default", edit: "1" } });
		assert.equal(editing.senderChoiceLabel, TLDR);
		assert.notEqual(editing.save, undefined);
	});

	it("orders mapped newsletters by name then address and counts a single forwarded sender", () => {
		const vm = toGmailPageViewModel(input({
			senders: [mapped(BREW_DAILY), mapped(BREW)],
			destinations: new Map([[ALL_ADDRESS, ALL_ENTRY]]),
			discoveredSenders: [],
			detection: recognised([[BREW_DAILY, "Morning Brew"], [BREW, "Morning Brew"]]),
		}));
		assert.deepEqual(vm.mappings.rows.map((row) => row.sender), [BREW, BREW_DAILY]);
		assert.equal(vm.mappings.filter.message, "Gmail is forwarding 1 sender.");
	});
});

describe("GMail Newsletters readlist choice", () => {
	it("selects only a readlist the reader holds and shows its label", () => {
		const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };
		const chosen = toGmailPageViewModel(input({ readlists: [DEFAULT_READLIST, TECH], state: { sender: TLDR, readlist: "tech" } }));
		assert.equal(chosen.readlistPicker.choiceLabel, "All, Tech");
		assert.deepEqual(chosen.readlistPicker.options.map((option) => [option.slug, option.selected]), [["default", true], ["tech", true]]);
		const unknown = toGmailPageViewModel(input({ readlists: [DEFAULT_READLIST, TECH], state: { sender: TLDR, readlist: "gone" } }));
		assert.equal(unknown.readlistPicker.choiceLabel, "All");
		assert.equal(unknown.save?.disabled, true);
	});

	it("selects All for ordinary entries and asks notification recipients to confirm when custom lists exist", () => {
		const onlyAll = toGmailPageViewModel(input({ state: { sender: TLDR }, notification: true }));
		assert.equal(onlyAll.readlistPicker.choiceLabel, "All");
		assert.equal(onlyAll.save?.disabled, false);
		assert.equal(onlyAll.notificationSender, TLDR);
		const choice = toGmailPageViewModel(input({ state: { sender: TLDR }, readlists: [DEFAULT_READLIST, { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" }] }));
		assert.equal(choice.readlistPicker.choiceLabel, "All");
		assert.equal(choice.save?.disabled, false);
		assert.equal(choice.notificationSender, undefined);
		const missing = toGmailPageViewModel(input({ state: { sender: "other@example.com" }, notification: true }));
		assert.equal(missing.notificationSender, undefined);
		assert.equal(missing.save, undefined);
	});

	it("opens an already mapped newsletter with its current destination", () => {
		const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };
		const page = input({ senders: [mapped(TLDR)], destinations: new Map([[ALL_ADDRESS, { ...ALL_ENTRY, readlist: TECH.slug }]]), readlists: [DEFAULT_READLIST, TECH], state: { sender: TLDR }, notification: true });
		const current = toGmailPageViewModel(page);
		assert.equal(current.readlistPicker.choiceLabel, "All, Tech");
		assert.equal(current.save?.disabled, false);
		assert.equal(current.save?.offerImport, false);
		const missing = toGmailPageViewModel({ ...page, destinations: new Map() });
		assert.equal(missing.readlistPicker.choiceLabel, "All");
		assert.equal(missing.save?.disabled, false);
	});

	it("requires notification confirmation for a legacy filtered sender without destinations", () => {
		const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };
		const vm = toGmailPageViewModel(input({
			senders: [{ ...mapped(TLDR), mappedAddresses: undefined, mappedAt: undefined }],
			readlists: [DEFAULT_READLIST, TECH],
			state: { sender: TLDR },
			notification: true,
		}));
		assert.equal(vm.readlistPicker.choiceLabel, "All");
		assert.equal(vm.readlistPicker.confirmLabel, "Confirm readlists");
		assert.equal(vm.pickerState.readlist_choice_for, TLDR);
		assert.equal(vm.save?.disabled, true);
		assert.equal(vm.save?.offerImport, false);
	});

	it("preselects every saved destination before its filter timestamp is written", () => {
		const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };
		const WORK = { slug: ReadlistSlugSchema.parse("work"), label: "Work" };
		const workAddress = InboxAddressSchema.parse("work-c9d4e1@read.place");
		const page = input({
			senders: [{ ...mapped(TLDR), addedToFilterAt: undefined, mappedAddresses: [ALL_ADDRESS, workAddress] }],
			destinations: new Map([[ALL_ADDRESS, { ...ALL_ENTRY, readlist: TECH.slug }], [workAddress, { ...ALL_ENTRY, address: workAddress, readlist: WORK.slug }]]),
			readlists: [DEFAULT_READLIST, TECH, WORK],
			state: { sender: TLDR },
			notification: true,
		});
		const vm = toGmailPageViewModel(page);
		assert.equal(vm.readlistPicker.choiceLabel, "All, Tech, Work");
		assert.deepEqual(vm.readlistPicker.options.map((option) => option.selected), [true, true, true]);
		assert.equal(vm.pickerState.readlist_choice_for, undefined);
		assert.equal(vm.save?.disabled, false);
		assert.equal(vm.save?.offerImport, true);
		assert.equal(toGmailPageViewModel({ ...page, state: { sender: TLDR, readlist_choice_for: TLDR } }).save?.disabled, false);
	});

	it.each(["readlist_invalid", "readlist_name_invalid", "readlist_limit"])("opens the readlist picker for %s", (error) => {
		assert.equal(toGmailPageViewModel(input({ state: { sender: TLDR }, error })).readlistPicker.open, true);
	});

	it("keeps the picker closed for other errors and ignores unknown banner keys", () => {
		const vm = toGmailPageViewModel(input({ state: { sender: TLDR }, error: "sender_unknown", notice: "nonsense" }));
		assert.equal(vm.readlistPicker.open, false);
		assert.deepEqual(vm.alerts.map((alert) => alert.key), ["sender_unknown"]);
		assert.deepEqual(vm.notices, []);
	});

	it("keeps a notice's ordinary copy during Step 2 when it has no confirmation variant", () => {
		const vm = toGmailPageViewModel(input({ connection: connection({ forwardingConfirmedAt: undefined }), notice: "readlist_created" }));
		assert.deepEqual(vm.notices, [{ key: "readlist_created", message: "Readlist created. Save the newsletter to use it.", variant: "success" }]);
	});
});

describe("Gmail forwarding confirmation polling", () => {
	it("keeps polling until its budget is exhausted", () => {
		assert.equal(toGmailPollViewModel({ pollCount: 0, state: "awaiting-confirmation" }).pollUrl, "/newsletters/gmail/status?poll=1&state=awaiting-confirmation");
		assert.equal(toGmailPollViewModel({ pollCount: GMAIL_CONFIRM_MAX_POLLS, state: "awaiting-confirmation" }).pollUrl, undefined);
	});

	it("changes the watching and exhausted copy after a failure", () => {
		assert.equal(toGmailPollViewModel({ pollCount: 0, state: "confirm-failed" }).message, "Watching for Gmail to send a new confirmation.");
		assert.equal(
			toGmailPollViewModel({ pollCount: GMAIL_CONFIRM_MAX_POLLS, state: "confirm-failed" }).message,
			"Still waiting. Once you've added the address again in Gmail, refresh this page.",
		);
	});
});
