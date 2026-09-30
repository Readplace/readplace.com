import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
	type DiscoveredGmailSender,
	type ForwardableSender,
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportCancelReason,
	type GmailHistoryImportCounts,
	type GmailHistoryImportFailureReason,
	type GmailHistoryImportJobId,
	type GmailHistoryImportState,
} from "@packages/domain/gmail";
import { AliasNameSchema, type InboxAddress, InboxAddressSchema } from "@packages/domain/inbox";
import { type NewsletterCatalogDocument, NewsletterCatalogDocumentSchema } from "@packages/domain/newsletter-catalog";
import { DEFAULT_READLIST_SLUG, READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { GMAIL_READONLY_SCOPE, GMAIL_SCOPES, GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const GMAIL = "/integrations/gmail";
const ADD = `${GMAIL}/senders/add`;
const REMOVE = `${GMAIL}/senders/remove`;
const RETRY = `${GMAIL}/filter/retry`;
const DISCOVER = `${GMAIL}/discovery/start`;
const CREATE_READLIST = `${GMAIL}/readlists/create`;
const IMPORT_START = `${GMAIL}/imports/start`;
const IMPORT_RETRY = `${GMAIL}/imports/retry`;
const IMPORT_CANCEL = `${GMAIL}/imports/cancel`;
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const MORNING = ForwardableSenderSchema.parse("crew@morningbrew.com");
const EMAIL = GmailAccountEmailSchema.parse("reader@gmail.com");
const TECH = ReadlistSlugSchema.parse("tech");
const READONLY_SCOPES = `${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`;
const ONE_DAY_MS = 86_400_000;
const AT = "2026-09-30T00:00:00.000Z";
const DISCOVERED: DiscoveredGmailSender[] = [
	{ email: TLDR, name: "Dan at TLDR" },
	{ email: MORNING, name: "Brew Crew" },
];

function catalogOf(entries: readonly [ForwardableSender, string][]): NewsletterCatalogDocument {
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

function sections(doc: Document): string[] {
	const present: string[] = [];
	if (doc.querySelector("[data-test-gmail-step]")) present.push("step");
	if (doc.querySelector("[data-test-gmail-senders]")) present.push("senders");
	if (doc.querySelector("[data-test-gmail-reconnect]")) present.push("reconnect");
	return present;
}

function alertKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll('.gmail__container > [data-test-alert-variant="error"]'), (el) => el.getAttribute("data-test-alert"));
}

function hiddenFields(form: Element): Record<string, string> {
	return Object.fromEntries(Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'), (input) => [input.name, input.value]));
}

function optionEmails(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-gmail-sender-option]"), (el) => el.getAttribute("data-test-gmail-sender-option"));
}

function results(doc: Document): Element {
	const element = doc.querySelector("#gmail-sender-results");
	assert(element, "the sender results must render");
	return element;
}

function row(doc: Document, sender: string): Element {
	const element = doc.querySelector(`[data-test-gmail-mapping-row="${sender}"]`);
	assert(element, `the mapping row for ${sender} must render`);
	return element;
}

function rowActionKeys(element: Element): (string | null)[] {
	return Array.from(element.querySelectorAll(".gmail-mappings__actions [data-test-gmail-mapping-action]"), (el) => el.getAttribute("data-test-gmail-mapping-action"));
}

function rowAction(element: Element, key: string): HTMLFormElement {
	const button = element.querySelector(`.gmail-mappings__actions [data-test-gmail-mapping-action="${key}"]`);
	const form = button?.closest("form");
	assert(form, `the ${key} action must submit a form`);
	return form;
}

function locationParams(location: string): Record<string, string> {
	return Object.fromEntries(new URL(location, "https://readplace.com").searchParams);
}

function harnessWithGmail(options: { now?: () => Date; appNow?: () => Date; catalog?: NewsletterCatalogDocument } = {}) {
	const now = options.now ?? (() => new Date());
	const gmail = initInMemoryGmailIntegration({
		grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
		addresses: initInMemoryInboxAddress({ now }),
		now,
	});
	const catalog = initInMemoryNewsletterCatalog(options.catalog ?? catalogOf([[MORNING, "Morning Brew"]]));
	const gmailIntegration = {
		...gmail.bundle,
		publishStartGmailSenderDiscovery: (input: { userId: UserId }) => gmail.bundle.publishStartGmailSenderDiscovery(input),
		publishDisconnectGmail: (input: { userId: UserId }) => gmail.bundle.publishDisconnectGmail(input),
	};
	const base = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const fixture = {
		...base,
		gmailIntegration,
		newsletterCatalog: {
			readNewsletterCatalog: catalog.readCatalog,
			writeNewsletterCatalog: catalog.writeCatalog,
			newsletterCatalogSeed: { version: 1 as const, entries: [] },
		},
	};
	if (options.appNow !== undefined) fixture.shared.now = options.appNow;
	const harness = useApp(fixture);
	return { harness, gmail, catalog, articleStore: base.articleStore };
}

async function seedDiscovery(input: {
	gmail: ReturnType<typeof harnessWithGmail>["gmail"];
	userId: UserId;
	gatewayAddress: InboxAddress;
	senders: DiscoveredGmailSender[];
	generation: string;
	state: "running" | "complete";
	mode?: "full" | "history";
	checkedMessageCount?: number;
	scannedMessages?: number;
}) {
	const store = input.gmail.bundle.gmailDiscoveryStore;
	await store.startDiscovery({
		checkedMessageCount: input.checkedMessageCount ?? 0,
		userId: input.userId,
		accountEmail: EMAIL,
		gatewayAddress: input.gatewayAddress,
		generation: input.generation,
		mode: input.mode ?? "full",
		historyId: "100",
	});
	await store.claimPage({ userId: input.userId, generation: input.generation, page: 0 });
	const previous = await store.findDiscoveryByUserId(input.userId);
	assert(previous);
	await store.savePage({
		previous,
		senders: input.senders,
		mode: input.mode ?? "full",
		pageToken: input.state === "running" ? "next" : undefined,
		historyId: "100",
		state: input.state,
		scannedMessages: input.scannedMessages ?? input.senders.length,
		estimatedTotalMessages: undefined,
		oldestScannedAt: undefined,
	});
}

async function connectedAgent(options: {
	confirmed?: boolean;
	scope?: string;
	discovered?: boolean;
	accountEmail?: boolean;
	now?: () => Date;
	appNow?: () => Date;
	catalog?: NewsletterCatalogDocument;
} = {}) {
	const { harness, gmail, catalog, articleStore } = harnessWithGmail(options);
	const created = await harness.auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok);
	const userId = created.userId;
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email: "reader@example.com", password: "password123" });
	const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
	await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
	if (options.accountEmail !== false) await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: EMAIL });
	await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: options.scope ?? GMAIL_SCOPES });
	if (options.confirmed !== false) await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
	if (options.discovered !== false) {
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: DISCOVERED, generation: "initial", state: "complete" });
	}
	const createReadlist = async (input: { slug: string; label: string; owner?: UserId }) => {
		await articleStore.createReadlistDefinition({
			userId: input.owner ?? userId,
			slug: ReadlistSlugSchema.parse(input.slug),
			label: input.label,
			createdAt: new Date(AT),
		});
	};
	const mapSender = async (sender: ForwardableSender, readlist: string) => {
		const entry = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: ReadlistSlugSchema.parse(readlist) });
		await gmail.bundle.gmailSenderStore.mapSenderToAddress({ userId, senderEmail: sender, mappedAddress: entry.address });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: sender });
		return entry.address;
	};
	const seedJob = async (input: {
		sender: ForwardableSender;
		destination: InboxAddress;
		state: GmailHistoryImportState;
		counts?: Partial<GmailHistoryImportCounts>;
		failureReason?: GmailHistoryImportFailureReason;
		cancelReason?: GmailHistoryImportCancelReason;
		owner?: UserId;
		createdAt?: string;
	}): Promise<GmailHistoryImportJobId> => {
		const jobId = gmail.bundle.newGmailHistoryImportJobId();
		await gmail.bundle.gmailHistoryImportStore.createJob({
			userId: input.owner ?? userId,
			jobId,
			senderEmail: input.sender,
			destinationAddress: input.destination,
			connection: { gatewayAddress, accountEmail: EMAIL },
			window: undefined,
			generation: "seeded",
			page: 0,
			pageToken: undefined,
			listingCompletedAt: undefined,
			state: input.state,
			counts: {
				listed: 0,
				imported: 0,
				alreadyImported: 0,
				skippedNoMessageId: 0,
				skippedSenderMismatch: 0,
				failed: 0,
				cancelled: 0,
				...input.counts,
			},
			failureReason: input.failureReason,
			cancelReason: input.cancelReason,
			createdAt: input.createdAt ?? AT,
			updatedAt: input.createdAt ?? AT,
			completedAt: undefined,
		});
		return jobId;
	};
	const findJob = (jobId: GmailHistoryImportJobId) => gmail.bundle.gmailHistoryImportStore.findJob({ userId, jobId });
	return { harness, gmail, catalog, articleStore, agent, userId, gatewayAddress, createReadlist, mapSender, seedJob, findJob };
}

