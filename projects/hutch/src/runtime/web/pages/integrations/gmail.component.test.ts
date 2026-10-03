import assert from "node:assert/strict";
import type { GmailConnection } from "@packages/domain/gmail";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { DEFAULT_READLIST } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { parseHTML } from "linkedom";
import { GmailPage, renderGmailSenderResults } from "./gmail.component";
import type { GmailPageInput } from "./gmail.viewmodel";
import { toGmailPageViewModel } from "./gmail.viewmodel";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");

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
		discoveryStarted: false,
		discoveryPending: false,
		pollCount: 0,
		importsPollCount: 0,
		error: undefined,
		notice: undefined,
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
		const saving = pageDocument(input({ connection: awaiting, state: { sender: TLDR, readlist: "default" } }));
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
	it("keeps one page button and sends a matching out-of-band progress replacement", () => {
		const vm = toGmailPageViewModel(input({ discoveryStarted: true, discovery: { state: "running", mode: "full", checkedMessageCount: 200 } }));
		const page = parseHTML(GmailPage(vm).content.html).document;
		const pageButtons = Array.from(page.querySelectorAll("#gmail-load-senders-button"));
		assert.equal(pageButtons.length, 1);
		assert.equal(pageButtons[0]?.textContent, "Checking…");
		assert.equal(pageButtons[0]?.hasAttribute("hx-swap-oob"), false);
		const ordinary = fragmentDocument(renderGmailSenderResults(vm));
		assert.deepEqual(Array.from(ordinary.body.children, (element) => element.id), ["gmail-sender-results"]);
		const swapped = fragmentDocument(renderGmailSenderResults(vm, { outOfBandLoadButton: true, outOfBandState: false }));
		assert.deepEqual(Array.from(swapped.body.children, (element) => element.id), ["gmail-load-senders-button", "gmail-sender-results"]);
		assert.equal(swapped.querySelector("#gmail-load-senders-button")?.getAttribute("hx-swap-oob"), "outerHTML");
	});

	it("swaps in a neutral discovery Reconnect when Save already holds the amber CTA", () => {
		const requiresReconnect: GmailPageInput["discovery"] = { state: "failed", mode: "full", checkedMessageCount: 0, requiresReconnect: true };
		const saving = toGmailPageViewModel(input({ discovery: requiresReconnect, state: { sender: TLDR, readlist: "default" } }));
		const beside = fragmentDocument(renderGmailSenderResults(saving, { outOfBandLoadButton: true, outOfBandState: false }));
		assert.equal(beside.querySelector("[data-test-gmail-discovery-reconnect]")?.getAttribute("class"), "btn btn--neutral");
		const alone = fragmentDocument(renderGmailSenderResults(toGmailPageViewModel(input({ discovery: requiresReconnect }))));
		assert.equal(alone.querySelector("[data-test-gmail-discovery-reconnect]")?.getAttribute("class"), "btn btn--primary");
	});
});
