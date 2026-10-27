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
		readScopeGranted: false,
		modifyScopeGranted: true,
		discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW, name: undefined }],
		discovery: { state: "complete", mode: "history", checkedMessageCount: 6 },
		detection: recognised([]),
		imports: [],
		state: {},
		command: { pick: undefined, select: undefined },
		listed: undefined,
		discoveryStarted: false,
		discoveryPending: false,
		pollCount: 0,
		importsPollCount: 0,
		error: undefined,
		notice: undefined,
		saved: undefined,
		focusOnOpen: true,
		...overrides,
	};
}

describe("GMail Newsletters calls to action", () => {
	it("keeps Open Gmail the only amber CTA while the forwarding step shows", () => {
		const addVariants = (pageInput: GmailPageInput) => {
			const vm = toGmailPageViewModel(pageInput);
			return [vm.showStep, [...vm.mappings.headerActions, ...vm.mappings.emptyActions].map((action) => action.variant)];
		};
		assert.deepEqual(addVariants(input({ connection: connection({ forwardingConfirmedAt: undefined }) })), [true, ["neutral"]]);
		assert.deepEqual(addVariants(input()), [false, ["primary"]]);
	});

	it("keeps the discovery Reconnect neutral and offers no newsletters to add until the reader reconnects", () => {
		const requiresReconnect: GmailPageInput["discovery"] = { state: "failed", mode: "full", checkedMessageCount: 0, requiresReconnect: true };
		const vm = toGmailPageViewModel(input({ discovery: requiresReconnect, state: { add: "1" } }));
		assert.deepEqual(vm.status.reconnectActions.map((action) => action.variant), ["neutral"]);
		assert.deepEqual([vm.dialog.mode, vm.mappings.emptyActions], ["none", []]);
		assert.equal(vm.status.statusLead, "Reconnect Gmail to continue loading senders. The newsletters you set up stay in place.");
		assert.equal(vm.status.checkedLabel, undefined);
		assert.equal(vm.showMetadataReconnect, true);
		assert.equal(vm.showSenders, false);
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
		assert.equal(vm.status.statusLead, "Load senders from your Gmail account to choose one.");
		assert.equal(vm.status.checkedLabel, undefined);
		assert.equal(vm.autoDiscoverAction, "/newsletters/gmail/discovery/start");
	});

	it("reports progress from zero while a requested discovery has not started yet", () => {
		const vm = toGmailPageViewModel(input({ discoveredSenders: [], discovery: { state: "idle", mode: "profile", checkedMessageCount: 0 }, discoveryStarted: true }));
		assert.equal(`${vm.status.statusLead}${vm.status.checkedLabel}`, "Checking… Checked 0 messages");
		assert.equal(vm.status.loadButtonLabel, "Checking…");
		assert.equal(vm.autoDiscoverAction, undefined);
	});

	it("keeps cached choices usable when discovery fails", () => {
		const vm = toGmailPageViewModel(input({ discovery: { state: "failed", mode: "full", checkedMessageCount: 40 } }));
		assert.equal(vm.status.statusLead, "I couldn't finish loading your Gmail senders. Your saved choices are still available. Try Load senders again.");
		assert.equal(vm.status.loadButtonLabel, "Load senders");
		assert.deepEqual(vm.results.options.map((option) => option.email), [BREW, TLDR]);
	});

	it("names a finished scan with one sender and one message in the singular", () => {
		const vm = toGmailPageViewModel(input({ discoveredSenders: [{ email: TLDR, name: undefined }], discovery: { state: "complete", mode: "full", checkedMessageCount: 1 } }));
		assert.equal(`${vm.status.statusLead}${vm.status.checkedLabel}`, "1 sender discovered · Checked 1 message");
	});

	it("checks for new messages when a refresh is pending on a finished discovery", () => {
		const vm = toGmailPageViewModel(input({ discovery: { state: "complete", mode: "full", checkedMessageCount: 1_200 }, discoveryPending: true }));
		assert.equal(`${vm.status.statusLead}${vm.status.checkedLabel}`, "Checking for new messages · Checked 1,200 messages");
	});
});

