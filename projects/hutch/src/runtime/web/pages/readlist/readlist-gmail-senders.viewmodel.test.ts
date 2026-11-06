import assert from "node:assert/strict";
import type { GmailConnection, GmailDiscovery, GmailMapping } from "@packages/domain/gmail";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { AliasNameSchema, type InboxAddressEntry, InboxAddressSchema, InboxTokenSchema } from "@packages/domain/inbox";
import { NewsletterNameSchema } from "@packages/domain/newsletter-catalog";
import { DEFAULT_READLIST, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { UpgradeOffer } from "../../shared/upgrade-offer/upgrade-offer";
import { parseReadlistGmailSelection } from "./readlist-gmail-senders.url";
import {
	gmailSenderRoutingFor,
	type ReadlistGmailSendersInput,
	readlistGmailSectionState,
	toReadlistGmailSenders,
} from "./readlist-gmail-senders.viewmodel";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const OFFER: UpgradeOffer = { popoverId: "subscribe-plans", plansPath: "/account/plans", checkedPlan: "yearly" };
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const ALL_ADDRESS = InboxAddressSchema.parse("gmail-b8c3d0@read.place");
const DESIGN_ADDRESS = InboxAddressSchema.parse("gmail-c9d4e1@read.place");
const TECH_ADDRESS = InboxAddressSchema.parse("gmail-d0e5f2@read.place");
const MISSING_ADDRESS = InboxAddressSchema.parse("gmail-e1f6a3@read.place");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const BYTES = ForwardableSenderSchema.parse("hi@bytes.dev");
const AUNT = ForwardableSenderSchema.parse("aunt@example.com");
const LOST = ForwardableSenderSchema.parse("lost@example.com");
const DESIGN = { slug: ReadlistSlugSchema.parse("design"), label: "Design" };
const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };

function connection(overrides: Partial<GmailConnection> = {}): GmailConnection {
	return {
		userId: USER, gatewayAddress: GATEWAY, accountEmail: ACCOUNT,
		connectedAt: "2026-08-27T00:00:00.000Z", forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
		lastConfirmError: undefined,
		filterCount: 1, filterSenderCount: 1, filterUpdatedAt: "2026-08-28T00:00:00.000Z",
		lastFilterError: undefined, revokedAt: undefined, revokedReason: undefined,
		disconnectRequestedAt: undefined, ...overrides,
	};
}

function mapping(senderEmail: typeof TLDR, overrides: Partial<GmailMapping> = {}): GmailMapping {
	return {
		accountEmail: ACCOUNT, senderEmail,
		addedToFilterAt: "2026-08-27T00:06:00.000Z", mappedAddresses: [ALL_ADDRESS], mappedAt: "2026-08-27T00:06:00.000Z",
		deliveryMode: "links", markImportedAt: undefined, ...overrides,
	};
}

function entry(address: typeof ALL_ADDRESS, readlist: InboxAddressEntry["readlist"]): InboxAddressEntry {
	return {
		address, userId: USER, name: AliasNameSchema.parse("gmail"),
		token: InboxTokenSchema.parse(address.slice(6, 12)), createdAt: "2026-08-27T00:00:00.000Z",
		disabledAt: undefined, purpose: "gmail-readlist", readlist,
	};
}

const DESTINATIONS = new Map<string, InboxAddressEntry>([
	[ALL_ADDRESS, entry(ALL_ADDRESS, undefined)],
	[DESIGN_ADDRESS, entry(DESIGN_ADDRESS, DESIGN.slug)],
	[TECH_ADDRESS, entry(TECH_ADDRESS, TECH.slug)],
]);

function discovery(overrides: Partial<GmailDiscovery> = {}): GmailDiscovery {
	return {
		userId: USER, accountEmail: ACCOUNT, gatewayAddress: GATEWAY, generation: "generation-1",
		state: "complete", mode: "full", page: 1, pageToken: undefined, historyId: undefined,
		scannedCount: 6, checkedMessageCount: 6, estimatedTotalMessages: undefined, oldestScannedAt: undefined,
		updatedAt: "2026-08-28T00:00:00.000Z", error: undefined, ...overrides,
	};
}

