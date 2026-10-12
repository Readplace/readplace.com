import assert from "node:assert/strict";
import type { GmailConnection } from "@packages/domain/gmail";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { NewsletterNameSchema } from "@packages/domain/newsletter-catalog";
import { DEFAULT_READLIST, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { parseHTML } from "linkedom";
import { GmailPage, renderGmailSenderChecklist, renderGmailSenderResults, renderGmailSenderStatus } from "./gmail.component";
import type { GmailPageInput } from "./gmail.viewmodel";
import { toGmailPageViewModel } from "./gmail.viewmodel";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");

function connection(overrides: Partial<GmailConnection> = {}): GmailConnection {
	return {
		userId: USER, gatewayAddress: GATEWAY, accountEmail: undefined,
		connectedAt: "2026-08-27T00:00:00.000Z", forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
		lastConfirmError: undefined, filterCount: undefined, filterSenderCount: undefined, filterUpdatedAt: undefined,
		lastFilterError: undefined, revokedAt: undefined, revokedReason: undefined, disconnectRequestedAt: undefined,
		...overrides,
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
		discoveredSenders: [{ email: TLDR, name: "TLDR" }],
		discovery: { state: "complete", mode: "history", checkedMessageCount: 1 },
		detection: { status: "available", recognized: new Map() },
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
		...overrides,
	};
}

function pageDocument(pageInput: GmailPageInput) {
	return parseHTML(GmailPage(toGmailPageViewModel(pageInput)).content.html).document;
}

function fragmentDocument(html: string) {
	return parseHTML(`<html><body>${html}</body></html>`).document;
}

describe("GMail Newsletters forwarding confirmation step", () => {
	it("keeps Open Gmail the one amber CTA beside a ready save and a sender-access reconnect", () => {
		const awaiting = connection({ forwardingConfirmedAt: undefined });
		const saving = pageDocument(input({ connection: awaiting, state: { sender: [TLDR], readlist: "default" } }));
		assert.deepEqual(Array.from(saving.querySelectorAll(".btn--primary"), (button) => button.hasAttribute("data-test-gmail-open")), [true]);
		assert.equal(saving.querySelector("[data-test-gmail-save]")?.classList.contains("btn--neutral"), true);
		const reconnecting = pageDocument(input({ connection: awaiting, metadataScopeGranted: false }));
		assert.deepEqual(Array.from(reconnecting.querySelectorAll(".btn--primary"), (button) => button.hasAttribute("data-test-gmail-open")), [true]);
		assert.equal(reconnecting.querySelector("[data-test-gmail-metadata-reconnect-button]")?.classList.contains("btn--neutral"), true);
	});

	it("renders the poll line under step 2 for an unconfirmed connection", () => {
		const doc = pageDocument(input({ connection: connection({ forwardingConfirmedAt: undefined }) }));
		assert.equal(doc.querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get"), "/newsletters/gmail/status?poll=1&state=awaiting-confirmation");
	});
});

describe("GMail Newsletters discovery fragments", () => {
	it("keeps one page button and sends a matching out-of-band replacement ahead of the status", () => {
		const vm = toGmailPageViewModel(input({ discoveryStarted: true, discovery: { state: "running", mode: "full", checkedMessageCount: 200 } }));
		const page = parseHTML(GmailPage(vm).content.html).document;
		const pageButtons = Array.from(page.querySelectorAll("#gmail-load-senders-button"));
		assert.equal(pageButtons.length, 1);
		assert.equal(pageButtons[0]?.textContent, "Checking…");
		assert.equal(pageButtons[0]?.hasAttribute("hx-swap-oob"), false);
		const ordinary = fragmentDocument(renderGmailSenderStatus(vm, { outOfBandLoadButton: false }));
		assert.deepEqual(Array.from(ordinary.body.children, (element) => element.id), ["gmail-sender-status"]);
		const swapped = fragmentDocument(renderGmailSenderStatus(vm, { outOfBandLoadButton: true }));
		assert.deepEqual(Array.from(swapped.body.children, (element) => element.id), ["gmail-load-senders-button", "gmail-sender-status"]);
		assert.equal(swapped.querySelector("#gmail-load-senders-button")?.getAttribute("hx-swap-oob"), "outerHTML");
		assert.equal(swapped.querySelector("#gmail-sender-status")?.getAttribute("hx-include"), "#gmail-checklist-listed");
	});

	it("answers a search with the results alone, or with the mapping choice and mappings swapped out of band", () => {
		const vm = toGmailPageViewModel(input({ state: { search: "tl" } }));
		const ordinary = fragmentDocument(renderGmailSenderResults(vm, { outOfBandState: false }));
		assert.deepEqual(Array.from(ordinary.body.children, (element) => element.id), ["gmail-sender-results"]);
		const swapped = fragmentDocument(renderGmailSenderResults(vm, { outOfBandState: true }));
		assert.deepEqual(Array.from(swapped.body.children, (element) => [element.id, element.getAttribute("hx-swap-oob")]), [
			["gmail-sender-results", null],
			["gmail-mapping-choice", "outerHTML"],
			["gmail-mappings", "outerHTML"],
		]);
	});

	it("renders a search option as a pick button on the mapping form", () => {
		const doc = fragmentDocument(renderGmailSenderResults(toGmailPageViewModel(input()), { outOfBandState: false }));
		const option = doc.querySelector(`[data-test-gmail-sender-option="${TLDR}"]`);
		assert(option);
		assert.deepEqual(["form", "formmethod", "name", "value"].map((name) => option.getAttribute(name)), ["gmail-readlist-selection", "get", "pick", TLDR]);
		assert.equal(option.hasAttribute("formnovalidate"), true);
	});

	it("swaps in a neutral discovery Reconnect beside Save", () => {
		const requiresReconnect: GmailPageInput["discovery"] = { state: "failed", mode: "full", checkedMessageCount: 0, requiresReconnect: true };
		const status = fragmentDocument(renderGmailSenderStatus(toGmailPageViewModel(input({ discovery: requiresReconnect })), { outOfBandLoadButton: true }));
		assert.equal(status.querySelector("[data-test-gmail-discovery-reconnect]")?.getAttribute("class"), "btn btn--neutral");
	});

	it("submits the refresh for newly found newsletters through the mapping form", () => {
		const vm = toGmailPageViewModel(input({ detection: { status: "available", recognized: new Map([[TLDR, { from: TLDR, name: NewsletterNameSchema.parse("TLDR"), source: "catalog", match: "exact" }]]) }, listed: 0 }));
		const refresh = fragmentDocument(renderGmailSenderStatus(vm, { outOfBandLoadButton: false })).querySelector("[data-test-gmail-refresh-checklist]");
		assert(refresh);
		assert.equal(refresh.textContent, "Show 1 newly found newsletter");
		assert.deepEqual(["type", "form", "formmethod"].map((name) => refresh.getAttribute(name)), ["submit", "gmail-readlist-selection", "get"]);
	});
});

describe("GMail Newsletters checklist markup", () => {
	const mailbox = {
		discoveredSenders: [{ email: TLDR, name: "Dan" }, { email: BREW, name: undefined }],
		detection: { status: "available" as const, recognized: new Map([[TLDR, { from: TLDR, name: NewsletterNameSchema.parse("TLDR"), source: "catalog" as const, match: "exact" as const }]]) },
	};

	it("ties each row's checkbox to the mapping form and keeps an added sender's hidden field", () => {
		const doc = fragmentDocument(renderGmailSenderChecklist(toGmailPageViewModel(input({ ...mailbox, state: { added: [BREW] } }))));
		const rows = Array.from(doc.querySelectorAll("[data-test-gmail-checklist-row]"), (row) => {
			const box = row.querySelector("input[type=checkbox]");
			assert(box);
			return [
				row.closest("[data-test-gmail-checklist-group]")?.getAttribute("data-test-gmail-checklist-group"),
				box.getAttribute("form"), box.getAttribute("name"), box.getAttribute("value"), box.hasAttribute("checked"),
				row.querySelector("[data-test-gmail-checklist-name]")?.textContent ?? "",
				Array.from(row.querySelectorAll("input[type=hidden]"), (field) => `${field.getAttribute("form")}:${field.getAttribute("name")}=${field.getAttribute("value")}`).join(","),
			];
		});
		assert.deepEqual(rows, [
			["known", "gmail-readlist-selection", "sender", TLDR, false, "TLDR", ""],
			["added", "gmail-readlist-selection", "sender", BREW, false, "", `gmail-readlist-selection:added=${BREW}`],
		]);
		assert.equal(doc.querySelector("[data-test-gmail-checklist-summary]")?.textContent, " of 2 selected");
		assert.equal(doc.querySelector("#gmail-checklist-listed")?.getAttribute("value"), "1");
	});

	it("renders the toolbar toggle as a GET submit of the mapping form", () => {
		const doc = fragmentDocument(renderGmailSenderChecklist(toGmailPageViewModel(input({ ...mailbox, state: { sender: [TLDR] } }))));
		const toggle = doc.querySelector('[data-test-gmail-checklist-action="select"]');
		assert(toggle);
		assert.deepEqual(["form", "formmethod", "name", "value"].map((name) => toggle.getAttribute(name)), ["gmail-readlist-selection", "get", "select", "none"]);
		assert.equal(toggle.textContent, "Clear selection");
		assert.equal(doc.querySelector("[data-test-gmail-checklist]")?.getAttribute("data-checklist-state"), "listed");
	});

	it("renders Try again without a command name while the catalog is unavailable", () => {
		const doc = fragmentDocument(renderGmailSenderChecklist(toGmailPageViewModel(input({ detection: { status: "unavailable" } }))));
		const retry = doc.querySelector('[data-test-gmail-checklist-action="retry"]');
		assert(retry);
		assert.equal(retry.hasAttribute("name"), false);
		assert.equal(doc.querySelector("[data-test-gmail-checklist-message]")?.textContent, "Newsletter suggestions are unavailable right now. Try again, or search all your senders below.");
	});
});

describe("Gmail mandatory All and independent custom choices", () => {
	const TECH = { slug: ReadlistSlugSchema.parse("tech"), label: "Tech" };
	const SCIENCE = { slug: ReadlistSlugSchema.parse("science"), label: "Science" };

	it("locks All and enables an ordinary sender while custom lists remain optional", () => {
		const doc = pageDocument(input({ readlists: [DEFAULT_READLIST, TECH, SCIENCE], state: { sender: [TLDR] } }));
		const all = doc.querySelector('[data-test-gmail-readlist-option="default"]');
		assert(all);
		assert.equal(all.hasAttribute("checked"), true);
		assert.equal(all.hasAttribute("disabled"), true);
		assert.equal(doc.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled"), false);
		assert.equal(doc.querySelector("#gmail-readlist-choice")?.textContent, "All");
	});

	it("requires notification confirmation and keeps the pending sender in search and selection forms", () => {
		const doc = pageDocument(input({ readlists: [DEFAULT_READLIST, TECH], state: { sender: [TLDR] }, notification: true }));
		assert.equal(doc.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled"), true);
		assert.equal(doc.querySelector("[data-gmail-confirm-readlists]")?.textContent, "Confirm readlists");
		assert.deepEqual(Array.from(doc.querySelectorAll('#gmail-sender-search-form input[name="readlist_choice_for"], #gmail-readlist-selection input[name="readlist_choice_for"]'), (field) => field.getAttribute("value")), [TLDR, TLDR]);
		const confirm = doc.querySelector("[data-gmail-confirm-readlists]");
		assert.equal(confirm?.getAttribute("formmethod"), "get");
		assert.equal(confirm?.getAttribute("name"), "confirm_readlists");
		assert.equal(confirm?.getAttribute("value"), "1");
	});

	it("keeps repeated choices independent and shares a native form between confirmation, Save and Create", () => {
		const doc = pageDocument(input({ readlists: [DEFAULT_READLIST, TECH, SCIENCE], state: { sender: [TLDR], readlist: ["science", "tech", "tech"] } }));
		assert.equal(doc.querySelector("#gmail-readlist-choice")?.textContent, "All, Tech, Science");
		assert.deepEqual(Array.from(doc.querySelectorAll("[data-test-gmail-readlist-option]"), (field) => [field.getAttribute("value"), field.hasAttribute("checked")]), [["default", true], ["tech", true], ["science", true]]);
		const form = doc.querySelector("[data-test-gmail-save-mapping]");
		assert(form);
		assert.equal(form.getAttribute("method"), "GET");
		assert.equal(form.querySelector("[data-test-gmail-save]")?.getAttribute("formmethod"), "post");
		assert.equal(form.querySelector("[data-test-gmail-readlist-create] button")?.getAttribute("formmethod"), "post");
		assert.equal(form.querySelectorAll("form").length, 0);
	});

	it("makes Create the mapping form's default button ahead of the checklist and pick buttons, so Enter in the readlist name creates it", () => {
		const doc = pageDocument(input({ readlists: [DEFAULT_READLIST, TECH], state: { sender: [TLDR] } }));
		const first = Array.from(doc.querySelectorAll("button[type=submit]")).find((button) => button.getAttribute("form") === "gmail-readlist-selection" || button.closest("#gmail-readlist-selection") !== null);
		assert(first);
		assert.deepEqual(
			["formmethod", "formaction"].map((name) => first.getAttribute(name)),
			["post", doc.querySelector("[data-test-gmail-readlist-create] button")?.getAttribute("formaction")],
		);
		assert.equal(first.hasAttribute("hidden"), true);
	});
});
