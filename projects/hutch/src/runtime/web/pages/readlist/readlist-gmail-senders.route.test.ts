import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
	type DiscoveredGmailSender,
	type ForwardableSender,
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
} from "@packages/domain/gmail";
import { type InboxAddress, InboxAddressSchema } from "@packages/domain/inbox";
import { type NewsletterCatalogDocument, NewsletterCatalogDocumentSchema } from "@packages/domain/newsletter-catalog";
import { type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { GMAIL_SCOPES, GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const MORNING = ForwardableSenderSchema.parse("crew@morningbrew.com");
const EMAIL = GmailAccountEmailSchema.parse("reader@gmail.com");
const TECH = ReadlistSlugSchema.parse("tech");
const SCIENCE = ReadlistSlugSchema.parse("science");
const PREFERENCES = `/queue/queues/${TECH}/preferences`;
const SENDERS = `${PREFERENCES}/gmail/senders`;
const DISCOVERY = `${PREFERENCES}/gmail/discovery`;
const SAVE = `${PREFERENCES}/gmail`;
const UNKNOWN_READLIST = "/queue?queue_error=unknown_readlist";
const ONE_DAY_MS = 86_400_000;
const AT = "2026-09-30T00:00:00.000Z";
const DISCOVERED: DiscoveredGmailSender[] = [
	{ email: TLDR, name: "Dan at TLDR" },
	{ email: MORNING, name: "Brew Crew" },
];

function catalogOf(entries: readonly [ForwardableSender, string | undefined][]): NewsletterCatalogDocument {
	return NewsletterCatalogDocumentSchema.parse({
		version: 1,
		records: entries.map(([from, name]) => ({
			from,
			name,
			status: "approved",
			evidence: [{ kind: "seed", addedAt: AT }],
			createdAt: AT,
			updatedAt: AT,
		})),
	});
}

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

function section(doc: Document): Element {
	const element = doc.querySelector("[data-test-readlist-gmail-senders]");
	assert(element, "the Gmail newsletters section must render");
	return element;
}

function sectionState(doc: Document): string | null {
	return section(doc).getAttribute("data-test-gmail-senders-state");
}

function hiddenFields(form: Element): Record<string, string> {
	return Object.fromEntries(Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'), (input) => [input.name, input.value]));
}

function rootIds(doc: Document): (string | null)[] {
	return Array.from(doc.body.children, (element) => element.getAttribute("id"));
}

function checklistRows(doc: Document): [string | null, string | null, boolean][] {
	return Array.from(doc.querySelectorAll("#gmail-checklist [data-test-gmail-checklist-row]"), (element) => {
		const checkbox = element.querySelector("[data-test-gmail-checklist-sender]");
		assert(checkbox, "every checklist row must carry its checkbox");
		return [
			element.closest("[data-test-gmail-checklist-group]")?.getAttribute("data-test-gmail-checklist-group") ?? null,
			checkbox.getAttribute("value"),
			checkbox.hasAttribute("checked"),
		];
	});
}

function optionEmails(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-gmail-sender-option]"), (el) => el.getAttribute("data-test-gmail-sender-option"));
}

function locationParams(location: string): Record<string, string> {
	return Object.fromEntries(new URL(location, "https://readplace.com").searchParams);
}

function pageAlerts(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll('[data-test-alert-variant="error"]'), (el) => el.textContent);
}

function harnessWithGmail(options: { appNow?: () => Date } = {}) {
	const now = () => new Date();
	const gmail = initInMemoryGmailIntegration({
		grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
		addresses: initInMemoryInboxAddress({ now }),
		now,
	});
	const catalog = initInMemoryNewsletterCatalog(catalogOf([[MORNING, "Morning Brew"]]));
	const base = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const fixture = {
		...base,
		gmailIntegration: gmail.bundle,
		newsletterCatalog: {
			readNewsletterCatalog: catalog.readCatalog,
			writeNewsletterCatalog: catalog.writeCatalog,
			newsletterCatalogSeed: { version: 1 as const, entries: [] },
		},
	};
	if (options.appNow !== undefined) fixture.shared.now = options.appNow;
	const harness = useApp(fixture);
	return { harness, gmail, articleStore: base.articleStore };
}

async function seedDiscovery(input: {
	gmail: ReturnType<typeof harnessWithGmail>["gmail"];
	userId: UserId;
	gatewayAddress: InboxAddress;
	senders: DiscoveredGmailSender[];
	generation: string;
	state: "running" | "complete";
}) {
	const store = input.gmail.bundle.gmailDiscoveryStore;
	await store.startDiscovery({
		checkedMessageCount: 0,
		userId: input.userId,
		accountEmail: EMAIL,
		gatewayAddress: input.gatewayAddress,
		generation: input.generation,
		mode: "full",
		historyId: "100",
	});
	await store.claimPage({ userId: input.userId, generation: input.generation, page: 0 });
	const previous = await store.findDiscoveryByUserId(input.userId);
	assert(previous);
	await store.savePage({
		previous,
		senders: input.senders,
		mode: "full",
		pageToken: input.state === "running" ? "next" : undefined,
		historyId: "100",
		state: input.state,
		scannedMessages: input.senders.length,
		estimatedTotalMessages: undefined,
		oldestScannedAt: undefined,
	});
}

async function readerAgent(options: { connected?: boolean; confirmed?: boolean; scope?: string; appNow?: () => Date } = {}) {
	const { harness, gmail, articleStore } = harnessWithGmail(options);
	const created = await harness.auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok);
	const userId = created.userId;
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email: "reader@example.com", password: "password123" });
	for (const [slug, label] of [[TECH, "Tech"], [SCIENCE, "Science"]] as const) {
		await articleStore.createReadlistDefinition({ userId, slug, label, createdAt: new Date(AT) });
	}
	const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
	if (options.connected !== false) {
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: EMAIL });
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: options.scope ?? GMAIL_SCOPES });
		if (options.confirmed !== false) await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: DISCOVERED, generation: "initial", state: "complete" });
	}
	const mapSender = async (sender: ForwardableSender, readlists: readonly [ReadlistSlug, ...ReadlistSlug[]]) => {
		const [first, ...rest] = await Promise.all(readlists.map((readlist) => gmail.bundle.getOrCreateReadlistAddress({ userId, readlist })));
		assert(first, "a mapped sender needs at least one readlist");
		await gmail.bundle.gmailMappingStore.mapSenderToAddress({
			userId,
			accountEmail: EMAIL,
			senderEmail: sender,
			mappedAddresses: [first.address, ...rest.map((entry) => entry.address)],
			deliveryMode: "links",
		});
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: sender });
	};
	return { harness, gmail, articleStore, agent, userId, gatewayAddress, mapSender };
}