function recognised(entries: [typeof TLDR, string][]): ReadlistGmailSendersInput["detection"] {
	return {
		status: "available",
		recognized: new Map(entries.map(([from, name]) => [from, { from, name: NewsletterNameSchema.parse(name), source: "catalog" as const, match: "exact" as const }])),
	};
}

function input(overrides: Partial<ReadlistGmailSendersInput> = {}): ReadlistGmailSendersInput {
	return {
		userId: USER,
		offer: undefined,
		readlist: DESIGN,
		readlists: [DEFAULT_READLIST, DESIGN, TECH],
		canConnectGmail: true,
		connection: connection(),
		metadataScopeGranted: true,
		discovery: discovery(),
		discoveredSenders: [
			{ email: TLDR, name: "TLDR" }, { email: BREW, name: "Morning Brew" }, { email: BYTES, name: "Bytes" },
			{ email: AUNT, name: "Aunt May" }, { email: LOST, name: "Lost" },
		],
		mappings: [
			mapping(TLDR, { mappedAddresses: [ALL_ADDRESS, DESIGN_ADDRESS] }),
			mapping(BREW, { mappedAddresses: [ALL_ADDRESS, TECH_ADDRESS] }),
			mapping(LOST, { mappedAddresses: [MISSING_ADDRESS] }),
		],
		destinations: DESTINATIONS,
		detection: recognised([[TLDR, "TLDR"], [BREW, "Morning Brew"], [BYTES, "Bytes"]]),
		selection: parseReadlistGmailSelection({}),
		listed: undefined,
		pollCount: 0,
		...overrides,
	};
}

function picker(vm: ReturnType<typeof toReadlistGmailSenders>) {
	assert(vm.picker, "the picker must be built");
	return vm.picker;
}

function groupEmails(vm: ReturnType<typeof toReadlistGmailSenders>) {
	return picker(vm).checklist.groups.map((group) => ({ key: group.key, title: group.title, rows: group.rows.map((row) => [row.email, row.checked, row.notes]) }));
}

describe("readlistGmailSectionState", () => {
	it.each([
		["disconnected, can connect", { connection: undefined }, "connect"],
		["disconnected, cannot connect", { connection: undefined, canConnectGmail: false }, "upgrade"],
		["disconnecting", { connection: connection({ disconnectRequestedAt: "2026-08-29T00:00:00.000Z" }) }, "disconnecting"],
		["revoked", { connection: connection({ revokedAt: "2026-08-29T00:00:00.000Z" }) }, "reconnect"],
		["filter failed", { connection: connection({ lastFilterError: { code: "rejected", message: "nope", at: "2026-08-29T00:00:00.000Z" } }) }, "filter-failed"],
		["confirm failed", { connection: connection({ forwardingConfirmedAt: undefined, lastConfirmError: { reason: "not-confirmed", at: "2026-08-29T00:00:00.000Z" } }) }, "awaiting"],
		["awaiting confirmation", { connection: connection({ forwardingConfirmedAt: undefined }) }, "awaiting"],
		["ready to filter", { connection: connection({ filterCount: 0 }) }, "picker"],
		["filtering", {}, "picker"],
		["filtering without an account email", { connection: connection({ accountEmail: undefined }) }, "reconnect"],
		["filtering without the metadata scope", { metadataScopeGranted: false }, "reconnect"],
		["filtering after a same-mailbox discovery asked to reconnect", { discovery: discovery({ requiresReconnect: true }) }, "reconnect"],
		["filtering with no discovery", { discovery: undefined }, "picker"],
	] as const)("%s", (_name, overrides, expected) => {
		assert.equal(readlistGmailSectionState(input(overrides)), expected);
	});
});