describe("GMail Newsletters page", () => {
	it("requires authentication on page, discovery, readlist, mapping and import endpoints", async () => {
		const { harness } = harnessWithGmail();
		for (const path of [GMAIL, `${GMAIL}/senders`, `${GMAIL}/status`]) {
			expect((await request(harness.server).get(path)).headers.location).toBe("/login");
		}
		for (const path of [ADD, REMOVE, RETRY, DISCOVER, CREATE_READLIST, IMPORT_START, IMPORT_RETRY, IMPORT_CANCEL, `${GMAIL}/disconnect`]) {
			expect((await request(harness.server).post(path)).headers.location).toBe("/login");
		}
	});

	it("requires a current connection before reading or changing mappings", async () => {
		const { harness } = harnessWithGmail();
		const agent = await loginAgent(harness.server, harness.auth);
		expect((await agent.get(GMAIL)).headers.location).toBe("/integrations");
		for (const path of [ADD, CREATE_READLIST, IMPORT_START, IMPORT_RETRY, IMPORT_CANCEL, REMOVE, `${GMAIL}/disconnect`]) {
			expect((await agent.post(path).type("form").send({ sender: TLDR, readlist: "default" })).headers.location).toBe("/integrations");
		}
		expect((await agent.get(`${GMAIL}/senders`).set("HX-Request", "true")).headers["hx-redirect"]).toBe("/integrations");
	});

	it("redirects while disconnect is running", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.markDisconnectRequested({ userId });
		expect((await agent.get(GMAIL)).headers.location).toBe("/integrations");
	});

	it("names the page GMail Newsletters and lists only approved newsletters for an empty search, without querying Gmail", async () => {
		const { agent, gmail } = await connectedAgent();
		const response = await agent.get(GMAIL);
		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-store");
		const doc = load(response.text);
		expect(doc.title).toBe("GMail Newsletters — Readplace");
		expect(doc.querySelector("h1")?.textContent).toBe("GMail Newsletters");
		expect(results(doc).getAttribute("data-results-state")).toBe("listed");
		expect(optionEmails(doc)).toEqual([MORNING]);
		const option = doc.querySelector(`[data-test-gmail-sender-option="${MORNING}"]`);
		assert(option);
		expect(option.querySelector("[data-test-gmail-sender-option-name]")?.textContent).toBe("Morning Brew");
		expect(option.querySelector(".gmail__option-email")?.textContent).toBe(MORNING);
		const chooser = option.closest("form");
		assert(chooser);
		expect(chooser.getAttribute("method")).toBe("GET");
		expect(chooser.getAttribute("action")).toBe(GMAIL);
		expect(hiddenFields(chooser)).toEqual({
			sender: MORNING,
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "choose-newsletter",
		});
		expect(Array.from(doc.querySelectorAll("#gmail-sender-results [data-test-gmail-browse-all]"), (el) => el.textContent)).toEqual(["Browse all senders"]);
		expect(gmail.discoveryRequests).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it.each([
		["tldr.tech", [TLDR]],
		["dan at", [TLDR]],
		["morning", [MORNING]],
		["crew", [MORNING]],
	])("finds any discovered sender for the typed search %s by address, catalog name or display name", async (search, expected) => {
		const { agent } = await connectedAgent();
		const response = await agent.get(`${GMAIL}/senders?search=${encodeURIComponent(search)}&discovery=started`).set("HX-Request", "true");
		expect(response.status).toBe(200);
		expect(optionEmails(load(response.text))).toEqual(expected);
		const full = await agent.get(`${GMAIL}/senders?search=${encodeURIComponent(search)}`);
		expect(optionEmails(load(full.text))).toEqual(expected);
	});

	it("browses every discovered sender in advanced mode with recognised newsletters first and offers the way back", async () => {
		const { agent } = await connectedAgent();
		const doc = load((await agent.get(`${GMAIL}?advanced=1&discovery=started`)).text);
		expect(optionEmails(doc)).toEqual([MORNING, TLDR]);
		const back = doc.querySelector("[data-test-gmail-known-only]")?.closest("form");
		assert(back);
		expect(hiddenFields(back)).toEqual({
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "known-newsletters",
		});
		const browse = load((await agent.get(GMAIL)).text).querySelector("[data-test-gmail-browse-all]")?.closest("form");
		assert(browse);
		expect(hiddenFields(browse)).toEqual({
			advanced: "1",
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "browse-all-senders",
		});
	});

	it("tells apart no discovered senders, no known newsletters and no matches", async () => {
		const empty = await connectedAgent({ discovered: false });
		const none = load((await empty.agent.get(`${GMAIL}?discovery=started`)).text);
		expect(results(none).getAttribute("data-results-state")).toBe("no-discovered-senders");
		expect(none.querySelector("[data-test-gmail-results-message]")?.textContent).toBe("No senders discovered yet.");
		expect(Array.from(none.querySelectorAll("#gmail-sender-results .gmail__results-action button"), (el) => el.textContent)).toEqual([]);

		const unknown = await connectedAgent({ catalog: catalogOf([]) });
		const unrecognised = load((await unknown.agent.get(GMAIL)).text);
		expect(results(unrecognised).getAttribute("data-results-state")).toBe("no-recognized-newsletters");
		expect(unrecognised.querySelector("[data-test-gmail-results-message]")?.textContent).toBe(
			"None of your discovered senders is a known newsletter yet. Search for a sender, or browse all senders.",
		);
		expect(Array.from(unrecognised.querySelectorAll("#gmail-sender-results .gmail__results-action button"), (el) => el.textContent)).toEqual(["Browse all senders"]);

		const unmatched = load((await unknown.agent.get(`${GMAIL}?search=zzz`)).text);
		expect(results(unmatched).getAttribute("data-results-state")).toBe("no-matches");
		expect(unmatched.querySelector("[data-test-gmail-results-message]")?.textContent).toBe("No discovered senders match “zzz”.");
	});

	it("offers a retry and a search when newsletter suggestions are unavailable", async () => {
		const { agent, catalog } = await connectedAgent();
		catalog.failReads(true);
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&discovery=started`)).text);
		expect(results(doc).getAttribute("data-results-state")).toBe("catalog-unavailable");
		expect(doc.querySelector("[data-test-gmail-results-message]")?.textContent).toBe(
			"Newsletter suggestions are unavailable. Try again, or search your discovered senders.",
		);
		const retry = doc.querySelector("[data-test-gmail-suggestions-retry]")?.closest("form");
		assert(retry);
		expect(retry.getAttribute("action")).toBe(GMAIL);
		expect(hiddenFields(retry)).toEqual({
			sender: TLDR,
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "retry-suggestions",
		});
		const searched = load((await agent.get(`${GMAIL}?search=tldr`)).text);
		expect(results(searched).getAttribute("data-results-state")).toBe("listed");
		expect(optionEmails(searched)).toEqual([TLDR]);
		catalog.failReads(false);
		expect(optionEmails(load((await agent.get(GMAIL)).text))).toEqual([MORNING]);
	});

	it("recognises newsletters before trimming the list to 100 senders and asks for a narrower search", async () => {
		const ZETA = ForwardableSenderSchema.parse("zeta@zeta.example");
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ discovered: false, catalog: catalogOf([[ZETA, "Zeta Weekly"]]) });
		const bulk: DiscoveredGmailSender[] = Array.from({ length: 150 }, (_, index) => ({
			email: ForwardableSenderSchema.parse(`sender-${String(index).padStart(3, "0")}@bulk.example`),
			name: undefined,
		}));
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [...bulk, { email: ZETA, name: "Zeta" }], generation: "bulk", state: "complete" });

		const advanced = load((await agent.get(`${GMAIL}?advanced=1&discovery=started`)).text);
		const emails = optionEmails(advanced);
		expect(emails).toHaveLength(100);
		expect(emails[0]).toBe(ZETA);
		expect(results(advanced).getAttribute("data-results-state")).toBe("limited");
		const message = advanced.querySelector("[data-test-gmail-refine-search]");
		assert(message);
		expect(message.textContent).toBe("Showing 100 of 151 senders. Refine your search to find another sender.");
		expect(optionEmails(load((await agent.get(GMAIL)).text))).toEqual([ZETA]);
	});

	it("pushes the whole picker state to the address bar for a search fragment but not for a poll", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const state = `search=dan&advanced=1&sender=${encodeURIComponent(TLDR)}&readlist=tech`;
		const fragment = await agent.get(`${GMAIL}/senders?${state}&discovery=started`).set("HX-Request", "true");
		expect(fragment.headers["hx-push-url"]).toBe(`${GMAIL}?${state}&discovery=started`);
		const poll = await agent.get(`${GMAIL}/senders?${state}&discovery=started&poll=1`).set("HX-Request", "true");
		expect(poll.headers["hx-push-url"]).toBeUndefined();
		expect(Array.from(load(poll.text).querySelectorAll("[hx-swap-oob]"), (element) => element.id)).toEqual(["gmail-load-senders-button"]);
	});

	it("refreshes every form that carries the search when a typed search swaps in new results", async () => {
		const { agent, createReadlist, mapSender } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		await mapSender(MORNING, "default");
		const typed = load((await agent.get(`${GMAIL}/senders?search=dan&sender=${encodeURIComponent(TLDR)}&readlist=tech&discovery=started`).set("HX-Request", "true")).text);
		expect(Array.from(typed.querySelectorAll("[hx-swap-oob]"), (element) => [element.id, element.getAttribute("hx-swap-oob")])).toEqual([
			["gmail-load-senders-button", "outerHTML"],
			["gmail-mapping-choice", "outerHTML"],
			["gmail-mappings", "outerHTML"],
		]);
		const readlistOption = typed.querySelector('[data-test-gmail-readlist-option="default"]')?.closest("form");
		const save = typed.querySelector("[data-test-gmail-save-mapping]");
		assert(readlistOption && save);
		expect([hiddenFields(readlistOption).search, hiddenFields(save).search, hiddenFields(rowAction(row(typed, MORNING), "remove")).search]).toEqual(["dan", "dan", "dan"]);
		const unchosen = load((await agent.get(`${GMAIL}/senders?search=dan&discovery=started`).set("HX-Request", "true")).text);
		expect(Array.from(unchosen.querySelectorAll("[hx-swap-oob]"), (element) => element.id)).toEqual(["gmail-load-senders-button", "gmail-mappings"]);
		const page = load((await agent.get(`${GMAIL}?search=dan&sender=${encodeURIComponent(TLDR)}&readlist=tech`)).text);
		expect(["#gmail-load-senders-button", "#gmail-mapping-choice", "#gmail-mappings"].map((id) => page.querySelector(id)?.hasAttribute("hx-swap-oob"))).toEqual([false, false, false]);
	});

	it("starts background discovery only through POST, keeps the picker state and requests reconsent for older grants", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const discovery = await gmail.bundle.gmailDiscoveryStore.findDiscoveryByUserId(userId);
		assert(discovery);
		const started = await agent.post(DISCOVER).type("form").send({ search: "tldr", advanced: "1", sender: TLDR, readlist: "default", discovery_after: "stale" });
		expect(started.headers.location).toBe(
			`${GMAIL}?search=tldr&advanced=1&sender=dan%40tldr.tech&readlist=default&discovery=started&discovery_after=${encodeURIComponent(discovery.updatedAt)}`,
		);
		expect(gmail.discoveryRequests).toEqual([{ userId }]);
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "old", grantedScope: GMAIL_SETTINGS_SCOPE });
		expect((await agent.post(DISCOVER)).headers.location).toBe(`${GMAIL}?error=metadata_required`);
		expect(gmail.discoveryRequests).toEqual([{ userId }]);
		expect((await agent.get(GMAIL)).text).toContain("Reconnect");
	});

	it("marks a first discovery as following no earlier run", async () => {
		const { agent } = await connectedAgent({ discovered: false });
		expect((await agent.post(DISCOVER)).headers.location).toBe(`${GMAIL}?discovery=started&discovery_after=none`);
	});

	it("keeps polling a cached list until the queued refresh starts without dropping the chosen newsletter and readlist", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const started = await agent.post(DISCOVER).type("form").send({ search: "tldr", advanced: "1", sender: TLDR, readlist: "tech" });
		const doc = load((await agent.get(started.headers.location)).text);
		const pollUrl = results(doc).getAttribute("hx-get");
		assert(pollUrl);
		expect(locationParams(pollUrl)).toEqual({
			search: "tldr",
			advanced: "1",
			sender: TLDR,
			readlist: "tech",
			discovery: "started",
			discovery_after: expect.any(String),
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "load-senders",
			poll: "1",
		});
		expect(results(doc).getAttribute("hx-trigger")).toBe("every 3s");
		expect(doc.querySelector("#gmail-sender-choice")?.textContent).toBe(TLDR);
		expect(doc.querySelector("#gmail-readlist-choice")?.textContent).toBe("Tech");
		const fragment = await agent.get(pollUrl).set("HX-Request", "true");
		expect(locationParams(results(load(fragment.text)).getAttribute("hx-get") ?? "")).toMatchObject({ sender: TLDR, readlist: "tech", poll: "2" });
		expect(fragment.headers["hx-push-url"]).toBeUndefined();
	});

	it("reports checked messages while loading and swaps only the load button and results", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "progress", state: "running", scannedMessages: 25 });
		const fragment = load((await agent.get(`${GMAIL}/senders?discovery=started&poll=1`).set("HX-Request", "true")).text);
		const button = fragment.querySelector("#gmail-load-senders-button");
		assert(button);
		expect(button.textContent).toBe("Checking…");
		expect(button.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(fragment.querySelector("[data-test-gmail-discovery-status]")?.textContent).toBe("Checking… Checked 25 messages");
		expect(fragment.querySelector("[data-test-gmail-checked-count]")?.textContent).toBe("Checked 25 messages");
	});

	it("keeps the checked count cumulative when a later visit checks for new messages", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ discovered: false });
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: DISCOVERED, generation: "first", state: "complete", scannedMessages: 200 });
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "revisit", state: "running", mode: "history", checkedMessageCount: 200, scannedMessages: 75 });
		const running = load((await agent.get(`${GMAIL}?discovery=started`)).text);
		expect(running.querySelector("[data-test-gmail-discovery-status]")?.textContent).toBe("Checking for new messages · Checked 275 messages");
		expect(running.querySelector("#gmail-load-senders-button")?.textContent).toBe("Checking for new messages…");
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "settled", state: "complete", mode: "history", checkedMessageCount: 275, scannedMessages: 1 });
		const settled = load((await agent.get(`${GMAIL}?discovery=started`)).text);
		expect(settled.querySelector("[data-test-gmail-checked-count]")?.textContent).toBe("Checked 276 messages");
		expect(settled.querySelector("[data-test-gmail-discovery-status]")?.textContent).toMatch(/^\d+ senders? discovered · Checked 276 messages$/);
	});

	it("slows polling after the first minute and stops honestly once the discovery budget runs out", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "budget", state: "running", scannedMessages: 25 });
		const slow = load((await agent.get(`${GMAIL}/senders?discovery=started&poll=20`).set("HX-Request", "true")).text);
		expect(results(slow).getAttribute("hx-trigger")).toBe("every 15s");
		const stopped = load((await agent.get(`${GMAIL}/senders?discovery=started&poll=260`).set("HX-Request", "true")).text);
		expect(results(stopped).hasAttribute("hx-get")).toBe(false);
		expect(stopped.querySelector("[data-test-gmail-discovery-status]")?.textContent).toBe("Still checking. Checked 25 messages so far…");
		expect(stopped.querySelector("#gmail-load-senders-button")?.textContent).toBe("Load senders");
	});

	it("exposes a completed load button from the redirected discovery response", async () => {
		let now = new Date("2026-09-12T00:00:00.000Z");
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ now: () => now });
		const discovery = gmail.bundle.gmailDiscoveryStore;
		await discovery.startDiscovery({ checkedMessageCount: 0, userId, accountEmail: EMAIL, gatewayAddress, generation: "redirect-race", mode: "history", historyId: "100" });
		gmail.bundle.publishStartGmailSenderDiscovery = async ({ userId: requestedUserId }) => {
			expect(requestedUserId).toBe(userId);
			const running = await discovery.findDiscoveryByUserId(userId);
			assert(running);
			now = new Date("2026-09-12T00:00:01.000Z");
			expect(await discovery.claimPage({ userId, generation: running.generation, page: running.page })).toBe(true);
			expect(await discovery.savePage({ previous: running, senders: [], mode: "history", pageToken: undefined, historyId: "100", state: "complete", scannedMessages: 0, estimatedTotalMessages: undefined, oldestScannedAt: undefined })).toBe(true);
		};
		const response = await agent.post(DISCOVER).set("HX-Request", "true").redirects(1);
		expect(response.status).toBe(200);
		const page = load(response.text);
		const form = page.querySelector("[data-test-gmail-load-senders]");
		assert(form);
		expect(form.getAttribute("hx-select")).toBe("#gmail-sender-results");
		expect(form.getAttribute("hx-select-oob")).toBe("#gmail-load-senders-button:outerHTML");
		expect(form.querySelector("#gmail-load-senders-button")?.textContent).toBe("Load senders");
		expect(results(page).hasAttribute("hx-get")).toBe(false);
	});

	it("asks for a reconnect when discovery needs one", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "reconnect", state: "running" });
		await gmail.bundle.gmailDiscoveryStore.failDiscovery({ userId, generation: "reconnect", error: "invalid_grant", requiresReconnect: true });
		const doc = load((await agent.get(GMAIL)).text);
		expect(sections(doc)).toEqual([]);
		const reconnect = doc.querySelector("[data-test-gmail-metadata-reconnect] form");
		expect(reconnect?.getAttribute("action")).toBe(
			"/integrations/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=grant-sender-access",
		);
	});

	it("retains setup instructions and polls Gmail confirmation", async () => {
		const { agent, gatewayAddress } = await connectedAgent({ confirmed: false });
		const doc = load((await agent.get(GMAIL)).text);
		expect(doc.querySelector("[data-test-gmail-address]")?.textContent).toBe(gatewayAddress);
		expect(doc.querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=1&state=awaiting-confirmation`);
		const response = await agent.get(`${GMAIL}/status?poll=1&state=awaiting-confirmation`);
		expect(load(response.text).querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=2&state=awaiting-confirmation`);
		expect((await agent.get(`${GMAIL}/status?poll=100&state=awaiting-confirmation`)).text).toContain("Still waiting");
	});

	it("shows only the reconnect once Google ends the grant", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		const doc = load((await agent.get(GMAIL)).text);
		expect(sections(doc)).toEqual(["reconnect"]);
		expect(doc.querySelector("[data-test-gmail-state]")?.getAttribute("data-test-gmail-state")).toBe("revoked");
		const reconnect = doc.querySelector("[data-test-gmail-reconnect] form");
		expect(reconnect?.getAttribute("method")).toBe("POST");
		expect(reconnect?.getAttribute("action")).toBe("/integrations/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=reconnect");
		expect(doc.querySelector("[data-test-gmail-filter-state]")?.getAttribute("data-test-gmail-filter-state")).toBe("reconnect");
	});

	it("stops handing out a gateway address that has been switched off", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ confirmed: false });
		await gmail.addresses.disableAddress({ userId, address: gatewayAddress });
		const doc = load((await agent.get(GMAIL)).text);
		expect(sections(doc)).toEqual(["senders"]);
		expect(alertKeys(doc)).toEqual(["gateway_disabled"]);
	});

	it("names the readlist whose forwarding rule ran out of room and offers a retry", async () => {
		const { agent, gmail, userId, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const { address } = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: TECH });
		await gmail.bundle.gmailConnectionStore.recordFilterError({
			userId,
			error: { code: "query-too-long", forwardTo: address, senderCount: 40, senderCapacity: 36, at: "2026-09-16T00:00:00.000Z" },
		});
		const doc = load((await agent.get(GMAIL)).text);
		const filter = doc.querySelector('[data-test-gmail-filter-state="failed"]');
		assert(filter, "the failed filter state must render");
		expect(alertKeys(doc)).toEqual([]);
		const alert = filter.querySelector('[data-test-alert="gmail-filter"]');
		assert(alert, "the failed filter state must render an error alert");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
			"Gmail's forwarding rule for Tech ran out of room at 36 of its 40 senders. Remove some newsletters, or move some to another readlist, then try again.",
		);
		const retry = filter.querySelector('[data-test-gmail-filter-action="retry"]')?.closest("form");
		assert(retry, "the failed filter state must offer a retry action");
		expect(retry.getAttribute("method")).toBe("POST");
		expect(new URL(retry.getAttribute("action") ?? "", "https://readplace.com").pathname).toBe(RETRY);
	});

	it("names senders without a readlist when the gateway rule ran out of room, and quotes Gmail's rejection", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.recordFilterError({
			userId,
			error: { code: "query-too-long", forwardTo: gatewayAddress, senderCount: 40, senderCapacity: 36, at: "2026-09-16T00:00:00.000Z" },
		});
		expect(load((await agent.get(GMAIL)).text).querySelector('[data-test-alert="gmail-filter"] [data-test-alert-message]')?.textContent).toBe(
			"Gmail's forwarding rule for senders without a readlist ran out of room at 36 of its 40 senders. Remove some newsletters, or move some to another readlist, then try again.",
		);
		await gmail.bundle.gmailConnectionStore.recordFilterError({
			userId,
			error: { code: "rejected", message: "Unrecognized forwarding address", at: "2026-09-16T00:00:00.000Z" },
		});
		expect(load((await agent.get(GMAIL)).text).querySelector('[data-test-alert="gmail-filter"] [data-test-alert-message]')?.textContent).toBe(
			"Gmail didn't accept the forwarding rule (Unrecognized forwarding address). Try again.",
		);
	});

	it("retries a filter rewrite after a failure", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.recordFilterError({ userId, error: { code: "rejected", message: "Unrecognized forwarding address", at: "2026-09-16T00:00:00.000Z" } });
		const response = await agent.post(RETRY).send();
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`${GMAIL}?notice=filter_retry_requested`);
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "retry-requested" }]);
	});

	it("does not retry before forwarding is confirmed or after Gmail is revoked", async () => {
		const unconfirmed = await connectedAgent({ confirmed: false });
		expect((await unconfirmed.agent.post(RETRY).send()).headers.location).toBe(GMAIL);
		expect(unconfirmed.gmail.rewriteRequests).toEqual([]);
		const revoked = await connectedAgent();
		await revoked.gmail.bundle.gmailConnectionStore.markRevoked({ userId: revoked.userId, reason: "invalid-grant" });
		expect((await revoked.agent.post(RETRY).send()).headers.location).toBe(GMAIL);
		expect(revoked.gmail.rewriteRequests).toEqual([]);
	});

	it("shows each newsletter's forwarding as pending until the filter rewrite records it, then live", async () => {
		let now = new Date("2026-09-16T00:00:00.000Z");
		const { agent, gmail, userId, mapSender } = await connectedAgent({ now: () => now });
		await mapSender(TLDR, "default");
		now = new Date("2026-09-16T00:01:00.000Z");
		await gmail.bundle.gmailConnectionStore.recordFilter({ userId, filterCount: 1, filterSenderCount: 1 });
		now = new Date("2026-09-16T00:02:00.000Z");
		await mapSender(MORNING, "default");
		const doc = load((await agent.get(GMAIL)).text);
		expect(row(doc, TLDR).querySelector("[data-test-gmail-forwarding-state]")?.getAttribute("data-test-gmail-forwarding-state")).toBe("live");
		expect(row(doc, MORNING).querySelector("[data-test-gmail-forwarding-state]")?.getAttribute("data-test-gmail-forwarding-state")).toBe("pending");
		const filter = doc.querySelector('[data-test-gmail-filter-state="updating"]');
		assert(filter, "the pending sender must make the filter state updating");
		expect(filter.querySelector("[data-test-gmail-filter-message]")?.textContent).toBe("Gmail hasn't accepted the latest change yet. Refresh in a moment, or try again.");
		now = new Date("2026-09-16T00:03:00.000Z");
		await gmail.bundle.gmailConnectionStore.recordFilter({ userId, filterCount: 1, filterSenderCount: 2 });
		const live = load((await agent.get(GMAIL)).text);
		expect(live.querySelector("[data-test-gmail-filter-message]")?.textContent).toBe("Gmail is forwarding 2 senders.");
	});

	it("shows forwarding waiting for confirmation during Step 2 and failed once the rule is rejected", async () => {
		const unconfirmed = await connectedAgent({ confirmed: false });
		await unconfirmed.mapSender(TLDR, "default");
		const waiting = load((await unconfirmed.agent.get(GMAIL)).text);
		expect(row(waiting, TLDR).querySelector("[data-test-gmail-forwarding-state]")?.textContent).toBe("Waiting for forwarding confirmation");
		expect(waiting.querySelector("[data-test-gmail-filter-message]")?.textContent).toBe("Forwarding starts once Gmail confirms the forwarding address.");
		const rejected = await connectedAgent();
		await rejected.mapSender(TLDR, "default");
		await rejected.gmail.bundle.gmailConnectionStore.recordFilterError({ userId: rejected.userId, error: { code: "rejected", message: "No", at: AT } });
		expect(row(load((await rejected.agent.get(GMAIL)).text), TLDR).querySelector("[data-test-gmail-forwarding-state]")?.textContent).toBe("Not forwarding");
	});

	it("surfaces a failed confirmation, keeps watching, and confirms once Google sends a new link", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ confirmed: false });
		await gmail.bundle.gmailConnectionStore.recordConfirmError({ userId, error: { reason: "token-rejected", at: "2026-09-14T00:00:00.000Z" } });
		const doc = load((await agent.get(GMAIL)).text);
		expect(doc.querySelector("[data-test-gmail-state]")?.getAttribute("data-test-gmail-state")).toBe("confirm-failed");
		const confirmationAlert = doc.querySelector('[data-test-alert="confirm_failed"]');
		assert(confirmationAlert, "the failed confirmation must render an alert");
		expect(confirmationAlert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(confirmationAlert.textContent).toContain("already been used or had expired");
		expect(doc.querySelector("[data-test-gmail-address]")?.textContent).toBe(gatewayAddress);
		expect(doc.querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=1&state=confirm-failed`);
		const fragment = await agent.get(`${GMAIL}/status?poll=1&state=confirm-failed`);
		expect(load(fragment.text).querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=2&state=confirm-failed`);
		expect((await agent.get(`${GMAIL}/status?poll=1&state=awaiting-confirmation`)).headers.location).toBe(GMAIL);
		expect((await agent.get(`${GMAIL}/status?poll=1&state=awaiting-confirmation`).set("HX-Request", "true")).headers["hx-redirect"]).toBe(GMAIL);
		await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
		expect((await agent.get(`${GMAIL}/status?poll=1&state=confirm-failed`)).headers.location).toBe(`${GMAIL}?notice=confirmed`);
	});

	it("redirects a poll that names no state so the page re-renders", async () => {
		const { agent } = await connectedAgent({ confirmed: false });
		expect((await agent.get(`${GMAIL}/status?poll=1`)).headers.location).toBe(GMAIL);
	});

	it("redirects completed confirmation with and without htmx", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		expect((await agent.get(`${GMAIL}/status`)).headers.location).toBe(`${GMAIL}?notice=confirmed`);
		expect((await agent.get(`${GMAIL}/status`).set("HX-Request", "true")).headers["hx-redirect"]).toBe(`${GMAIL}?notice=confirmed`);
		await gmail.bundle.gmailConnectionStore.deleteConnection(userId);
		expect((await agent.get(`${GMAIL}/status`)).headers.location).toBe("/integrations");
	});
});

describe("Choose a readlist", () => {
	it("offers All and every custom readlist once a newsletter is chosen, keeping the rest of the state", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const doc = load((await agent.get(`${GMAIL}?search=dan&sender=${encodeURIComponent(TLDR)}&readlist=tech&edit=1&discovery=started`)).text);
		const picker = doc.querySelector("[data-test-gmail-readlist-picker]");
		assert(picker);
		expect(picker.hasAttribute("open")).toBe(true);
		const options = Array.from(doc.querySelectorAll("[data-test-gmail-readlist-option]"));
		expect(options.map((option) => [option.getAttribute("data-test-gmail-readlist-option"), option.textContent, option.getAttribute("aria-current")])).toEqual([
			["default", "All", "false"],
			["tech", "Tech", "true"],
		]);
		const all = options[0]?.closest("form");
		assert(all);
		expect(hiddenFields(all)).toEqual({
			search: "dan",
			sender: TLDR,
			readlist: "default",
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "choose-readlist",
		});
		const create = doc.querySelector("[data-test-gmail-readlist-create]");
		assert(create);
		expect(create.getAttribute("action")).toBe(`${CREATE_READLIST}?utm_source=integrations-gmail&utm_medium=internal&utm_content=create-readlist`);
		expect(hiddenFields(create)).toEqual({ search: "dan", sender: TLDR, edit: "1" });
		expect(create.querySelector('input[name="readlist_name"]')?.getAttribute("maxlength")).toBe("24");
	});

	it("closes the readlist picker once a readlist is chosen and hides the save form until both are chosen", async () => {
		const { agent } = await connectedAgent();
		const chosen = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default`)).text);
		expect(chosen.querySelector("[data-test-gmail-readlist-picker]")?.hasAttribute("open")).toBe(false);
		expect(chosen.querySelector("#gmail-readlist-choice")?.textContent).toBe("All");
		expect(Array.from(chosen.querySelectorAll("[data-test-gmail-save]"), (el) => el.textContent)).toEqual(["Save"]);
		const senderOnly = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=unknown`)).text);
		expect(senderOnly.querySelector("#gmail-readlist-choice")?.textContent).toBe("Choose a readlist");
		expect(Array.from(senderOnly.querySelectorAll("[data-test-gmail-save]"))).toEqual([]);
	});

	it("replaces the create form with the limit once the reader keeps the maximum number of readlists", async () => {
		const { agent, createReadlist } = await connectedAgent();
		for (let index = 0; index < READLIST_MAX_PER_USER; index++) await createReadlist({ slug: `list-${index}`, label: `List ${index}` });
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}`)).text);
		expect(doc.querySelector("[data-test-gmail-readlist-limit]")?.textContent).toBe("You can keep up to 7 readlists. Choose an existing readlist.");
		expect(doc.querySelectorAll("[data-test-gmail-readlist-option]")).toHaveLength(READLIST_MAX_PER_USER + 1);
	});

	it("creates a readlist, selects it, and keeps the chosen newsletter without saving a mapping", async () => {
		const { agent, gmail, userId, articleStore } = await connectedAgent();
		const created = await agent.post(CREATE_READLIST).type("form").send({ search: "dan", sender: TLDR, readlist_name: "Science" });
		const params = locationParams(created.headers.location);
		const definitions = await articleStore.listReadlistDefinitions(userId);
		expect(definitions.map((definition) => definition.label)).toEqual(["Science"]);
		expect(params).toEqual({ notice: "readlist_created", search: "dan", sender: TLDR, readlist: definitions[0]?.slug, discovery: "started" });
		const doc = load((await agent.get(created.headers.location)).text);
		expect(doc.querySelector('[data-test-alert="readlist_created"]')?.textContent).toBe("Readlist created. Save the mapping to use it.");
		expect(doc.querySelector("#gmail-readlist-choice")?.textContent).toBe("Science");

		const reused = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, readlist_name: "science" });
		expect(locationParams(reused.headers.location)).toEqual({ notice: "readlist_reused", sender: TLDR, readlist: definitions[0]?.slug, discovery: "started" });
		const reserved = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, readlist_name: "All" });
		expect(reserved.headers.location).toBe(`${GMAIL}?notice=readlist_reused&sender=dan%40tldr.tech&readlist=default&discovery=started`);
		expect((await articleStore.listReadlistDefinitions(userId)).map((definition) => definition.label)).toEqual(["Science"]);
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("closes the picker a mapping edit opened once a readlist is created or reused, so the edit can be saved", async () => {
		const { agent, userId, articleStore } = await connectedAgent();
		const created = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, edit: "1", readlist_name: "Science" });
		const definitions = await articleStore.listReadlistDefinitions(userId);
		expect(locationParams(created.headers.location)).toEqual({ notice: "readlist_created", sender: TLDR, readlist: definitions[0]?.slug, discovery: "started" });
		const doc = load((await agent.get(created.headers.location)).text);
		const picker = doc.querySelector("[data-test-gmail-readlist-picker]");
		assert(picker);
		expect(picker.hasAttribute("open")).toBe(false);
		const reserved = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, edit: "1", readlist_name: "All" });
		expect(reserved.headers.location).toBe(`${GMAIL}?notice=readlist_reused&sender=dan%40tldr.tech&readlist=default&discovery=started`);
	});

	it("keeps an invalid readlist name in the open picker and refuses a readlist past the limit", async () => {
		const { agent, gmail, userId, createReadlist } = await connectedAgent();
		const tooLong = "x".repeat(25);
		const invalid = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, readlist_name: tooLong });
		expect(invalid.headers.location).toBe(`${GMAIL}?error=readlist_name_invalid&sender=dan%40tldr.tech&readlist_name=${tooLong}&discovery=started`);
		const doc = load((await agent.get(invalid.headers.location)).text);
		expect(doc.querySelector("[data-test-gmail-readlist-picker]")?.hasAttribute("open")).toBe(true);
		expect(doc.querySelector<HTMLInputElement>('input[name="readlist_name"]')?.value).toBe(tooLong);
		expect(alertKeys(doc)).toEqual(["readlist_name_invalid"]);
		expect((await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR })).headers.location).toBe(`${GMAIL}?error=readlist_name_invalid&sender=dan%40tldr.tech&discovery=started`);
		for (let index = 0; index < READLIST_MAX_PER_USER; index++) await createReadlist({ slug: `list-${index}`, label: `List ${index}` });
		const limited = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, readlist_name: "Overflow" });
		expect(limited.headers.location).toBe(`${GMAIL}?error=readlist_limit&sender=dan%40tldr.tech&readlist_name=Overflow&discovery=started`);
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
	});
});