describe("GMail Newsletters ordering", () => {
	it("lists recognised newsletters before other senders and breaks name ties by address", () => {
		const vm = toGmailPageViewModel(input({
			discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW_DAILY, name: undefined }, { email: BREW, name: undefined }],
			detection: recognised([[BREW_DAILY, "Morning Brew"], [BREW, "Morning Brew"]]),
		}));
		assert.deepEqual(vm.results.options.map((option) => option.email), [BREW, BREW_DAILY, TLDR]);
		assert.deepEqual(vm.checklist.groups.flatMap((group) => group.rows.map((row) => row.email)), [BREW, BREW_DAILY]);
		const reversed = toGmailPageViewModel(input({
			discoveredSenders: [{ email: BREW, name: undefined }, { email: TLDR, name: "TLDR" }],
			detection: recognised([[BREW, "Morning Brew"]]),
		}));
		assert.deepEqual(reversed.results.options.map((option) => option.email), [BREW, TLDR]);
	});

	it("leaves a mapped sender out of the search and the checklist while it stays tickable for editing", () => {
		const page = input({
			senders: [mapped(TLDR)],
			destinations: new Map([[ALL_ADDRESS, ALL_ENTRY]]),
			detection: recognised([[TLDR, "TLDR"], [BREW, "Morning Brew"]]),
		});
		const listing = toGmailPageViewModel(page);
		assert.deepEqual(listing.results.options.map((option) => option.email), [BREW]);
		assert.deepEqual(listing.checklist.groups.map((group) => [group.key, group.rows.map((row) => row.email)]), [["known", [BREW]]]);
		const editing = toGmailPageViewModel({ ...page, state: { sender: [TLDR], readlist: "default", edit: "1" } });
		assert.deepEqual(editing.checklist.groups.map((group) => [group.key, group.rows.map((row) => [row.email, row.checked])]), [["editing", [[TLDR, true]]], ["known", [[BREW, false]]]]);
		assert.deepEqual(editing.pickerState.sender, [TLDR]);
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
		const chosen = toGmailPageViewModel(input({ readlists: [DEFAULT_READLIST, TECH], state: { sender: [TLDR], readlist: "tech" } }));
		assert.equal(chosen.readlistPicker.choiceLabel, "All, Tech");
		assert.deepEqual(chosen.readlistPicker.options.map((option) => [option.slug, option.selected]), [["default", true], ["tech", true]]);
		const unknown = toGmailPageViewModel(input({ readlists: [DEFAULT_READLIST, TECH], state: { sender: [TLDR], readlist: "gone" } }));
		assert.equal(unknown.readlistPicker.choiceLabel, "All");
		assert.equal(unknown.save.disabled, true);
	});

	it("selects All for ordinary entries and asks notification recipients to confirm when custom lists exist", () => {
		const onlyAll = toGmailPageViewModel(input({ state: { sender: [TLDR] }, notification: true }));
		assert.equal(onlyAll.readlistPicker.choiceLabel, "All");
		assert.equal(onlyAll.save.disabled, false);
		assert.equal(onlyAll.notificationSender, TLDR);
		const choice = toGmailPageViewModel(input({ state: { sender: [TLDR] }, readlists: [DEFAULT_READLIST, { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" }] }));
		assert.equal(choice.readlistPicker.choiceLabel, "All");
		assert.equal(choice.save.disabled, false);
		assert.equal(choice.notificationSender, undefined);
		const missing = toGmailPageViewModel(input({ state: { sender: [ForwardableSenderSchema.parse("other@example.com")] }, notification: true }));
		assert.equal(missing.notificationSender, undefined);
		assert.deepEqual(missing.pickerState.sender, []);
		assert.equal(missing.save.disabled, false);
	});

	it("opens an already mapped newsletter with its current destination", () => {
		const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };
		const page = input({ senders: [mapped(TLDR)], destinations: new Map([[ALL_ADDRESS, { ...ALL_ENTRY, readlist: TECH.slug }]]), readlists: [DEFAULT_READLIST, TECH], state: { sender: [TLDR] }, notification: true });
		const current = toGmailPageViewModel(page);
		assert.equal(current.readlistPicker.choiceLabel, "All, Tech");
		assert.equal(current.save.disabled, false);
		assert.equal(current.save.offerImport, false);
		const missing = toGmailPageViewModel({ ...page, destinations: new Map() });
		assert.equal(missing.readlistPicker.choiceLabel, "All");
		assert.equal(missing.save.disabled, false);
	});

	it("requires notification confirmation for a legacy filtered sender without destinations", () => {
		const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };
		const vm = toGmailPageViewModel(input({
			senders: [{ ...mapped(TLDR), mappedAddresses: undefined, mappedAt: undefined }],
			readlists: [DEFAULT_READLIST, TECH],
			state: { sender: [TLDR] },
			notification: true,
		}));
		assert.equal(vm.readlistPicker.choiceLabel, "All");
		assert.equal(vm.readlistPicker.confirmLabel, "Confirm readlists");
		assert.equal(vm.pickerState.readlist_choice_for, TLDR);
		assert.equal(vm.save.disabled, true);
		assert.equal(vm.save.offerImport, false);
	});

	it("preselects every saved destination before its filter timestamp is written", () => {
		const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };
		const WORK = { slug: ReadlistSlugSchema.parse("work"), label: "Work" };
		const workAddress = InboxAddressSchema.parse("work-c9d4e1@read.place");
		const page = input({
			senders: [{ ...mapped(TLDR), addedToFilterAt: undefined, mappedAddresses: [ALL_ADDRESS, workAddress] }],
			destinations: new Map([[ALL_ADDRESS, { ...ALL_ENTRY, readlist: TECH.slug }], [workAddress, { ...ALL_ENTRY, address: workAddress, readlist: WORK.slug }]]),
			readlists: [DEFAULT_READLIST, TECH, WORK],
			state: { sender: [TLDR] },
			notification: true,
		});
		const vm = toGmailPageViewModel(page);
		assert.equal(vm.readlistPicker.choiceLabel, "All, Tech, Work");
		assert.deepEqual(vm.readlistPicker.options.map((option) => option.selected), [true, true, true]);
		assert.equal(vm.pickerState.readlist_choice_for, undefined);
		assert.equal(vm.save.disabled, false);
		assert.equal(vm.save.offerImport, true);
		assert.equal(toGmailPageViewModel({ ...page, state: { sender: [TLDR], readlist_choice_for: TLDR } }).save.disabled, false);
	});

	it.each(["readlist_invalid", "readlist_name_invalid", "readlist_limit"])("opens the readlist picker for %s", (error) => {
		assert.equal(toGmailPageViewModel(input({ state: { sender: [TLDR] }, error })).readlistPicker.open, true);
	});

	it("keeps the readlist picker closed when a mapping is opened for editing", () => {
		const vm = toGmailPageViewModel(input({ senders: [mapped(TLDR)], destinations: new Map([[ALL_ADDRESS, ALL_ENTRY]]), state: { sender: [TLDR], edit: "1" } }));
		assert.deepEqual([vm.dialog.mode, vm.readlistPicker.open], ["edit", false]);
	});

	it("keeps the picker closed for other errors and ignores unknown banner keys", () => {
		const vm = toGmailPageViewModel(input({ state: { sender: [TLDR] }, error: "sender_unknown", notice: "nonsense" }));
		assert.equal(vm.readlistPicker.open, false);
		assert.deepEqual(vm.alerts.map((alert) => alert.key), ["sender_unknown"]);
		assert.deepEqual(vm.notices, []);
	});

	it("keeps a notice's ordinary copy during Step 2 when it has no confirmation variant", () => {
		const vm = toGmailPageViewModel(input({ connection: connection({ forwardingConfirmedAt: undefined }), notice: "readlist_created" }));
		assert.deepEqual(vm.notices, [{ key: "readlist_created", message: "Readlist created. Save the newsletter to use it.", variant: "success" }]);
	});
});

