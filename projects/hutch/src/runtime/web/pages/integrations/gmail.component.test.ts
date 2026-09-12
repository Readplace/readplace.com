import assert from "node:assert/strict";
import type { GmailConnection, GmailSenderEntry } from "@packages/domain/gmail";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import {
	AliasNameSchema,
	INBOX_ADDRESS_MAX_PER_USER,
	type InboxAddressEntry,
	InboxAddressSchema,
	InboxTokenSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { parseHTML } from "linkedom";
import { GmailPage, renderGmailSenderResults } from "./gmail.component";
import type { GmailPageInput } from "./gmail.viewmodel";
import { toGmailPageViewModel } from "./gmail.viewmodel";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const ALIAS = InboxAddressSchema.parse("tech-b8c3d0@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");

function connection(): GmailConnection {
	return {
		userId: USER,
		gatewayAddress: GATEWAY,
		accountEmail: undefined,
		connectedAt: "2026-08-27T00:00:00.000Z",
		forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
		filterCount: undefined,
		filterSenderCount: undefined,
		filterUpdatedAt: undefined,
		lastFilterError: undefined,
		revokedAt: undefined,
		revokedReason: undefined,
		disconnectRequestedAt: undefined,
	};
}

function inbox(input: { name: string; address: string; disabled?: boolean }): InboxAddressEntry {
	return {
		address: InboxAddressSchema.parse(input.address),
		userId: USER,
		name: AliasNameSchema.parse(input.name),
		token: InboxTokenSchema.parse(input.address.replace(/^[^-]+-/, "").replace(/@.*$/, "")),
		createdAt: "2026-08-27T00:00:00.000Z",
		disabledAt: input.disabled ? "2026-08-27T01:00:00.000Z" : undefined,
		purpose: "gmail-mapped",
		gmailConfirmedAt: undefined,
	};
}

function sender(input: { email?: string; mappedAddress?: string }): GmailSenderEntry {
	return {
		userId: USER,
		senderEmail: ForwardableSenderSchema.parse(input.email ?? TLDR),
		addedToFilterAt: "2026-08-27T00:06:00.000Z",
		firstSeenAt: undefined,
		lastSeenAt: undefined,
		seenCount: undefined,
		lastSubject: undefined,
		mappedAddress: input.mappedAddress === undefined ? undefined : InboxAddressSchema.parse(input.mappedAddress),
		mappedAt: undefined,
	};
}

function input(overrides: Partial<GmailPageInput> = {}): GmailPageInput {
	return {
		connection: connection(),
		senders: [],
		inboxes: [],
		gatewayLive: true,
		metadataScopeGranted: true,
		discoveredSenders: [{ email: TLDR, name: "TLDR" }],
		discovery: {
			state: "complete",
			mode: "history",
			scannedCount: 1,
			estimatedTotalMessages: undefined,
		},
		search: "",
		discoveryStarted: false,
		discoveryPending: false,
		...overrides,
	};
}

function pageDocument(pageInput: GmailPageInput) {
	return parseHTML(GmailPage(toGmailPageViewModel(pageInput)).content.html).document;
}

function fragmentDocument(html: string) {
	return parseHTML(`<html><body>${html}</body></html>`).document;
}

describe("Gmail sender mapping presentation", () => {
	it("renders the exact picker labels and creates an inbox from the final inline row", () => {
		const vm = toGmailPageViewModel(input({
			selectedSender: TLDR,
			selectedDestination: "new",
			inboxName: "Science Dispatches",
			error: "inbox_name_invalid",
			inboxes: [inbox({ name: "tech", address: ALIAS })],
		}));
		const doc = parseHTML(GmailPage(vm).content.html).document;
		assert.equal(doc.querySelector("[data-test-gmail-sender-label]")?.textContent, "Articles From ...");
		assert.equal(doc.querySelector("[data-test-gmail-destination-label]")?.textContent, "... are saved to ...");
		const picker = doc.querySelector("[data-test-gmail-inbox-picker]");
		assert(picker, "the destination picker must render for a selected sender");
		assert.equal(picker.hasAttribute("open"), true);
		assert.deepEqual(
			Array.from(picker.querySelectorAll("[data-test-gmail-destination-row]"), (row) => row.getAttribute("data-test-gmail-destination-row")),
			[ALIAS, "new"],
		);
		const createForm = picker.querySelector("[data-test-gmail-destination-create] form");
		assert(createForm, "the final destination row must carry the create-and-save form");
		assert.equal(createForm.getAttribute("action"), vm.saveAction);
		assert.deepEqual(
			Array.from(createForm.querySelectorAll('input[type="hidden"]'), (field) => [field.getAttribute("name"), field.getAttribute("value")]),
			[["sender", TLDR], ["destination", "new"]],
		);
		const name = createForm.querySelector("#gmail-inbox-name");
		assert(name, "the create row must carry its name field");
		assert.equal(name.getAttribute("name"), "inbox_name");
		assert.equal(name.getAttribute("value"), "Science Dispatches");
		assert.equal(name.hasAttribute("required"), true);
		const create = createForm.querySelector("[data-test-gmail-create-inbox]");
		assert(create, "the create row must carry its submit control");
		assert.equal(create.getAttribute("type"), "submit");
	});

	it("omits inline creation at the shared cap while preserving every existing choice", () => {
		const inboxes = Array.from({ length: INBOX_ADDRESS_MAX_PER_USER }, (_, index) => inbox({
			name: `inbox${index}`,
			address: `inbox${index}-${index.toString(16).padStart(6, "0")}@read.place`,
		}));
		const doc = pageDocument(input({ selectedSender: TLDR, inboxes }));
		const picker = doc.querySelector("[data-test-gmail-inbox-picker]");
		assert(picker, "the destination picker must render for a selected sender");
		assert.deepEqual(
			Array.from(picker.querySelectorAll("[data-test-gmail-destination-row]"), (row) => row.getAttribute("data-test-gmail-destination-row")),
			inboxes.map((entry) => entry.address),
		);
	});

	it("shows Exclude-only mapping cards and one tracked inbox-management control", () => {
		const doc = pageDocument(input({
			inboxes: [inbox({ name: "tech", address: ALIAS, disabled: true })],
			senders: [sender({ mappedAddress: ALIAS }), sender({ email: "legacy@example.com" })],
		}));
		const cards = Array.from(doc.querySelectorAll("[data-test-gmail-mapping]"));
		assert.equal(cards.length, 2);
		assert.equal(cards[0].querySelector("[data-test-gmail-mapping-source-label]")?.textContent, "Articles from");
		assert.equal(cards[0].querySelector("[data-test-gmail-mapping-destination-label]")?.textContent, "are saved to tech.");
		assert.equal(cards[0].querySelector("[data-test-gmail-mapping-disabled]")?.textContent, "Inbox disabled");
		const mappedSender = cards[0].querySelector("[data-test-gmail-mapped-sender]");
		assert(mappedSender, "the mapped sender must render");
		assert.equal(mappedSender.querySelector(".gmail__mapped-sender-email")?.tagName, "SPAN");
		assert.deepEqual(Array.from(mappedSender.querySelectorAll("button"), (button) => button.textContent?.trim()), ["Exclude"]);
		assert.equal(cards[1].querySelector("[data-test-gmail-mapping-destination-label]")?.textContent, "still need an inbox.");
		const manage = Array.from(doc.querySelectorAll("[data-test-gmail-manage-inboxes]"));
		assert.equal(manage.length, 1);
		assert.equal(manage[0].textContent, "Manage Your Inboxes");
		const manageUrl = new URL(manage[0].getAttribute("href") ?? "", "https://readplace.com");
		assert.equal(manageUrl.pathname, "/inbox/addresses");
		assert.equal(manageUrl.searchParams.get("utm_source"), "integrations-gmail");
		assert.equal(manageUrl.searchParams.get("utm_content"), "manage-inboxes");
	});
});

describe("Gmail sender discovery fragments", () => {
	it("keeps one page button and sends a matching out-of-band progress replacement", () => {
		const vm = toGmailPageViewModel(input({
			discoveryStarted: true,
			discovery: { state: "running", mode: "full", scannedCount: 200, estimatedTotalMessages: 500 },
		}));
		const page = parseHTML(GmailPage(vm).content.html).document;
		const pageButtons = Array.from(page.querySelectorAll("#gmail-load-senders-button"));
		assert.equal(pageButtons.length, 1);
		assert.equal(pageButtons[0].textContent, "Checking 200 of 500 messages…");
		assert.equal(pageButtons[0].hasAttribute("hx-swap-oob"), false);
		const discoveryForm = pageButtons[0].closest("form");
		assert(discoveryForm, "the page button must belong to the discovery form");
		assert.equal(discoveryForm.getAttribute("hx-select"), "#gmail-sender-results");
		assert.equal(discoveryForm.getAttribute("hx-select-oob"), "#gmail-load-senders-button:outerHTML");
		const ordinary = fragmentDocument(renderGmailSenderResults(vm));
		assert.deepEqual(Array.from(ordinary.body.children, (element) => element.id), ["gmail-sender-results"]);
		const swapped = fragmentDocument(renderGmailSenderResults(vm, { outOfBandLoadButton: true }));
		assert.deepEqual(Array.from(swapped.body.children, (element) => element.id), ["gmail-load-senders-button", "gmail-sender-results"]);
		const replacement = swapped.querySelector("#gmail-load-senders-button");
		assert(replacement, "the sender fragment must carry its load-button replacement");
		assert.equal(replacement.getAttribute("hx-swap-oob"), "outerHTML");
		assert.equal(replacement.textContent, "Checking 200 of 500 messages…");
	});
});