describe("Readlist Gmail newsletters section", () => {
	it("offers a tracked connect confirmation when Gmail is not connected", async () => {
		const { agent } = await readerAgent({ connected: false });
		const doc = load((await agent.get(PREFERENCES)).text);
		expect(sectionState(doc)).toBe("connect");
		const button = section(doc).querySelector('[data-test-action="connect-gmail"]');
		assert(button, "the connect button must render");
		expect([button.getAttribute("popovertarget"), button.getAttribute("aria-haspopup")]).toEqual(["gmail-connect-disclaimer", "dialog"]);
		const ok = doc.querySelector('#gmail-connect-disclaimer [data-test-action="gmail-connect-ok"]')?.closest("form");
		assert(ok, "the disclaimer must confirm with a form");
		expect([ok.getAttribute("method"), ok.getAttribute("action")]).toEqual(["POST", "/newsletters/gmail/connect?utm_source=queue-preferences&utm_medium=internal&utm_content=connect-gmail"]);
		expect(hiddenFields(ok)).toEqual({});
	});

	it("offers an upgrade to a reader who cannot connect Gmail", async () => {
		const { agent, harness, userId } = await readerAgent({ connected: false });
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() + ONE_DAY_MS).toISOString() });
		const doc = load((await agent.get(PREFERENCES)).text);
		expect(sectionState(doc)).toBe("upgrade");
		const form = section(doc).querySelector('[data-test-action="upgrade-gmail"]')?.closest("form");
		assert(form, "the upgrade action must render a form");
		expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["GET", "/account/plans?utm_source=queue-preferences&utm_medium=internal&utm_content=upgrade-gmail"]);
	});

	it.each([
		["disconnecting", async (seed: Awaited<ReturnType<typeof readerAgent>>) => seed.gmail.bundle.gmailConnectionStore.markDisconnectRequested({ userId: seed.userId })],
		["reconnect", async (seed: Awaited<ReturnType<typeof readerAgent>>) => seed.gmail.bundle.gmailConnectionStore.markRevoked({ userId: seed.userId, reason: "invalid-grant" })],
	])("renders the %s state without a picker", async (state, seedState) => {
		const seed = await readerAgent();
		await seedState(seed);
		const doc = load((await seed.agent.get(PREFERENCES)).text);
		expect([sectionState(doc), doc.querySelector("#gmail-readlist-selection")?.tagName]).toEqual([state, undefined]);
	});

	it("asks for sender access when the metadata scope is missing", async () => {
		const { agent } = await readerAgent({ scope: GMAIL_SETTINGS_SCOPE });
		const doc = load((await agent.get(PREFERENCES)).text);
		expect(sectionState(doc)).toBe("reconnect");
		const form = section(doc).querySelector('[data-test-action="grant-sender-access"]')?.closest("form");
		assert(form, "the reconnect action must render a form");
		expect(form.getAttribute("action")).toBe("/newsletters/gmail/connect?utm_source=queue-preferences&utm_medium=internal&utm_content=grant-sender-access");
	});

	it("shows the picker with a finish-setup link while forwarding awaits confirmation", async () => {
		const { agent } = await readerAgent({ confirmed: false });
		const doc = load((await agent.get(PREFERENCES)).text);
		expect(sectionState(doc)).toBe("awaiting");
		expect(section(doc).querySelector('[data-test-action="finish-gmail-setup"]')?.getAttribute("href")).toBe("/newsletters/gmail?utm_source=queue-preferences&utm_medium=internal&utm_content=finish-gmail-setup");
		expect(doc.querySelector("#gmail-readlist-selection")?.getAttribute("method")).toBe("GET");
	});

	it("keeps Save available when the Gmail filter failed", async () => {
		const { agent, gmail, userId } = await readerAgent();
		await gmail.bundle.gmailConnectionStore.recordFilterError({ userId, error: { code: "rejected", message: "Unrecognized forwarding address", at: "2026-09-16T00:00:00.000Z" } });
		const doc = load((await agent.get(PREFERENCES)).text);
		expect(sectionState(doc)).toBe("filter-failed");
		expect(section(doc).querySelector('[data-test-action="open-gmail-newsletters"]')?.getAttribute("href")).toBe("/newsletters/gmail?utm_source=queue-preferences&utm_medium=internal&utm_content=open-gmail-newsletters");
		expect(section(doc).querySelector('[data-test-action="save-gmail-newsletters"]')?.getAttribute("formaction")).toBe(`${SAVE}?utm_source=queue-preferences&utm_medium=internal&utm_content=save-gmail-newsletters`);
	});

	it("lists senders here, elsewhere and known, ticking the ones routed here", async () => {
		const { agent, mapSender } = await readerAgent();
		await mapSender(TLDR, [SCIENCE]);
		const doc = load((await agent.get(PREFERENCES)).text);
		expect(sectionState(doc)).toBe("picker");
		expect(checklistRows(doc)).toEqual([
			["elsewhere", TLDR, false],
			["known", MORNING, false],
		]);
		expect(section(doc).querySelector('[data-test-action="manage-gmail-newsletters"]')?.getAttribute("href")).toBe("/newsletters/gmail?utm_source=queue-preferences&utm_medium=internal&utm_content=manage-gmail-newsletters");
	});

	it("leaves unresolved mappings to the Gmail page and refuses to save them here", async () => {
		const { agent, gmail, userId } = await readerAgent();
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		await gmail.bundle.gmailMappingStore.mapSenderToAddress({
			userId,
			accountEmail: EMAIL,
			senderEmail: MORNING,
			mappedAddresses: [InboxAddressSchema.parse("gone-b8c3d0@read.place")],
			deliveryMode: "links",
		});
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: MORNING });
		expect(checklistRows(load((await agent.get(PREFERENCES)).text))).toEqual([]);
		const response = await agent.post(SAVE).type("form").send({ gmail_selection: "1", sender: MORNING });
		expect(response.headers.location).toBe(`${PREFERENCES}?preferences_error=gmail-selection`);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("redirects a checklist command to the canonical URL, or pushes it for htmx", async () => {
		const { agent } = await readerAgent();
		const command = `${PREFERENCES}?gmail_selection=1&pick=${encodeURIComponent(MORNING)}`;
		const redirected = await agent.get(command);
		expect(redirected.status).toBe(303);
		expect(redirected.headers.location).toBe(`${PREFERENCES}?gmail_selection=1&sender=${encodeURIComponent(MORNING)}#readlist-gmail-senders`);
		const pushed = await agent.get(command).set("HX-Request", "true");
		expect(pushed.status).toBe(200);
		expect(pushed.headers["hx-push-url"]).toBe(redirected.headers.location);
		expect(checklistRows(load(pushed.text))).toEqual([["known", MORNING, true]]);
	});

	it("answers a search with results only, finding a sender routed to another readlist", async () => {
		const { agent, mapSender } = await readerAgent();
		await mapSender(TLDR, [SCIENCE]);
		const response = await agent.get(`${SENDERS}?gmail_selection=1&search=dan`).set("HX-Request", "true");
		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-store");
		expect(response.headers["hx-push-url"]).toBe(`${PREFERENCES}?gmail_selection=1&search=dan#readlist-gmail-senders`);
		const doc = load(response.text);
		expect(rootIds(doc)).toEqual(["gmail-sender-results"]);
		expect(optionEmails(doc)).toEqual([TLDR]);
	});

	it("answers a poll with the status and an out-of-band load button", async () => {
		const { agent } = await readerAgent();
		const response = await agent.get(`${SENDERS}?gmail_selection=1&discovery=started&poll=1`).set("HX-Request", "true");
		expect(response.status).toBe(200);
		expect(rootIds(load(response.text))).toEqual(["gmail-load-senders-button", "gmail-sender-status"]);
	});

	it("sends a full-page request for the senders fragment to the preferences page", async () => {
		const { agent } = await readerAgent();
		const response = await agent.get(`${SENDERS}?gmail_selection=1&search=dan`);
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`${PREFERENCES}?gmail_selection=1&search=dan#readlist-gmail-senders`);
	});

	it("redirects an htmx fragment request to the page when no picker shows", async () => {
		const { agent, gmail, userId } = await readerAgent();
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		const response = await agent.get(`${SENDERS}?gmail_selection=1&search=dan`).set("HX-Request", "true");
		expect(response.headers["hx-redirect"]).toBe(PREFERENCES);
	});

	it("bounces fragment and discovery requests for a readlist the reader does not own", async () => {
		const { agent } = await readerAgent();
		expect((await agent.get("/queue/queues/default/preferences/gmail/senders").set("HX-Request", "true")).headers.location).toBe(UNKNOWN_READLIST);
		expect((await agent.post("/queue/queues/zzz999/preferences/gmail/discovery").type("form").send({ gmail_selection: "1" })).headers.location).toBe(UNKNOWN_READLIST);
	});

	it("starts discovery only when the reader asks, keeping the selection", async () => {
		const { agent, gmail, userId } = await readerAgent();
		await agent.get(PREFERENCES);
		await agent.get(`${SENDERS}?gmail_selection=1&search=dan`).set("HX-Request", "true");
		expect(gmail.discoveryRequests).toEqual([]);
		const response = await agent.post(DISCOVERY).type("form").send({ gmail_selection: "1", sender: MORNING });
		expect(response.status).toBe(303);
		expect(locationParams(response.headers.location)).toMatchObject({ gmail_selection: "1", sender: MORNING, discovery: "started" });
		expect(gmail.discoveryRequests).toEqual([{ userId }]);
	});

	it("sends a discovery request needing sender access back to the page", async () => {
		const { agent, gmail } = await readerAgent({ scope: GMAIL_SETTINGS_SCOPE });
		const response = await agent.post(DISCOVERY).type("form").send({ gmail_selection: "1" });
		expect(response.headers.location).toBe(PREFERENCES);
		expect(gmail.discoveryRequests).toEqual([]);
	});

	it("sends a discovery request back to the page once the reader asked to disconnect", async () => {
		const { agent, gmail, userId } = await readerAgent();
		await gmail.bundle.gmailConnectionStore.markDisconnectRequested({ userId });
		const response = await agent.post(DISCOVERY).type("form").send({ gmail_selection: "1" });
		expect([response.status, response.headers.location]).toEqual([303, PREFERENCES]);
		expect(gmail.discoveryRequests).toEqual([]);
	});
});