describe("GMail Newsletters shared choice for ticked senders", () => {
	const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };

	it("takes readlists and delivery from the one ticked sender that is already saved", () => {
		const vm = toGmailPageViewModel(input({
			senders: [{ ...mapped(TLDR), deliveryMode: "issue" }],
			destinations: new Map([[ALL_ADDRESS, { ...ALL_ENTRY, readlist: TECH.slug }]]),
			readlists: [DEFAULT_READLIST, TECH],
			state: { sender: [TLDR, BREW] },
		}));
		assert.equal(vm.readlistPicker.choiceLabel, "All, Tech");
		assert.deepEqual(vm.delivery.options.map((option) => [option.value, option.checked]), [["issue", true], ["links", false], ["both", false]]);
		assert.deepEqual(vm.pickerState.readlist, ["default", "tech"]);
		assert.equal(vm.save.offerImport, true);
	});

	it("falls back to All when more than one ticked sender is saved and offers no import for them", () => {
		const vm = toGmailPageViewModel(input({
			senders: [mapped(TLDR), mapped(BREW)],
			destinations: new Map([[ALL_ADDRESS, { ...ALL_ENTRY, readlist: TECH.slug }]]),
			readlists: [DEFAULT_READLIST, TECH],
			state: { sender: [TLDR, BREW] },
		}));
		assert.equal(vm.readlistPicker.choiceLabel, "All");
		assert.equal(vm.save.offerImport, false);
	});

	it("keeps the readlist choice as given while nothing is ticked", () => {
		assert.deepEqual(toGmailPageViewModel(input({ readlists: [DEFAULT_READLIST, TECH], state: { readlist: ["tech"] } })).pickerState.readlist, ["tech"]);
		assert.equal(toGmailPageViewModel(input()).pickerState.readlist, undefined);
	});

	it("leaves the ticks and the typed search out of the scripted search and the mapping form fields, and the ticks out of the poll", () => {
		const vm = toGmailPageViewModel(input({
			discovery: { state: "running", mode: "full", checkedMessageCount: 10 },
			detection: recognised([[TLDR, "TLDR"]]),
			state: { sender: [TLDR], added: [BREW], search: "tl" },
		}));
		assert.deepEqual(vm.readlistPicker.fields.map((field) => field.name), ["discovery", "utm_source", "utm_medium", "utm_content"]);
		assert.deepEqual(vm.searchFields.map((field) => field.name), ["readlist", "discovery", "utm_source", "utm_medium", "utm_content"]);
		assert.equal(vm.status.pollUrl, "/newsletters/gmail/senders?search=tl&readlist=default&discovery=started&poll=1");
	});
});