describe("toReadlistGmailSenders section copy", () => {
	it("offers the Upgrade prompt when the reader cannot connect Gmail", () => {
		const vm = toReadlistGmailSenders(input({ connection: undefined, canConnectGmail: false }));
		assert.equal(vm.sectionClass, "readlist-gmail--upgrade");
		assert.equal(vm.picker, undefined);
		assert.equal(vm.prompt?.actions.length, 1);
	});

	it("keeps the Upgrade link for a reader on a surface with no offer", () => {
		const vm = toReadlistGmailSenders(input({ connection: undefined, canConnectGmail: false }));
		assert.deepEqual(vm.prompt?.locks, []);
		assert.deepEqual(vm.prompt?.actions.map((action) => [action.key, action.method]), [["upgrade-gmail", "GET"]]);
	});

	it.each([
		["disconnected", { connection: undefined }, "Connect Gmail"],
		["revoked", { connection: connection({ revokedAt: "2026-08-27T01:00:00.000Z", revokedReason: "invalid-grant" }) }, "Reconnect Gmail"],
		["missing sender access", { metadataScopeGranted: false }, "Reconnect Gmail"],
	] as const)("shows the connect-gmail lock in place of the Upgrade link when %s", (_state, overrides, label) => {
		const vm = toReadlistGmailSenders(input({ ...overrides, canConnectGmail: false, offer: OFFER }));
		assert.deepEqual(vm.prompt?.actions, []);
		assert.equal(vm.prompt?.locks.length, 1);
		assert.match(String(vm.prompt?.locks[0]), /data-test-needs-upgrade="connect-gmail"/);
		assert.match(String(vm.prompt?.locks[0]), new RegExp(label));
	});

	it("offers Connect Gmail behind the disclaimer", () => {
		const vm = toReadlistGmailSenders(input({ connection: undefined }));
		assert.deepEqual(vm.connect, {
			label: "Connect Gmail",
			disclaimer: { confirmPopoverId: vm.connect?.disclaimer.confirmPopoverId, href: "/newsletters/gmail/connect?utm_source=queue-preferences&utm_medium=internal&utm_content=connect-gmail" },
		});
		assert.equal(vm.pageUrl, "/queue/queues/design/preferences?gmail_selection=1#readlist-gmail-senders");
	});

	it("says Gmail is disconnecting", () => {
		const vm = toReadlistGmailSenders(input({ connection: connection({ disconnectRequestedAt: "2026-08-29T00:00:00.000Z" }) }));
		assert.deepEqual(vm.notes, ["Gmail is disconnecting. Connect it again once it finishes."]);
	});

	it("asks a revoked reader to reconnect to keep forwarding", () => {
		const vm = toReadlistGmailSenders(input({ connection: connection({ revokedAt: "2026-08-29T00:00:00.000Z" }) }));
		assert.equal(vm.prompt?.message, "Google ended the connection. Reconnect to keep forwarding newsletters.");
	});

	it("asks a reader without sender access to reconnect to choose senders", () => {
		const vm = toReadlistGmailSenders(input({ metadataScopeGranted: false }));
		assert.equal(vm.prompt?.message, "Reconnect Gmail to choose senders from your mailbox. The newsletters you set up stay in place.");
	});

	it("shows the confirmation failure and a tracked Finish setup link while forwarding is unconfirmed", () => {
		const vm = toReadlistGmailSenders(input({ connection: connection({ forwardingConfirmedAt: undefined, lastConfirmError: { reason: "not-confirmed", at: "2026-08-29T00:00:00.000Z" } }) }));
		assert.match(vm.notes[0], /^I opened Google's confirmation link/);
		assert.deepEqual(vm.links, [{ key: "finish-gmail-setup", label: "Finish setup", href: "/newsletters/gmail?utm_source=queue-preferences&utm_medium=internal&utm_content=finish-gmail-setup" }]);
		assert.equal(picker(vm).checklist.total, 3);
	});

	it("shows the waiting message while forwarding is unconfirmed without an error", () => {
		const vm = toReadlistGmailSenders(input({ connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.equal(vm.notes.length, 1);
		assert.equal(vm.links[0].key, "finish-gmail-setup");
	});

	it("shows the filter error and a link to the Gmail page", () => {
		const vm = toReadlistGmailSenders(input({ connection: connection({ lastFilterError: { code: "rejected", message: "nope", at: "2026-08-29T00:00:00.000Z" } }) }));
		assert.equal(vm.notes.length, 1);
		assert.equal(vm.links[0].href, "/newsletters/gmail?utm_source=queue-preferences&utm_medium=internal&utm_content=open-gmail-newsletters");
	});

	it("words the lede by whether the readlist has a purpose", () => {
		assert.equal(toReadlistGmailSenders(input()).lede, "New issues from the Gmail newsletters you tick here are saved to All and Design.");
		assert.equal(
			toReadlistGmailSenders(input({ readlist: { ...DESIGN, purpose: "Design systems" } })).lede,
			"New issues from the Gmail newsletters you tick here are saved to All. The ones that fit are also saved to Design.",
		);
	});
});

describe("toReadlistGmailSenders checklist", () => {
	it("ticks the senders routed here when the selection marker is absent, and notes where the others go", () => {
		const vm = toReadlistGmailSenders(input());
		assert.deepEqual(groupEmails(vm), [
			{ key: "here", title: "In Design", rows: [[TLDR, true, []]] },
			{ key: "elsewhere", title: "In other readlists", rows: [[BREW, false, ["In All and Tech"]]] },
			{ key: "known", title: "Known newsletters", rows: [[BYTES, false, []]] },
		]);
		assert.deepEqual(picker(vm).checklist.groups[0].rows[0].fields, [{ name: "routed", value: TLDR }, { name: "shown", value: TLDR }]);
		assert.deepEqual(picker(vm).checklist.groups[1].rows[0].fields, [{ name: "shown", value: BREW }]);
		assert.equal(vm.links[0].key, "manage-gmail-newsletters");
		assert.equal(vm.pageUrl, `/queue/queues/design/preferences?gmail_selection=1&sender=${encodeURIComponent(TLDR)}#readlist-gmail-senders`);
	});

	it("ticks nothing when the marker is present with no senders", () => {
		const vm = toReadlistGmailSenders(input({ selection: parseReadlistGmailSelection({ gmail_selection: "1" }) }));
		assert.deepEqual(picker(vm).checklist.sender, []);
	});

	it("keeps the ticks a selection carries and lists no added senders", () => {
		const edited = parseReadlistGmailSelection({ gmail_selection: "1", sender: [BYTES, AUNT], added: [AUNT] });
		const vm = toReadlistGmailSenders(input({ selection: edited }));
		assert.deepEqual(picker(vm).checklist.sender, [BYTES]);
		assert.deepEqual(groupEmails(vm).map((group) => group.key), ["here", "elsewhere", "known"]);
	});

	it("saves straight away from the select toggle and from a search result", () => {
		const vm = picker(toReadlistGmailSenders(input()));
		assert.deepEqual(vm.checklist.actions, [{ key: "select", name: "select", value: "all", label: "Select all", formaction: vm.saveAction }]);
		assert.equal(vm.results.formaction, vm.saveAction);
	});

	it("offers to clear the selection once every listed sender is ticked", () => {
		const all = parseReadlistGmailSelection({ gmail_selection: "1", sender: [TLDR, BREW, BYTES] });
		const vm = picker(toReadlistGmailSenders(input({ selection: all })));
		assert.deepEqual(vm.checklist.actions.map((action) => action.label), ["Clear selection"]);
	});

	it("keeps the retry a lookup when the catalog is unavailable", () => {
		const vm = picker(toReadlistGmailSenders(input({ detection: { status: "unavailable" } })));
		assert.equal(vm.checklist.actions[0].formaction, undefined);
	});

	it("offers a retry when the catalog is unavailable", () => {
		const vm = toReadlistGmailSenders(input({ detection: { status: "unavailable" } }));
		assert.equal(picker(vm).checklist.actions[0].label, "Try again");
	});

	it("lists no toggle when there is nothing to list", () => {
		const vm = toReadlistGmailSenders(input({ discoveredSenders: [], mappings: [], detection: recognised([]) }));
		assert.deepEqual(picker(vm).checklist.actions, []);
	});
});

describe("toReadlistGmailSenders search and discovery", () => {
	it("searches senders elsewhere as addable, senders here as mapped, and never unresolved ones", () => {
		const vm = toReadlistGmailSenders(input({ selection: parseReadlistGmailSelection({ gmail_selection: "1", search: "e" }) }));
		const options = picker(vm).results.options.map((option) => option.email);
		assert.equal(options.includes(LOST), false);
		assert.equal(options.includes(BREW), true);
		assert.equal(picker(vm).senderPicker.open, true);
		assert.match(vm.pageUrl, /&search=e#/);
	});

	it("tracks every action and hidden field", () => {
		const vm = picker(toReadlistGmailSenders(input()));
		assert.equal(vm.saveAction, "/queue/queues/design/preferences/gmail?utm_source=queue-preferences&utm_medium=internal&utm_content=save-gmail-newsletters");
		assert.equal(vm.discoveryAction, "/queue/queues/design/preferences/gmail/discovery?utm_source=queue-preferences&utm_medium=internal&utm_content=load-gmail-senders");
		assert.deepEqual(vm.searchFields, [
			{ name: "gmail_selection", value: "1" },
			{ name: "utm_source", value: "queue-preferences" },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: "search-gmail-senders" },
		]);
		assert.deepEqual(vm.discoveryFields.slice(0, 2), [{ name: "gmail_selection", value: "1" }, { name: "sender", value: TLDR }]);
		assert.equal(vm.selectionFields.at(-1)?.value, "select-gmail-senders");
		assert.equal(vm.searchPath, "/queue/queues/design/preferences/gmail/senders");
	});

	it.each([
		[0, "every 3s"],
		[19, "every 3s"],
		[20, "every 15s"],
	])("polls the senders path after poll %i %s", (pollCount, trigger) => {
		const selection = parseReadlistGmailSelection({ gmail_selection: "1", discovery: "started", discovery_after: "2026-08-28T00:00:00.000Z" });
		const vm = picker(toReadlistGmailSenders(input({ selection, pollCount })));
		assert.equal(vm.status.pollUrl, `/queue/queues/design/preferences/gmail/senders?gmail_selection=1&discovery=started&discovery_after=2026-08-28T00%3A00%3A00.000Z&poll=${pollCount + 1}`);
		assert.equal(vm.status.pollTrigger, trigger);
	});

	it("stops polling after the last poll", () => {
		const selection = parseReadlistGmailSelection({ gmail_selection: "1", discovery: "started" });
		const vm = picker(toReadlistGmailSenders(input({ selection, discovery: undefined, pollCount: 260 })));
		assert.equal(vm.status.pollUrl, undefined);
	});

	it("loads a discovery of another mailbox as idle", () => {
		const vm = picker(toReadlistGmailSenders(input({ discovery: discovery({ accountEmail: GmailAccountEmailSchema.parse("other@gmail.com") }) })));
		assert.equal(vm.status.discoveryState, "idle");
	});
});

describe("gmailSenderRoutingFor", () => {
	it("routes each mapping by filter membership and destination", () => {
		const routing = gmailSenderRoutingFor({
			mappings: [
				mapping(TLDR, { mappedAddresses: [ALL_ADDRESS, DESIGN_ADDRESS] }),
				mapping(BYTES, { addedToFilterAt: undefined, mappedAddresses: undefined }),
				mapping(AUNT, { addedToFilterAt: undefined }),
				mapping(LOST, { mappedAddresses: undefined }),
			],
			userId: USER,
			destinations: DESTINATIONS,
			readlists: [DEFAULT_READLIST, DESIGN, TECH],
		});
		assert.deepEqual([...routing], [
			[TLDR, { kind: "routed", readlists: [DESIGN.slug], deliveryMode: "links" }],
			[BYTES, { kind: "unmapped", deliveryMode: "issue" }],
			[AUNT, { kind: "unrouted", deliveryMode: "links" }],
			[LOST, { kind: "unresolved" }],
		]);
	});
});