describe("Saving Gmail newsletters to a readlist", () => {
	async function routedHere(agent: ReturnType<typeof request.agent>, slug: ReadlistSlug) {
		return checklistRows(load((await agent.get(`/queue/queues/${slug}/preferences`)).text));
	}

	it("forwards new senders here as issues, submitting the uncatalogued one as a newsletter", async () => {
		const { agent, gmail, userId } = await readerAgent();
		const response = await agent.post(SAVE).type("form").send({ gmail_selection: "1", sender: [MORNING, TLDR] });
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(PREFERENCES);
		expect(await routedHere(agent, TECH)).toEqual([["here", MORNING, true], ["here", TLDR, true]]);
		const modes = await Promise.all([MORNING, TLDR].map(async (senderEmail) => (await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail }))?.deliveryMode));
		expect(modes).toEqual(["issue", "issue"]);
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
		expect(gmail.newsletterSenderSubmissions).toEqual([{ senderEmail: TLDR }]);
		expect([gmail.importStartRequests, gmail.markBackfillStartRequests]).toEqual([[], []]);
	});

	it("adds this readlist alongside the sender's other readlists, keeping its delivery mode", async () => {
		const { agent, gmail, userId, mapSender } = await readerAgent();
		await mapSender(TLDR, [SCIENCE]);
		await agent.post(SAVE).type("form").send({ gmail_selection: "1", sender: TLDR });
		expect(await routedHere(agent, TECH)).toEqual([["here", TLDR, true], ["known", MORNING, false]]);
		expect(await routedHere(agent, SCIENCE)).toEqual([["here", TLDR, true], ["known", MORNING, false]]);
		expect((await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR }))?.deliveryMode).toBe("links");
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
		expect(gmail.newsletterSenderSubmissions).toEqual([]);
	});

	it("sends an unticked sender routed only here to All", async () => {
		const { agent, gmail, userId, mapSender } = await readerAgent();
		await mapSender(TLDR, [TECH]);
		await agent.post(SAVE).type("form").send({ gmail_selection: "1", routed: TLDR });
		const doc = load((await agent.get(PREFERENCES)).text);
		expect(checklistRows(doc)).toEqual([["elsewhere", TLDR, false], ["known", MORNING, false]]);
		expect(doc.querySelector('[data-test-gmail-checklist-group="elsewhere"] [data-test-gmail-checklist-row]')?.textContent).toContain("In All");
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
	});

	it("keeps an unticked sender's other readlists", async () => {
		const { agent, gmail, userId, mapSender } = await readerAgent();
		await mapSender(TLDR, [TECH, SCIENCE]);
		await agent.post(SAVE).type("form").send({ gmail_selection: "1", routed: TLDR });
		expect(await routedHere(agent, TECH)).toEqual([["elsewhere", TLDR, false], ["known", MORNING, false]]);
		expect(await routedHere(agent, SCIENCE)).toEqual([["here", TLDR, true], ["known", MORNING, false]]);
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
	});

	it("publishes nothing when the selection is unchanged", async () => {
		const { agent, gmail, mapSender } = await readerAgent();
		await mapSender(TLDR, [TECH]);
		const response = await agent.post(SAVE).type("form").send({ gmail_selection: "1", sender: TLDR, routed: TLDR });
		expect(response.headers.location).toBe(PREFERENCES);
		expect([gmail.rewriteRequests, gmail.newsletterSenderSubmissions]).toEqual([[], []]);
	});

	it("shows the selection alert for a malformed body", async () => {
		const { agent, gmail } = await readerAgent();
		const response = await agent.post(SAVE).type("form").send({ gmail_selection: "1", sender: "not an email" });
		expect(response.headers.location).toBe(`${PREFERENCES}?preferences_error=gmail-selection`);
		expect(pageAlerts(load((await agent.get(response.headers.location)).text))).toEqual([
			"Couldn't save the Gmail newslettersOne of those senders can't be saved here. Check it on the Gmail newsletters page, then try again.",
		]);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("shows the unavailable alert when Gmail is not connected", async () => {
		const { agent } = await readerAgent({ connected: false });
		const response = await agent.post(SAVE).type("form").send({ gmail_selection: "1", sender: MORNING });
		expect(response.headers.location).toBe(`${PREFERENCES}?preferences_error=gmail-unavailable`);
		expect(pageAlerts(load((await agent.get(response.headers.location)).text))).toEqual([
			"Couldn't save the Gmail newslettersGmail isn't ready to save newsletters right now. Nothing was changed.",
		]);
	});

	it("bounces a save for a deleted readlist", async () => {
		const { agent, gmail } = await readerAgent();
		for (const slug of ["zzz999", "Not%20a%20slug"]) {
			const response = await agent.post(`/queue/queues/${slug}/preferences/gmail`).type("form").send({ gmail_selection: "1", sender: MORNING });
			expect(response.headers.location).toBe(UNKNOWN_READLIST);
		}
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("shows a locked account the locked page", async () => {
		const { agent, gmail } = await readerAgent({ appNow: () => new Date(Date.now() + 8 * ONE_DAY_MS) });
		const response = await agent.post(SAVE).set("Accept", "text/html").type("form").send({ gmail_selection: "1", sender: MORNING });
		expect(response.status).toBe(403);
		expect(load(response.text).querySelector("h1")?.textContent).toBe("Your account is locked");
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("bounces a read-only reader's save and discovery to the inactive queue", async () => {
		const { agent, gmail, harness, userId } = await readerAgent();
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString() });
		for (const path of [SAVE, DISCOVERY]) {
			expect((await agent.post(path).set("Accept", "text/html").type("form").send({ gmail_selection: "1", sender: MORNING })).headers.location).toBe("/queue?inactive=1");
		}
		expect([gmail.rewriteRequests, gmail.discoveryRequests]).toEqual([[], []]);
	});

	it("composes with a later readlist choice on the Gmail page", async () => {
		const { agent, gmail, userId } = await readerAgent();
		await agent.post(SAVE).type("form").send({ gmail_selection: "1", sender: MORNING });
		const added = await agent.post("/newsletters/gmail/senders/add").type("form").send({ sender: MORNING, readlist: [TECH, SCIENCE], readlist_choice_for: MORNING });
		expect(added.status).toBe(303);
		expect(await routedHere(agent, TECH)).toEqual([["here", MORNING, true]]);
		expect(await routedHere(agent, SCIENCE)).toEqual([["here", MORNING, true]]);
		expect(gmail.rewriteRequests.map((entry) => entry.userId)).toEqual([userId, userId]);
	});
});