describe("GMail Newsletters newly found newsletters", () => {
	const knownMailbox = { discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW, name: undefined }], detection: recognised([[TLDR, "TLDR"], [BREW, "Morning Brew"]]) };

	it.each([
		[undefined, []],
		[2, []],
		[3, []],
		[1, ["Show 1 newly found newsletter"]],
		[0, ["Show 2 newly found newsletters"]],
	])("offers a refresh for a poll that listed %s rows", (listed, labels) => {
		const vm = toGmailPageViewModel(input({ ...knownMailbox, listed }));
		assert.deepEqual(vm.status.refreshActions.map((action) => action.label), labels);
	});
});

describe("GMail Newsletters saved notice", () => {
	it("counts the saved newsletters, with the confirmation variant during Step 2", () => {
		assert.deepEqual(toGmailPageViewModel(input({ notice: "senders_saved", saved: 3 })).notices.map((notice) => notice.message), [
			"3 newsletters saved. Gmail will forward their new issues, and what you chose to save goes to All and any readlists you picked.",
		]);
		const awaiting = toGmailPageViewModel(input({ notice: "senders_saved", saved: 2, connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.deepEqual(awaiting.notices.map((notice) => notice.message), ["2 newsletters saved. Their new issues will be forwarded once Gmail confirms the forwarding address."]);
	});

	it("tells a reader who changed a newsletter during Step 2 that forwarding waits on Gmail's confirmation", () => {
		const awaiting = toGmailPageViewModel(input({ notice: "sender_remapped", connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.deepEqual(awaiting.notices, [
			{ key: "sender_remapped", message: "Newsletter updated. Its new issues will be forwarded once Gmail confirms the forwarding address.", variant: "success" },
		]);
	});

	it("says the newsletters stay in place when it asks to reconnect for access to senders", () => {
		assert.equal(
			toGmailPageViewModel(input({ metadataScopeGranted: false })).metadataReconnect.message,
			"Reconnect Gmail to choose senders from your mailbox. The newsletters you set up stay in place.",
		);
	});

	it("shows no count notice without a count", () => {
		assert.deepEqual(toGmailPageViewModel(input({ notice: "senders_saved" })).notices, []);
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

describe("GMail Newsletters popup", () => {
	const editing = { senders: [mapped(TLDR)], destinations: new Map([[ALL_ADDRESS, ALL_ENTRY]]), detection: recognised([[TLDR, "TLDR"]]) };

	it.each<[string, Partial<GmailPageInput>, string]>([
		["a page with nothing open", {}, "none"],
		["add=1", { state: { add: "1" } }, "add"],
		["the notification email link", { state: { sender: [BREW] }, notification: true }, "add"],
		["edit=1 for a mapped newsletter", { ...editing, state: { sender: [TLDR], edit: "1" } }, "edit"],
		["edit=1 for a sender that is not mapped", { state: { sender: [BREW], edit: "1" } }, "add"],
		["edit=1 for two ticked senders", { ...editing, state: { sender: [TLDR, BREW], edit: "1" } }, "add"],
		["add=1 while Gmail needs reconnecting for senders", { state: { add: "1" }, metadataScopeGranted: false }, "none"],
	])("resolves %s to the %s popup", (_name, overrides, mode) => {
		assert.equal(toGmailPageViewModel(input(overrides)).dialog.mode, mode);
	});

	it("carries the resolved mode in every form and link the popup emits", () => {
		const notified = toGmailPageViewModel(input({ state: { sender: [BREW] }, notification: true }));
		assert.deepEqual([notified.pickerState.add, notified.pickerState.edit], ["1", undefined]);
		assert.equal(new URL(notified.pageUrl, "https://readplace.com").searchParams.get("add"), "1");
		assert.equal(notified.searchFields.find((field) => field.name === "add")?.value, "1");
		const edit = toGmailPageViewModel(input({ ...editing, state: { sender: [TLDR], edit: "1", add: "1" } }));
		assert.deepEqual([edit.pickerState.add, edit.pickerState.edit], [undefined, "1"]);
		assert.deepEqual(edit.readlistPicker.fields.filter((field) => field.name === "edit" || field.name === "add").map((field) => `${field.name}=${field.value}`), ["edit=1"]);
		const unmapped = toGmailPageViewModel(input({ state: { sender: [BREW], edit: "1" } }));
		assert.deepEqual([unmapped.pickerState.add, unmapped.pickerState.edit], ["1", undefined]);
	});

	it("titles the popup by what it does and remembers the control that opened it", () => {
		const add = toGmailPageViewModel(input({ state: { add: "1" } })).dialog;
		assert.deepEqual([add.key, add.title, add.opener, add.senderFields], ["gmail-add", "Add newsletters", "add", []]);
		const edit = toGmailPageViewModel(input({ ...editing, state: { sender: [TLDR], edit: "1" } })).dialog;
		assert.deepEqual([edit.key, edit.title, edit.opener, edit.senderFields], ["gmail-edit", "Edit TLDR", TLDR, [{ name: "sender", value: TLDR }]]);
		const searching = toGmailPageViewModel(input({ ...editing, state: { sender: [TLDR], edit: "1", search: "tl" } })).dialog;
		assert.deepEqual(searching.senderFields, [{ name: "sender", value: TLDR }, { name: "search", value: "tl" }]);
		const unnamed = toGmailPageViewModel(input({ ...editing, discoveredSenders: [], detection: recognised([]), state: { sender: [TLDR], edit: "1" } })).dialog;
		assert.equal(unnamed.title, `Edit ${TLDR}`);
	});

	it("closes to the search with the page's own notice, leaving the popup's error behind", () => {
		const closeParams = (pageInput: GmailPageInput) => {
			const dialog = toGmailPageViewModel(pageInput).dialog;
			return [dialog.closeHref, dialog.cancelHref].map((href) => Object.fromEntries(new URL(href, "https://readplace.com").searchParams));
		};
		const tracked = (content: string) => ({ utm_source: "integrations-gmail", utm_medium: "internal", utm_content: content });
		assert.deepEqual(closeParams(input({ state: { add: "1", search: "tl", sender: [TLDR] }, notice: "senders_saved", saved: 2, error: "sender_unknown" })), [
			{ notice: "senders_saved", saved: "2", search: "tl", discovery: "started", ...tracked("close-dialog") },
			{ notice: "senders_saved", saved: "2", search: "tl", discovery: "started", ...tracked("cancel-dialog") },
		]);
		assert.deepEqual(closeParams(input({ state: { add: "1" }, notice: "readlist_created", error: "import_revoked" }))[0], {
			error: "import_revoked", discovery: "started", ...tracked("close-dialog"),
		});
	});

	it("shows the popup's own banners inside it while it is open and on the page while it is not", () => {
		const banners = (pageInput: GmailPageInput) => {
			const vm = toGmailPageViewModel(pageInput);
			return {
				page: [...vm.alerts, ...vm.notices].map((banner) => banner.key),
				dialog: [...vm.dialog.alerts, ...vm.dialog.notices].map((banner) => banner.key),
			};
		};
		for (const error of ["readlist_invalid", "readlist_name_invalid", "readlist_limit", "sender_invalid", "sender_unknown", "readlist_choice_required"]) {
			assert.deepEqual(banners(input({ state: { add: "1" }, error })), { page: [], dialog: [error] });
			assert.deepEqual(banners(input({ error })), { page: [error], dialog: [] });
		}
		for (const notice of ["readlist_created", "readlist_reused"]) {
			assert.deepEqual(banners(input({ state: { add: "1" }, notice })), { page: [], dialog: [notice] });
		}
		assert.deepEqual(banners(input({ state: { add: "1" }, error: "import_in_progress", notice: "sender_mapped" })), { page: ["import_in_progress", "sender_mapped"], dialog: [] });
	});

	it("opens on exactly one control, and on none when the request only refreshes the popup", () => {
		const focused = (pageInput: GmailPageInput) => {
			const vm = toGmailPageViewModel(pageInput);
			return {
				save: vm.save.autofocus,
				rows: vm.checklist.groups.flatMap((group) => group.rows.filter((row) => row.autofocus).map((row) => row.email)),
				search: vm.senderPicker.searchAutofocus,
				pickerOpen: vm.senderPicker.open,
			};
		};
		const known = { discoveredSenders: [{ email: TLDR, name: "TLDR" }, { email: BREW, name: undefined }], detection: recognised([[TLDR, "TLDR"], [BREW, "Morning Brew"]]) };
		assert.deepEqual(focused(input({ ...editing, state: { sender: [TLDR], edit: "1" } })), { save: true, rows: [], search: false, pickerOpen: false });
		assert.deepEqual(focused(input({ ...known, state: { sender: [TLDR] }, notification: true })), { save: false, rows: [TLDR], search: false, pickerOpen: false });
		assert.deepEqual(focused(input({ ...known, state: { add: "1" } })), { save: false, rows: [BREW], search: false, pickerOpen: false });
		assert.deepEqual(focused(input({ discoveredSenders: [], state: { add: "1" } })), { save: false, rows: [], search: true, pickerOpen: true });
		assert.deepEqual(focused(input({ ...known, state: { add: "1" }, focusOnOpen: false })), { save: false, rows: [], search: false, pickerOpen: false });
		assert.deepEqual(focused(input({ ...editing, state: { sender: [TLDR], edit: "1" }, focusOnOpen: false })), { save: false, rows: [], search: false, pickerOpen: false });
		assert.deepEqual(focused(input({ ...known })), { save: false, rows: [], search: false, pickerOpen: false });
	});

	it("places Add newsletters beside the title once newsletters are listed, and under the empty list before", () => {
		const placement = (pageInput: GmailPageInput) => {
			const mappings = toGmailPageViewModel(pageInput).mappings;
			return [mappings.headerActions.map((action) => action.label), mappings.emptyActions.map((action) => action.label)];
		};
		assert.deepEqual(placement(input()), [[], ["Add newsletters"]]);
		assert.deepEqual(placement(input(editing)), [["Add newsletters"], []]);
	});

	it("opens Add newsletters with the search, starting discovery only if the page has not", () => {
		const fields = (pageInput: GmailPageInput) =>
			toGmailPageViewModel(pageInput).mappings.emptyActions.flatMap((action) => action.fields.map((field) => `${field.name}=${field.value}`));
		assert.deepEqual(fields(input({ state: { search: "tl", sender: [TLDR] } })), ["search=tl", "add=1", "utm_source=integrations-gmail", "utm_medium=internal", "utm_content=add-newsletters"]);
		assert.deepEqual(fields(input({ state: { discovery_after: "none" }, discoveryStarted: true })), ["add=1", "discovery=started", "discovery_after=none", "utm_source=integrations-gmail", "utm_medium=internal", "utm_content=add-newsletters"]);
	});
});

describe("GMail Newsletters labelling permission", () => {
	it("asks a connected reader without modify permission to allow labelling and marking saved mail read", () => {
		const model = toGmailPageViewModel(input({ modifyScopeGranted: false }));

		expect(model.labelPermission?.message).toContain("imported-to-readplace");
		expect(model.labelPermission?.actions.map(({ label, fields }) => ({ label, fields }))).toEqual([
			{ label: "Allow labelling", fields: [{ name: "intent", value: "label" }] },
		]);
	});

	it("asks nothing once the reader has allowed it", () => {
		expect(toGmailPageViewModel(input({ modifyScopeGranted: true })).labelPermission).toBeUndefined();
	});

	it("asks nothing while the connection itself must be reconnected", () => {
		const model = toGmailPageViewModel(input({ modifyScopeGranted: false, connection: connection({ revokedAt: "2026-10-01T00:00:00.000Z" }) }));

		expect(model.labelPermission).toBeUndefined();
	});

	it("offers an upgrade instead of the grant to a reader whose plan cannot use Gmail", () => {
		const model = toGmailPageViewModel(input({ modifyScopeGranted: false, canConnectGmail: false }));

		expect(model.labelPermission?.actions.map(({ label }) => label)).toEqual(["Upgrade"]);
	});
});