describe("Save a newsletter to a readlist", () => {
	it("saves an approved newsletter to All without suggesting it", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const save = await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default", search: "morning", advanced: "1" });
		expect(save.headers.location).toBe(`${GMAIL}?notice=sender_mapped&search=morning&advanced=1&discovery=started`);
		const saved = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: MORNING });
		assert(saved?.mappedAddress);
		const entry = await gmail.bundle.findInboxAddress(saved.mappedAddress);
		expect({ purpose: entry?.purpose, readlist: entry?.readlist }).toEqual({ purpose: "gmail-readlist", readlist: undefined });
		expect(saved.addedToFilterAt).toBeDefined();
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
		expect(gmail.newsletterSenderSubmissions).toEqual([]);
		const doc = load((await agent.get(save.headers.location)).text);
		const mapped = row(doc, MORNING);
		expect(mapped.querySelector("[data-test-gmail-mapping-source]")?.textContent).toBe(`Morning Brew${MORNING}`);
		expect(mapped.querySelector("[data-test-gmail-mapping-destination]")?.textContent).toBe("Saved to All");
		expect(doc.querySelector('[data-test-alert="sender_mapped"]')?.textContent).toBe("Mapping saved. Gmail will forward new mail from this sender.");
	});

	it("reuses one readlist address for every newsletter sent to the same custom readlist", async () => {
		const { agent, gmail, userId, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		for (const sender of [TLDR, MORNING]) await agent.post(ADD).type("form").send({ sender, readlist: "tech" });
		const rows = await gmail.bundle.gmailSenderStore.listSendersByUserId(userId);
		const addresses = new Set(rows.map((entry) => entry.mappedAddress));
		expect(addresses.size).toBe(1);
		expect((await gmail.addresses.listAddressesByUserId(userId)).filter((entry) => entry.purpose === "gmail-readlist").map((entry) => entry.readlist)).toEqual([TECH]);
		const doc = load((await agent.get(GMAIL)).text);
		expect(Array.from(doc.querySelectorAll("[data-test-gmail-mapping-destination]"), (el) => el.textContent)).toEqual(["Saved to Tech", "Saved to Tech"]);
	});

	it("submits only the address of a sender that is not an approved newsletter, including while the catalog is unavailable", async () => {
		const { agent, gmail, catalog } = await connectedAgent();
		await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });
		expect(gmail.newsletterSenderSubmissions).toEqual([{ senderEmail: TLDR }]);
		catalog.failReads(true);
		await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default" });
		expect(gmail.newsletterSenderSubmissions).toEqual([{ senderEmail: TLDR }, { senderEmail: MORNING }]);
	});

	it("shows the suggestion disclosure beside Save and offers the import only for a newsletter not yet mapped", async () => {
		const { agent, mapSender } = await connectedAgent();
		const fresh = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default`)).text);
		const form = fresh.querySelector("[data-test-gmail-save-mapping]");
		assert(form);
		expect(form.getAttribute("action")).toBe(`${ADD}?utm_source=integrations-gmail&utm_medium=internal&utm_content=save-mapping`);
		expect(hiddenFields(form)).toEqual({ sender: TLDR, readlist: "default" });
		expect(form.querySelector<HTMLInputElement>('input[name="import"]')?.checked).toBe(true);
		expect(form.querySelector("[data-test-gmail-suggestion-disclosure]")?.textContent).toBe(
			"If this sender isn't a known newsletter yet, Readplace sends only its address for review.",
		);
		const unchecked = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&import=0`)).text);
		expect(unchecked.querySelector<HTMLInputElement>('input[name="import"]')?.checked).toBe(false);
		await mapSender(TLDR, "default");
		const mapped = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default`)).text);
		expect(Array.from(mapped.querySelectorAll('[data-test-gmail-save-mapping] input[type="checkbox"]'))).toEqual([]);
	});

	it("moves a newsletter to another readlist, stops its import, and leaves a shared named inbox untouched", async () => {
		const { agent, gmail, userId, createReadlist, seedJob, findJob } = await connectedAgent({ scope: READONLY_SCOPES });
		await createReadlist({ slug: "tech", label: "Tech" });
		const named = await gmail.addresses.createAddress({ userId, domain: "read.place", name: AliasNameSchema.parse("reading"), purpose: "user-alias" });
		await gmail.addresses.setAddressReadlist({ userId, address: named.address, readlist: TECH });
		await gmail.bundle.gmailSenderStore.mapSenderToAddress({ userId, senderEmail: TLDR, mappedAddress: named.address });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		const before = await gmail.bundle.findInboxAddress(named.address);
		expect(row(load((await agent.get(GMAIL)).text), TLDR).querySelector("[data-test-gmail-mapping-destination]")?.textContent).toBe("Saved to Tech");
		const jobId = await seedJob({ sender: TLDR, destination: named.address, state: "running" });

		const moved = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });

		expect(moved.headers.location).toBe(`${GMAIL}?notice=sender_remapped&discovery=started`);
		expect(await gmail.bundle.findInboxAddress(named.address)).toEqual(before);
		const remapped = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert(remapped?.mappedAddress);
		expect((await gmail.bundle.findInboxAddress(remapped.mappedAddress))?.purpose).toBe("gmail-readlist");
		expect({ state: (await findJob(jobId))?.state, reason: (await findJob(jobId))?.cancelReason }).toEqual({ state: "cancelled", reason: "destination-changed" });
		expect(gmail.importStartRequests).toEqual([]);
		const doc = load((await agent.get(moved.headers.location)).text);
		expect(doc.querySelector('[data-test-alert="sender_remapped"]')?.textContent).toBe("Mapping updated. New mail from this sender goes to the readlist you chose.");
	});

	it("keeps the picker state and unchecks the import when validation fails", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const unknownReadlist = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "nope", search: "dan", advanced: "1" });
		expect(unknownReadlist.headers.location).toBe(`${GMAIL}?error=readlist_invalid&search=dan&advanced=1&sender=dan%40tldr.tech&readlist=nope&import=0&discovery=started`);
		const doc = load((await agent.get(unknownReadlist.headers.location)).text);
		expect(doc.querySelector("[data-test-gmail-readlist-picker]")?.hasAttribute("open")).toBe(true);
		expect(alertKeys(doc)).toEqual(["readlist_invalid"]);
		const importKept = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "nope", import: "1" });
		expect(importKept.headers.location).toBe(`${GMAIL}?error=readlist_invalid&sender=dan%40tldr.tech&readlist=nope&discovery=started`);
		for (const body of [{}, { sender: "bad", readlist: "default" }]) {
			expect((await agent.post(ADD).type("form").send(body)).headers.location).toContain("error=sender_invalid");
		}
		expect((await agent.post(ADD).type("form").send({ sender: "unknown@example.com", readlist: "default" })).headers.location).toContain("error=sender_unknown");
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("refuses another reader's readlist without minting an address", async () => {
		const { agent, gmail, userId, harness, createReadlist } = await connectedAgent();
		const other = await harness.auth.createUser({ email: "other@example.com", password: "password123" });
		assert(other.ok);
		await createReadlist({ slug: "secret", label: "Secret", owner: other.userId });
		const response = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "secret" });
		expect(response.headers.location).toContain("error=readlist_invalid");
		expect((await gmail.addresses.listAddressesByUserId(userId)).map((entry) => entry.purpose)).toEqual(["gmail-forwarding"]);
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
	});

	it.each(["account", "gateway", "missing"])("rejects a stale picker submission when its discovery %s no longer matches the connection", async (change) => {
		const { agent, gmail, userId } = await connectedAgent();
		if (change === "account") {
			await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("another@gmail.com") });
		} else if (change === "gateway") {
			const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
			await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
			await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: EMAIL });
		} else {
			await gmail.bundle.gmailDiscoveryStore.deleteDiscoveryByUserId(userId);
		}
		const before = await gmail.addresses.listAddressesByUserId(userId);
		const response = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });
		expect(response.headers.location).toContain("error=sender_unknown");
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect(await gmail.addresses.listAddressesByUserId(userId)).toEqual(before);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("lets an existing mapping be reassigned before mailbox reconsent", async () => {
		const { agent, gmail, userId } = await connectedAgent({ discovered: false, scope: GMAIL_SETTINGS_SCOPE });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		expect((await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" })).headers.location).toBe(`${GMAIL}?notice=sender_remapped&discovery=started`);
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }))?.mappedAddress).toBeDefined();
	});

	it("saves a mapping during Step 2 and says forwarding starts after confirmation", async () => {
		const { agent, gmail, userId } = await connectedAgent({ confirmed: false });
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });
		const doc = load((await agent.get(save.headers.location)).text);
		expect(doc.querySelector("[data-test-gmail-state]")?.getAttribute("data-test-gmail-state")).toBe("awaiting-confirmation");
		const notice = doc.querySelector('[data-test-alert="sender_mapped"]');
		assert(notice);
		expect(notice.getAttribute("data-test-alert-variant")).toBe("success");
		expect(notice.textContent).toBe("Mapping saved. New mail from this sender will be forwarded once Gmail confirms the forwarding address.");
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
	});

	it("starts an import of unread messages when the reader already granted read access", async () => {
		const { agent, gmail, userId } = await connectedAgent({ scope: READONLY_SCOPES });
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });
		expect(save.headers.location).toBe(`${GMAIL}?notice=import_started&discovery=started`);
		const [job] = await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId);
		assert(job);
		const saved = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		expect({ state: job.state, sender: job.senderEmail, destination: job.destinationAddress }).toEqual({ state: "queued", sender: TLDR, destination: saved?.mappedAddress });
		expect(gmail.importStartRequests).toEqual([{ userId, jobId: job.jobId, generation: job.generation }]);
		const doc = load((await agent.get(save.headers.location)).text);
		expect(row(doc, TLDR).querySelector("[data-test-gmail-import-state]")?.getAttribute("data-test-gmail-import-state")).toBe("queued");
		expect(doc.querySelector('[data-test-alert="import_started"]')?.textContent).toBe("Importing unread messages from the last 30 days.");
	});

	it("waits for permission and asks for it when the reader has not granted read access", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });
		expect(save.headers.location).toBe(`${GMAIL}?notice=import_permission_needed&discovery=started`);
		const [job] = await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId);
		expect(job?.state).toBe("awaiting-permission");
		expect(gmail.importStartRequests).toEqual([]);
		const doc = load((await agent.get(save.headers.location)).text);
		const mapped = row(doc, TLDR);
		const consent = mapped.querySelector("[data-test-gmail-import-consent] form");
		assert(consent);
		expect(consent.getAttribute("method")).toBe("POST");
		expect(consent.getAttribute("action")).toBe("/integrations/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=grant-import-permission");
		expect(hiddenFields(consent)).toEqual({ intent: "import", sender: TLDR });
		expect(rowActionKeys(mapped)).toEqual(["edit", "cancel-import", "remove"]);
		const picking = load((await agent.get(`${GMAIL}?search=dan&advanced=1&sender=${encodeURIComponent(MORNING)}&readlist=default&edit=1`)).text);
		const carried = row(picking, TLDR).querySelector("[data-test-gmail-import-consent] form");
		assert(carried);
		expect(Array.from(carried.querySelectorAll<HTMLInputElement>('input[type="hidden"]'), (input) => [input.name, input.value])).toEqual([
			["search", "dan"],
			["advanced", "1"],
			["readlist", "default"],
			["intent", "import"],
			["sender", TLDR],
		]);
	});

	it("treats choosing a readlist for a legacy newsletter as an edit, without the import option", async () => {
		const { agent, gmail, userId } = await connectedAgent({ discovered: false, scope: READONLY_SCOPES });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		const editing = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&edit=1`)).text);
		const form = editing.querySelector("[data-test-gmail-save-mapping]");
		assert(form);
		expect(Array.from(form.querySelectorAll('input[type="checkbox"]'))).toEqual([]);
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });
		expect(save.headers.location).toBe(`${GMAIL}?notice=sender_remapped&discovery=started`);
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }))?.mappedAddress).toBeDefined();
		expect(await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId)).toEqual([]);
		expect(gmail.importStartRequests).toEqual([]);
	});

	it("confirms the saved mapping while explaining why its import could not start", async () => {
		const { agent, gmail, userId, seedJob } = await connectedAgent({ scope: READONLY_SCOPES });
		const earlier = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG });
		await seedJob({ sender: TLDR, destination: earlier.address, state: "running" });
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });
		expect(save.headers.location).toBe(`${GMAIL}?error=import_in_progress&notice=sender_mapped&discovery=started`);
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }))?.addedToFilterAt).toBeDefined();
		const doc = load((await agent.get(save.headers.location)).text);
		expect([
			doc.querySelector('[data-test-alert="sender_mapped"]')?.textContent,
			doc.querySelector('[data-test-alert="import_in_progress"]')?.textContent,
		]).toEqual([
			"Mapping saved. Gmail will forward new mail from this sender.",
			"An import for this newsletter is already underway. Wait for it to finish, or cancel it first.",
		]);
	});
});

describe("Your newsletters", () => {
	it("explains legacy, disabled, missing and foreign destinations and falls back to All for a deleted readlist", async () => {
		const { agent, gmail, userId, harness } = await connectedAgent({ discovered: false });
		const LEGACY = ForwardableSenderSchema.parse("legacy@example.com");
		const DISABLED = ForwardableSenderSchema.parse("disabled@example.com");
		const MISSING = ForwardableSenderSchema.parse("missing@example.com");
		const FOREIGN = ForwardableSenderSchema.parse("foreign@example.com");
		const DELETED = ForwardableSenderSchema.parse("deleted@example.com");
		const other = await harness.auth.createUser({ email: "other@example.com", password: "password123" });
		assert(other.ok);
		const disabled = await gmail.addresses.createAddress({ userId, domain: "read.place", name: AliasNameSchema.parse("old"), purpose: "gmail-mapped" });
		await gmail.addresses.disableAddress({ userId, address: disabled.address });
		const foreign = await gmail.bundle.getOrCreateReadlistAddress({ userId: other.userId, readlist: DEFAULT_READLIST_SLUG });
		const deleted = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: ReadlistSlugSchema.parse("gone") });
		const mappings: [ForwardableSender, InboxAddress | undefined][] = [
			[LEGACY, undefined],
			[DISABLED, disabled.address],
			[MISSING, InboxAddressSchema.parse("vanished-abc123@read.place")],
			[FOREIGN, foreign.address],
			[DELETED, deleted.address],
		];
		for (const [sender, address] of mappings) {
			if (address !== undefined) await gmail.bundle.gmailSenderStore.mapSenderToAddress({ userId, senderEmail: sender, mappedAddress: address });
			await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: sender });
		}
		const doc = load((await agent.get(GMAIL)).text);
		const described = (sender: string) => {
			const mapped = row(doc, sender);
			return [
				mapped.querySelector("[data-test-gmail-mapping-destination]")?.getAttribute("data-destination-kind"),
				mapped.querySelector("[data-test-gmail-mapping-destination]")?.textContent,
				mapped.querySelector(".gmail-mappings__note")?.textContent,
				mapped.querySelector("[data-test-gmail-forwarding-state]")?.textContent,
				rowActionKeys(mapped),
			];
		};
		expect(described(LEGACY)).toEqual(["unresolved", "Saved to Choose a readlist", "No readlist yet. Change the readlist to choose one.", "Not forwarding", ["edit", "remove"]]);
		expect(described(DISABLED)).toEqual(["unresolved", "Saved to Choose a readlist", "Its destination was switched off. Change the readlist to choose one.", "Not forwarding", ["edit", "remove"]]);
		expect(described(MISSING)).toEqual(["unresolved", "Saved to Choose a readlist", "Its destination no longer exists. Change the readlist to choose one.", "Not forwarding", ["edit", "remove"]]);
		expect(described(FOREIGN)).toEqual(["unresolved", "Saved to Choose a readlist", "Its destination no longer exists. Change the readlist to choose one.", "Not forwarding", ["edit", "remove"]]);
		expect(described(DELETED)).toEqual(["readlist", "Saved to All", undefined, "Waiting for Gmail", ["edit", "start-import", "remove"]]);
		const edit = rowAction(row(doc, LEGACY), "edit");
		expect(edit.getAttribute("method")).toBe("GET");
		expect(hiddenFields(edit)).toEqual({ sender: LEGACY, edit: "1", discovery: "started", utm_source: "integrations-gmail", utm_medium: "internal", utm_content: "edit-mapping" });
	});

	it("says a newsletter without a live readlist is not forwarding even when Gmail's filter is live", async () => {
		let now = new Date("2026-09-16T00:00:00.000Z");
		const { agent, gmail, userId, mapSender } = await connectedAgent({ discovered: false, now: () => now });
		const LEGACY = ForwardableSenderSchema.parse("legacy@example.com");
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: LEGACY });
		await mapSender(TLDR, "default");
		now = new Date("2026-09-16T00:01:00.000Z");
		await gmail.bundle.gmailConnectionStore.recordFilter({ userId, filterCount: 1, filterSenderCount: 2 });
		const doc = load((await agent.get(GMAIL)).text);
		const forwarding = (sender: string) => row(doc, sender).querySelector("[data-test-gmail-forwarding-state]")?.getAttribute("data-test-gmail-forwarding-state");
		expect([forwarding(LEGACY), forwarding(TLDR)]).toEqual(["failed", "live"]);
	});

	it("points unresolved newsletters at reconnecting while the readlist picker is hidden", async () => {
		const { agent, gmail, userId } = await connectedAgent({ discovered: false, scope: GMAIL_SETTINGS_SCOPE });
		const LEGACY = ForwardableSenderSchema.parse("legacy@example.com");
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: LEGACY });
		const doc = load((await agent.get(GMAIL)).text);
		const mapped = row(doc, LEGACY);
		expect(sections(doc)).toEqual([]);
		expect([mapped.querySelector(".gmail-mappings__note")?.textContent, rowActionKeys(mapped)]).toEqual([
			"No readlist yet. Reconnect Gmail to choose one.",
			["remove"],
		]);
	});

	it("keeps every mapping action on the GMail Newsletters page with no link to inbox management", async () => {
		const { agent, mapSender } = await connectedAgent();
		await mapSender(TLDR, "default");
		const doc = load((await agent.get(GMAIL)).text);
		const section = doc.querySelector("#gmail-mappings");
		assert(section);
		const targets = Array.from(section.querySelectorAll("form"), (form) => new URL(form.getAttribute("action") ?? "", "https://readplace.com").pathname);
		expect([...new Set(targets)].sort()).toEqual([GMAIL, IMPORT_START, REMOVE, RETRY].sort());
		expect(Array.from(section.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual([]);
		const edit = rowAction(row(doc, TLDR), "edit");
		expect(hiddenFields(edit)).toMatchObject({ sender: TLDR, readlist: "default", edit: "1" });
		const remove = rowAction(row(doc, TLDR), "remove");
		expect(remove.getAttribute("action")).toBe(`${REMOVE}?utm_source=integrations-gmail&utm_medium=internal&utm_content=remove-mapping`);
	});

	it("shows an empty list before any newsletter is mapped", async () => {
		const { agent } = await connectedAgent();
		const doc = load((await agent.get(GMAIL)).text);
		expect(doc.querySelector("[data-test-gmail-mappings-empty]")?.textContent).toBe("No newsletters mapped yet. Choose a newsletter and a readlist above.");
		expect(doc.querySelector("[data-test-gmail-filter-message]")?.textContent).toBe("No forwarding rule in Gmail yet.");
	});

	it.each<[string, { state: GmailHistoryImportState; counts?: Partial<GmailHistoryImportCounts>; failureReason?: GmailHistoryImportFailureReason; cancelReason?: GmailHistoryImportCancelReason }, boolean, string, string[], string[], boolean]>([
		["no import", { state: "complete", counts: { listed: 0 } }, true, "No unread messages from the last 30 days.", [], ["edit", "start-import", "remove"], false],
		["waiting for permission with read access", { state: "awaiting-permission" }, true, "Waiting for permission to read your Gmail messages.", [], ["edit", "retry-import", "cancel-import", "remove"], false],
		["queued", { state: "queued" }, false, "Import queued.", [], ["edit", "cancel-import", "remove"], false],
		["running", { state: "running", counts: { listed: 4, imported: 2 } }, false, "Importing unread messages from the last 30 days…", ["2 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "cancel-import", "remove"], false],
		["complete", { state: "complete", counts: { listed: 5, imported: 3, alreadyImported: 1, skippedNoMessageId: 1 } }, false, "Import complete. Article links may still be processing.", ["3 imported", "1 already imported", "1 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "start-import", "remove"], false],
		["partly failed with read access", { state: "complete", counts: { listed: 3, imported: 1, skippedSenderMismatch: 1, failed: 1 } }, true, "Import finished, but some messages failed. Article links may still be processing.", ["1 imported", "0 already imported", "0 skipped (no message ID)", "1 skipped (different sender)", "1 failed"], ["edit", "retry-import", "remove"], false],
		["partly failed without read access", { state: "complete", counts: { listed: 1, failed: 1 } }, false, "Import finished, but some messages failed. Article links may still be processing.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "1 failed"], ["edit", "remove"], true],
		["failed after Gmail rejected it", { state: "failed", failureReason: "gmail-rejected" }, true, "Gmail refused the import.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "retry-import", "remove"], false],
		["failed after permission was revoked", { state: "failed", failureReason: "permission-revoked" }, false, "Readplace lost permission to read your Gmail messages.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "remove"], true],
		["dead-lettered", { state: "failed", failureReason: "dead-lettered" }, true, "The import stopped after repeated errors.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "retry-import", "remove"], false],
		["cancelled", { state: "cancelled", cancelReason: "user-cancelled", counts: { imported: 2, cancelled: 3 } }, false, "Import cancelled.", ["2 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed", "3 cancelled"], ["edit", "start-import", "remove"], false],
		["stopped by removal", { state: "cancelled", cancelReason: "mapping-removed" }, false, "Import stopped because the mapping was removed.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed", "0 cancelled"], ["edit", "start-import", "remove"], false],
		["stopped by a readlist change", { state: "cancelled", cancelReason: "destination-changed" }, false, "Import stopped because the readlist changed.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed", "0 cancelled"], ["edit", "start-import", "remove"], false],
		["stopped by disconnect", { state: "cancelled", cancelReason: "disconnected" }, false, "Import stopped because Gmail was disconnected.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed", "0 cancelled"], ["edit", "start-import", "remove"], false],
		["stopped by an account change", { state: "cancelled", cancelReason: "account-changed" }, false, "Import stopped because a different Gmail account is connected.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed", "0 cancelled"], ["edit", "start-import", "remove"], false],
	])("reports an import that is %s with the actions it allows", async (_label, job, readonly, message, counts, actions, consent) => {
		const { agent, mapSender, seedJob } = await connectedAgent({ scope: readonly ? READONLY_SCOPES : GMAIL_SCOPES });
		const destination = await mapSender(TLDR, "default");
		await seedJob({ sender: TLDR, destination, state: "complete", createdAt: "2026-09-01T00:00:00.000Z" });
		await seedJob({ sender: TLDR, destination, ...job });
		const mapped = row(load((await agent.get(GMAIL)).text), TLDR);
		expect(mapped.querySelector(".gmail-mappings__import-message")?.textContent ?? "").toBe(message);
		expect(Array.from(mapped.querySelectorAll("[data-test-gmail-import-count]"), (el) => el.textContent)).toEqual(counts);
		expect(rowActionKeys(mapped)).toEqual(actions);
		expect(Array.from(mapped.querySelectorAll("[data-test-gmail-import-consent]")).length === 1).toBe(consent);
	});

	it("offers to import for a mapping that never imported", async () => {
		const { agent, mapSender } = await connectedAgent();
		await mapSender(TLDR, "default");
		const mapped = row(load((await agent.get(GMAIL)).text), TLDR);
		expect(mapped.querySelector("[data-test-gmail-import-state]")?.getAttribute("data-test-gmail-import-state")).toBe("none");
		expect(rowActionKeys(mapped)).toEqual(["edit", "start-import", "remove"]);
	});

	it("polls the mappings while an import runs, keeps the picker state, and stops at the poll budget", async () => {
		const { agent, mapSender, seedJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		await seedJob({ sender: TLDR, destination, state: "running" });
		const first = load((await agent.get(`${GMAIL}?search=dan&sender=${encodeURIComponent(MORNING)}`)).text);
		const section = first.querySelector("#gmail-mappings");
		assert(section);
		expect(section.getAttribute("data-imports-polling")).toBe("true");
		expect(section.getAttribute("hx-get")).toBe(`${GMAIL}?search=dan&sender=crew%40morningbrew.com&discovery=started&imports_poll=1`);
		expect(section.getAttribute("hx-select")).toBe("#gmail-mappings");
		const next = load((await agent.get(`${GMAIL}?discovery=started&imports_poll=99`)).text).querySelector("#gmail-mappings");
		expect(next?.getAttribute("hx-get")).toBe(`${GMAIL}?discovery=started&imports_poll=100`);
		const exhausted = load((await agent.get(`${GMAIL}?discovery=started&imports_poll=100`)).text);
		expect(exhausted.querySelector("#gmail-mappings")?.getAttribute("data-imports-polling")).toBe("false");
		expect(exhausted.querySelector("#gmail-mappings")?.hasAttribute("hx-get")).toBe(false);
		expect(exhausted.querySelector("[data-test-gmail-imports-exhausted]")?.textContent).toBe("Still importing. Refresh to check again.");
	});
});

describe("Import unread messages", () => {
	it("starts an import for a mapped newsletter and keeps the page state", async () => {
		const { agent, gmail, userId, mapSender } = await connectedAgent({ scope: READONLY_SCOPES });
		await mapSender(TLDR, "default");
		const started = await agent.post(IMPORT_START).type("form").send({ sender: TLDR, search: "dan", readlist: "default", edit: "1" });
		expect(started.headers.location).toBe(`${GMAIL}?notice=import_started&search=dan&readlist=default&discovery=started`);
		const [job] = await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId);
		assert(job);
		expect(gmail.importStartRequests).toEqual([{ userId, jobId: job.jobId, generation: job.generation }]);
		const again = await agent.post(IMPORT_START).type("form").send({ sender: TLDR });
		expect(again.headers.location).toBe(`${GMAIL}?error=import_in_progress&discovery=started`);
		expect(await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId)).toHaveLength(1);
	});

	it("refuses an import for a sender without a live readlist mapping", async () => {
		const { agent, gmail, userId, mapSender } = await connectedAgent({ scope: READONLY_SCOPES });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		const disabled = await mapSender(MORNING, "default");
		await gmail.addresses.disableAddress({ userId, address: disabled });
		for (const sender of [TLDR, MORNING, ForwardableSenderSchema.parse("unmapped@example.com")]) {
			expect((await agent.post(IMPORT_START).type("form").send({ sender })).headers.location).toBe(`${GMAIL}?error=import_unavailable&discovery=started`);
		}
		expect((await agent.post(IMPORT_START).type("form").send({ sender: "bad" })).headers.location).toBe(`${GMAIL}?error=sender_invalid&discovery=started`);
		expect(await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId)).toEqual([]);
		expect(gmail.importStartRequests).toEqual([]);
	});

	it("asks for a reconnect before importing through a connection that never recorded its Gmail account", async () => {
		const { agent, gmail, mapSender } = await connectedAgent({ discovered: false, accountEmail: false, scope: READONLY_SCOPES });
		await mapSender(TLDR, "default");
		const started = await agent.post(IMPORT_START).type("form").send({ sender: TLDR });
		expect(started.headers.location).toBe(`${GMAIL}?error=import_reconnect_required&discovery=started`);
		expect(gmail.importStartRequests).toEqual([]);
		const doc = load((await agent.get(started.headers.location)).text);
		expect(doc.querySelector('[data-test-alert="import_reconnect_required"]')?.textContent).toBe(
			"Readplace doesn't know which Gmail account this connection belongs to, so it can't import unread messages. Disconnect Gmail below and connect it again to import them.",
		);
	});

	it("leaves reconnecting as the only way forward for imports once Google ends the grant", async () => {
		const { agent, gmail, userId, mapSender, seedJob, findJob } = await connectedAgent({ scope: READONLY_SCOPES });
		const destination = await mapSender(TLDR, "default");
		const jobId = await seedJob({ sender: TLDR, destination, state: "failed", failureReason: "permission-revoked" });
		await mapSender(MORNING, "default");
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		const doc = load((await agent.get(GMAIL)).text);
		expect([rowActionKeys(row(doc, TLDR)), rowActionKeys(row(doc, MORNING))]).toEqual([["remove"], ["remove"]]);
		const started = await agent.post(IMPORT_START).type("form").send({ sender: MORNING });
		expect(started.headers.location).toBe(`${GMAIL}?error=import_revoked&discovery=started`);
		expect((await agent.post(IMPORT_RETRY).type("form").send({ job: jobId })).headers.location).toBe(`${GMAIL}?error=import_revoked&discovery=started`);
		expect((await findJob(jobId))?.state).toBe("failed");
		expect(await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId)).toHaveLength(1);
		expect(gmail.importStartRequests).toEqual([]);
		expect(load((await agent.get(started.headers.location)).text).querySelector('[data-test-alert="import_revoked"]')?.textContent).toBe(
			"Google ended the connection, so Readplace can't import unread messages. Reconnect Gmail to import them.",
		);
	});

	it("saves a new mapping without starting its import once Google ends the grant", async () => {
		const { agent, gmail, userId } = await connectedAgent({ scope: READONLY_SCOPES });
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		const saved = await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default", import: "1" });
		expect(locationParams(saved.headers.location)).toEqual({ error: "import_revoked", notice: "sender_mapped", discovery: "started" });
		expect(await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId)).toEqual([]);
		expect(gmail.importStartRequests).toEqual([]);
	});

	it("offers a fresh import instead of a retry once a failed import's newsletter moves to another readlist", async () => {
		const { agent, gmail, userId, createReadlist, mapSender, seedJob, findJob } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const previous = await mapSender(TLDR, "tech");
		const jobId = await seedJob({ sender: TLDR, destination: previous, state: "failed", failureReason: "permission-revoked" });
		expect(Array.from(row(load((await agent.get(GMAIL)).text), TLDR).querySelectorAll("[data-test-gmail-mapping-action]"), (el) => el.getAttribute("data-test-gmail-mapping-action"))).toEqual([
			"grant-import-permission",
			"edit",
			"remove",
		]);
		await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });
		const moved = row(load((await agent.get(GMAIL)).text), TLDR);
		expect(moved.querySelector("[data-test-gmail-import-state]")?.getAttribute("data-test-gmail-import-state")).toBe("failed");
		expect(Array.from(moved.querySelectorAll("[data-test-gmail-mapping-action]"), (el) => el.getAttribute("data-test-gmail-mapping-action"))).toEqual([
			"edit",
			"start-import",
			"remove",
		]);
		expect((await agent.post(IMPORT_RETRY).type("form").send({ job: jobId })).headers.location).toBe(`${GMAIL}?error=import_unavailable&discovery=started`);
		await agent.post(REMOVE).type("form").send({ sender: TLDR });
		expect((await agent.post(IMPORT_RETRY).type("form").send({ job: jobId })).headers.location).toBe(`${GMAIL}?error=import_unavailable&discovery=started`);
		expect((await findJob(jobId))?.state).toBe("failed");
		expect(gmail.importStartRequests).toEqual([]);
		expect(await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId)).toHaveLength(1);
	});

	it("retries a failed import with a fresh generation once read access is granted", async () => {
		const { agent, gmail, userId, mapSender, seedJob, findJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		const jobId = await seedJob({ sender: TLDR, destination, state: "failed", failureReason: "permission-revoked" });
		expect((await agent.post(IMPORT_RETRY).type("form").send({ job: jobId, search: "dan" })).headers.location).toBe(`${GMAIL}?notice=import_permission_needed&search=dan&discovery=started`);
		expect(gmail.importStartRequests).toEqual([]);
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: READONLY_SCOPES });
		expect((await agent.post(IMPORT_RETRY).type("form").send({ job: jobId })).headers.location).toBe(`${GMAIL}?notice=import_started&discovery=started`);
		const retried = await findJob(jobId);
		expect(retried?.state).toBe("queued");
		expect(gmail.importStartRequests).toEqual([{ userId, jobId, generation: retried?.generation }]);
		expect(retried?.generation).not.toBe("seeded");
		expect((await agent.post(IMPORT_RETRY).type("form").send({ job: jobId })).headers.location).toBe(`${GMAIL}?discovery=started`);
		expect(gmail.importStartRequests).toHaveLength(1);
	});

	it("ignores retries and cancels for another reader's job or a malformed job id", async () => {
		const { agent, gmail, harness, mapSender, seedJob } = await connectedAgent({ scope: READONLY_SCOPES });
		const other = await harness.auth.createUser({ email: "other@example.com", password: "password123" });
		assert(other.ok);
		const destination = await mapSender(TLDR, "default");
		const foreignJob = await seedJob({ sender: TLDR, destination, state: "failed", failureReason: "gmail-rejected", owner: other.userId });
		const foreignRunning = await seedJob({ sender: MORNING, destination, state: "running", owner: other.userId });
		for (const [path, job] of [[IMPORT_RETRY, foreignJob], [IMPORT_CANCEL, foreignRunning], [IMPORT_RETRY, "bad"], [IMPORT_CANCEL, "bad"]] as const) {
			expect((await agent.post(path).type("form").send({ job })).headers.location).toBe(`${GMAIL}?discovery=started`);
		}
		expect((await gmail.bundle.gmailHistoryImportStore.findJob({ userId: other.userId, jobId: foreignJob }))?.state).toBe("failed");
		expect((await gmail.bundle.gmailHistoryImportStore.findJob({ userId: other.userId, jobId: foreignRunning }))?.state).toBe("running");
		expect(gmail.importStartRequests).toEqual([]);
	});

	it("cancels an unfinished import and leaves a finished one alone", async () => {
		const { agent, mapSender, seedJob, findJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		const finished = await seedJob({ sender: MORNING, destination, state: "complete", counts: { listed: 1, imported: 1 } });
		const running = await seedJob({ sender: TLDR, destination, state: "running" });
		expect((await agent.post(IMPORT_CANCEL).type("form").send({ job: finished })).headers.location).toBe(`${GMAIL}?discovery=started`);
		expect((await findJob(finished))?.state).toBe("complete");
		const cancelled = await agent.post(IMPORT_CANCEL).type("form").send({ job: running, search: "dan" });
		expect(cancelled.headers.location).toBe(`${GMAIL}?notice=import_cancelled&search=dan&discovery=started`);
		expect({ state: (await findJob(running))?.state, reason: (await findJob(running))?.cancelReason }).toEqual({ state: "cancelled", reason: "user-cancelled" });
		const doc = load((await agent.get(cancelled.headers.location)).text);
		expect(doc.querySelector('[data-test-alert="import_cancelled"]')?.textContent).toBe("Import cancelled. Messages already imported stay in your readlist.");
	});
});

describe("Remove a newsletter", () => {
	it("removes a mapping, cancels its import and keeps the search", async () => {
		const { agent, gmail, userId, mapSender, seedJob, findJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		await mapSender(MORNING, "default");
		const jobId = await seedJob({ sender: TLDR, destination, state: "running" });
		const removed = await agent.post(REMOVE).type("form").send({ sender: TLDR, search: "dan", edit: "1" });
		expect(removed.headers.location).toBe(`${GMAIL}?notice=sender_removed&search=dan&discovery=started`);
		expect((await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).map((entry) => entry.senderEmail)).toEqual([MORNING]);
		expect({ state: (await findJob(jobId))?.state, reason: (await findJob(jobId))?.cancelReason }).toEqual({ state: "cancelled", reason: "mapping-removed" });
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-removed" }]);
		expect((await gmail.bundle.findInboxAddress(destination))?.disabledAt).toBeUndefined();
		const doc = load((await agent.get(removed.headers.location)).text);
		expect(Array.from(doc.querySelectorAll("[data-test-gmail-mapping-row]"), (el) => el.getAttribute("data-test-gmail-mapping-row"))).toEqual([MORNING]);
		expect(doc.querySelector('[data-test-alert="sender_removed"]')?.textContent).toBe("Mapping removed. Articles you already saved stay in your readlists.");
	});

	it("rejects a malformed removal", async () => {
		const { agent } = await connectedAgent();
		expect((await agent.post(REMOVE).type("form").send({ sender: "bad" })).headers.location).toBe(`${GMAIL}?error=sender_invalid&discovery=started`);
	});

	it("disconnects through the background teardown and stops every import", async () => {
		const { agent, gmail, userId, mapSender, seedJob, findJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		const jobId = await seedJob({ sender: TLDR, destination, state: "queued" });
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/integrations?notice=gmail_disconnected");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
		expect((await gmail.bundle.gmailConnectionStore.findConnectionByUserId(userId))?.disconnectRequestedAt).toBeDefined();
		expect({ state: (await findJob(jobId))?.state, reason: (await findJob(jobId))?.cancelReason }).toEqual({ state: "cancelled", reason: "disconnected" });
	});

	it("republishes a pending disconnect when its first dispatch failed", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const publish = gmail.bundle.publishDisconnectGmail;
		let attempts = 0;
		gmail.bundle.publishDisconnectGmail = async (input) => {
			attempts += 1;
			if (attempts === 1) throw new Error("EventBridge unavailable");
			await publish(input);
		};
		expect((await agent.post(`${GMAIL}/disconnect`)).status).toBe(500);
		expect(gmail.disconnectRequests).toEqual([]);
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/integrations?notice=gmail_disconnected");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
		expect(attempts).toBe(2);
	});
});

describe("Read-only and locked readers", () => {
	it("lets a read-only reader remove a newsletter, cancel an import and disconnect", async () => {
		const { agent, gmail, userId, harness, mapSender, seedJob, findJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		const jobId = await seedJob({ sender: MORNING, destination, state: "running" });
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString() });
		expect((await agent.post(IMPORT_CANCEL).type("form").send({ job: jobId })).headers.location).toBe(`${GMAIL}?notice=import_cancelled&discovery=started`);
		expect((await findJob(jobId))?.state).toBe("cancelled");
		expect((await agent.post(REMOVE).type("form").send({ sender: TLDR })).headers.location).toBe(`${GMAIL}?notice=sender_removed&discovery=started`);
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect((await agent.post(`${GMAIL}/disconnect`).send()).headers.location).toBe("/integrations?notice=gmail_disconnected");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
	});

	it("lets a locked reader disconnect Gmail", async () => {
		const { agent, gmail, userId } = await connectedAgent({ appNow: () => new Date(Date.now() + 8 * ONE_DAY_MS) });
		const response = await agent.post(`${GMAIL}/disconnect`).set("Accept", "text/html").send();
		expect(response.headers.location).toBe("/integrations?notice=gmail_disconnected");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
	});

	it("still bounces a read-only reader's saves, readlist creation, discovery and imports to the inactive queue", async () => {
		const { agent, gmail, userId, harness, articleStore, mapSender } = await connectedAgent({ scope: READONLY_SCOPES });
		await mapSender(MORNING, "default");
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString() });
		for (const path of [ADD, DISCOVER, CREATE_READLIST, IMPORT_START, IMPORT_RETRY]) {
			const response = await agent.post(path).set("Accept", "text/html").type("form").send({ sender: TLDR, readlist: "default", readlist_name: "Science" });
			expect(response.headers.location).toBe("/queue?inactive=1");
		}
		expect((await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).map((entry) => entry.senderEmail)).toEqual([MORNING]);
		expect(await articleStore.listReadlistDefinitions(userId)).toEqual([]);
		expect(gmail.discoveryRequests).toEqual([]);
		expect(gmail.importStartRequests).toEqual([]);
	});
});
