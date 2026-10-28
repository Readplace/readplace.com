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
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { GMAIL_READONLY_SCOPE, GMAIL_SCOPES, GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GmailMonitoringCheckpoint } from "@packages/provider-contracts/gmail-monitoring";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { initDisconnectGmail } from "../../../domain/gmail/disconnect-gmail";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const GMAIL = "/newsletters/gmail";
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

function dialogAlertKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll('#gmail-dialog-body > [data-test-alert]'), (el) => el.getAttribute("data-test-alert"));
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

function senderStatus(doc: Document): Element {
	const element = doc.querySelector("#gmail-sender-status");
	assert(element, "the sender status must render");
	return element;
}

function checklist(doc: Document): Element {
	const element = doc.querySelector("#gmail-checklist");
	assert(element, "the newsletter checklist must render");
	return element;
}

function checklistRows(doc: Document): [string | null, string | null, string | undefined, boolean][] {
	return Array.from(checklist(doc).querySelectorAll("[data-test-gmail-checklist-row]"), (element) => {
		const checkbox = element.querySelector("[data-test-gmail-checklist-sender]");
		assert(checkbox, "every checklist row must carry its checkbox");
		return [
			element.closest("[data-test-gmail-checklist-group]")?.getAttribute("data-test-gmail-checklist-group") ?? null,
			checkbox.getAttribute("value"),
			element.querySelector("[data-test-gmail-checklist-name]")?.textContent,
			checkbox.hasAttribute("checked"),
		];
	});
}

function checklistActions(doc: Document): [string | null, string | null, string | null, string | null][] {
	return Array.from(checklist(doc).querySelectorAll("[data-test-gmail-checklist-action]"), (button) => [
		button.getAttribute("data-test-gmail-checklist-action"),
		button.getAttribute("name"),
		button.getAttribute("value"),
		button.textContent,
	]);
}

function addedFields(doc: Document): (string | null)[] {
	return Array.from(checklist(doc).querySelectorAll('input[type="hidden"][name="added"]'), (input) => input.getAttribute("value"));
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

function importSummary(element: Element): { state: string | null; message: (string | null)[]; counts: (string | null)[]; actions: (string | null)[] } {
	const summary = element.querySelector("[data-test-gmail-import-state]");
	assert(summary, "the mapping row must render its import summary");
	return {
		state: summary.getAttribute("data-test-gmail-import-state"),
		message: Array.from(summary.querySelectorAll(".gmail-mappings__import-message"), (el) => el.textContent),
		counts: Array.from(summary.querySelectorAll("[data-test-gmail-import-count]"), (el) => el.textContent),
		actions: rowActionKeys(element),
	};
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
	return { harness, gmail, catalog, articleStore: base.articleStore, now };
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
	const { harness, gmail, catalog, articleStore, now } = harnessWithGmail(options);
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
		await gmail.bundle.gmailMappingStore.mapSenderToAddress({ userId, accountEmail: EMAIL, senderEmail: sender, mappedAddresses: [entry.address], deliveryMode: "links" });
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: sender });
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
			destinationAddresses: [input.destination],
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
			createdAt: input.createdAt ?? now().toISOString(),
			updatedAt: input.createdAt ?? now().toISOString(),
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
		expect((await request(harness.server).get(GMAIL)).headers.location).toBe(`/login?return=${encodeURIComponent(GMAIL)}`);
		for (const path of [`${GMAIL}/senders`, `${GMAIL}/status`]) {
			expect((await request(harness.server).get(path)).headers.location).toBe("/login");
		}
		for (const path of [ADD, REMOVE, RETRY, DISCOVER, CREATE_READLIST, IMPORT_START, IMPORT_RETRY, IMPORT_CANCEL, `${GMAIL}/disconnect`]) {
			expect((await request(harness.server).post(path)).headers.location).toBe("/login");
		}
	});

	it("names the connected Gmail account", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(GMAIL)).text);

		const account = doc.querySelector("[data-test-gmail-account]");
		assert(account, "the account line renders in every state");
		expect(account.getAttribute("data-gmail-account-state")).toBe("shown");
		expect(account.textContent).toBe("reader@gmail.com");
	});

	it("names no account before Google has told us which one is connected", async () => {
		const { agent } = await connectedAgent({ accountEmail: false });

		const doc = load((await agent.get(GMAIL)).text);

		const account = doc.querySelector("[data-test-gmail-account]");
		assert(account, "the account line renders in every state");
		expect(account.getAttribute("data-gmail-account-state")).toBe("hidden");
	});

	it("says what Gmail forwards and where each issue lands, with a tracked link to Inbox", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(GMAIL)).text);

		const lede = doc.querySelector("[data-test-gmail-lede]");
		assert(lede, "the lede renders in the page head");
		expect(lede.textContent).toBe(
			"Readplace sets Gmail to forward copies of the newsletters you add, and nothing else. Each issue appears in your Inbox, and what you choose to save — the issue itself, the articles it links to, or both — goes to All and any readlists you pick.",
		);
		const inbox = lede.querySelector("a");
		assert(inbox, "the lede links to Inbox");
		expect(inbox.textContent).toBe("Inbox");
		expect(inbox.getAttribute("href")).toBe("/inbox?utm_source=integrations-gmail&utm_medium=internal&utm_content=inbox");
	});

	it("preserves the selected FROM and notification presentation through login", async () => {
		const { harness } = harnessWithGmail();
		const agent = request.agent(harness.server);
		const created = await harness.auth.createUser({ email: "notification-reader@example.com", password: "password123" });
		assert(created.ok);
		const destination = `${GMAIL}?sender=${encodeURIComponent(MORNING)}&notification=1&readlist_choice_for=${encodeURIComponent(MORNING)}&readlist=default&readlist=tech`;
		const anonymous = await agent.get(destination);
		const login = new URL(anonymous.headers.location, TEST_APP_ORIGIN);
		expect(login.pathname).toBe("/login");
		expect(login.searchParams.get("return")).toBe(destination);
		const signedIn = await agent.post(`${login.pathname}${login.search}`).type("form").send({ email: "notification-reader@example.com", password: "password123" });
		expect(signedIn.headers.location).toBe(destination);
	});

	it("offers and saves monitored senders only for the authenticated reader's current mailbox", async () => {
		const { agent, gmail, userId, gatewayAddress, harness } = await connectedAgent({ discovered: false });
		const checkpoint: GmailMonitoringCheckpoint = {
			userId, accountEmail: EMAIL, gatewayAddress, mailboxId: "current-mailbox", generation: "monitor", page: 0,
			mode: "complete", initializing: false, historyId: "100", pageToken: undefined, scannedCount: 1, lastCheckedAt: Date.parse(AT),
		};
		const monitoring = gmail.bundle.gmailMonitoringStore;
		await monitoring.startRun({ checkpoint, previous: undefined });
		await monitoring.observeSender({ checkpoint, observation: { email: MORNING, name: "Brew Crew", approved: true }, notify: false });
		const other = await harness.auth.createUser({ email: "other-notification-reader@example.com", password: "password123" });
		assert(other.ok);
		const foreignCheckpoint = { ...checkpoint, userId: other.userId };
		await monitoring.startRun({ checkpoint: foreignCheckpoint, previous: undefined });
		await monitoring.observeSender({ checkpoint: foreignCheckpoint, observation: { email: TLDR, name: "TLDR", approved: true }, notify: false });
		const foreign = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&notification=1`)).text);
		expect(checklistRows(foreign)).toEqual([["known", MORNING, "Morning Brew", false]]);
		expect(locationParams((await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" })).headers.location).error).toBe("sender_unknown");
		const destination = `${GMAIL}?sender=${encodeURIComponent(MORNING)}&notification=1&discovery=started`;
		const document = load((await agent.get(destination)).text);
		expect(checklistRows(document)).toEqual([["known", MORNING, "Morning Brew", true]]);
		expect(document.querySelector("#gmail-readlist-choice")?.textContent).toBe("All");
		expect(document.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
		expect(document.querySelector('input[name="readlist_choice_for"]')?.getAttribute("value")).toBe(MORNING);
		expect(Array.from(document.querySelectorAll("[data-gmail-notification-highlight]"), (element) => element.getAttribute("data-gmail-notification"))).toEqual([MORNING]);
		expect(Array.from(document.querySelectorAll('input[name="notification"]'))).toEqual([]);
		const saved = await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default", readlist_choice_for: MORNING });
		expect(locationParams(saved.headers.location).notice).toBe("sender_mapped");
		expect((await monitoring.findCheckpoint(userId))?.mailboxId).toBe("current-mailbox");
		await gmail.bundle.gmailMappingStore.removeMapping({ userId, accountEmail: EMAIL, senderEmail: MORNING });
		await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("different@gmail.com") });
		const changed = load((await agent.get(destination)).text);
		expect([checklist(changed).getAttribute("data-checklist-state"), checklistRows(changed)]).toEqual(["no-discovered-senders", []]);
		const refused = await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default" });
		expect(locationParams(refused.headers.location).error).toBe("sender_unknown");
	});

	it("locks All and requires explicit confirmation on a notification and opens an existing mapping with its destination", async () => {
		const { agent, createReadlist, mapSender } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const destination = `${GMAIL}?sender=${encodeURIComponent(MORNING)}&notification=1`;
		const document = load((await agent.get(destination)).text);
		expect(document.querySelector("#gmail-readlist-choice")?.textContent).toBe("All");
		expect(document.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(true);
		await mapSender(MORNING, "tech");
		const mapped = load((await agent.get(destination)).text);
		expect(mapped.querySelector("#gmail-readlist-choice")?.textContent).toBe("All, Tech");
		expect(mapped.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
		expect(Array.from(mapped.querySelectorAll('[data-test-gmail-save-mapping] input[name="import"]'))).toEqual([]);
	});

	it("requires a current connection before reading or changing mappings", async () => {
		const { harness } = harnessWithGmail();
		const agent = await loginAgent(harness.server, harness.auth);
		expect((await agent.get(GMAIL)).headers.location).toBe("/newsletters");
		for (const path of [ADD, CREATE_READLIST, IMPORT_START, IMPORT_RETRY, IMPORT_CANCEL, REMOVE, `${GMAIL}/disconnect`]) {
			expect((await agent.post(path).type("form").send({ sender: TLDR, readlist: "default" })).headers.location).toBe("/newsletters");
		}
		expect((await agent.get(`${GMAIL}/senders`).set("HX-Request", "true")).headers["hx-redirect"]).toBe("/newsletters");
	});

	it("redirects while disconnect is running", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.markDisconnectRequested({ userId });
		expect((await agent.get(GMAIL)).headers.location).toBe("/newsletters");
	});

	it("names the page From Gmail and lists every known newsletter unticked, named by the catalog or else the sender, without querying Gmail", async () => {
		const QUIET = ForwardableSenderSchema.parse("quiet@letters.example");
		const SHOP = ForwardableSenderSchema.parse("hello@shop.example");
		const MAPPED = ForwardableSenderSchema.parse("mapped@letters.example");
		const { agent, gmail, userId, gatewayAddress, mapSender } = await connectedAgent({
			discovered: false,
			catalog: catalogOf([[MORNING, "Morning Brew"], [TLDR, undefined], [QUIET, undefined], [MAPPED, "Mapped Weekly"]]),
		});
		await seedDiscovery({
			gmail,
			userId,
			gatewayAddress,
			senders: [...DISCOVERED, { email: QUIET, name: undefined }, { email: SHOP, name: "Shop" }, { email: MAPPED, name: "Mapped" }],
			generation: "known",
			state: "complete",
		});
		await mapSender(MAPPED, "default");

		const response = await agent.get(`${GMAIL}?add=1`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-store");
		const doc = load(response.text);
		expect(doc.title).toBe("From Gmail — Readplace");
		expect(doc.querySelector("h1")?.textContent).toBe("From Gmail");
		expect(doc.querySelector("#gmail-dialog-title")?.textContent).toBe("Add newsletters");
		expect(checklist(doc).getAttribute("data-checklist-state")).toBe("listed");
		expect(checklist(doc).querySelector(".gmail__checklist-intro")?.textContent).toBe(
			"These are the known newsletters in your Gmail. Tick the ones to send to your readlists. Looking for a sender that isn't listed? Search all your senders below and it joins this list.",
		);
		expect(checklistRows(doc)).toEqual([
			["known", TLDR, "Dan at TLDR", false],
			["known", MORNING, "Morning Brew", false],
			["known", QUIET, undefined, false],
		]);
		const checkbox = doc.querySelector(`[data-test-gmail-checklist-sender="${MORNING}"]`);
		assert(checkbox, "a known newsletter must render a checkbox");
		expect([checkbox.getAttribute("type"), checkbox.getAttribute("form"), checkbox.getAttribute("name")]).toEqual(["checkbox", "gmail-readlist-selection", "sender"]);
		expect(Array.from(checklist(doc).querySelectorAll("[data-test-gmail-checklist-group] h3"), (title) => title.textContent)).toEqual(["Known newsletters"]);
		expect(checklistActions(doc)).toEqual([["select", "select", "all", "Select all"]]);
		expect(checklist(doc).querySelector("[data-test-gmail-checklist-summary]")?.textContent).toBe(" of 3 selected");
		expect(doc.querySelector<HTMLInputElement>("#gmail-checklist-listed")?.value).toBe("3");
		expect(gmail.discoveryRequests).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("ticks every requested sender, lists an unrecognised one under the senders the reader added, and drops one the mailbox never sent", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(MORNING)}&sender=${encodeURIComponent(TLDR)}&sender=stranger%40example.com&add=1`)).text);

		expect(checklistRows(doc)).toEqual([
			["known", MORNING, "Morning Brew", true],
			["added", TLDR, "Dan at TLDR", true],
		]);
		expect(Array.from(checklist(doc).querySelectorAll("[data-test-gmail-checklist-group] h3"), (title) => title.textContent)).toEqual(["Known newsletters", "Senders you added"]);
		expect(addedFields(doc)).toEqual([TLDR]);
		expect(checklist(doc).querySelector('input[type="hidden"][name="added"]')?.getAttribute("form")).toBe("gmail-readlist-selection");
		expect(checklistActions(doc)).toEqual([["select", "select", "none", "Clear selection"]]);
		expect(checklist(doc).querySelector("[data-test-gmail-checklist-summary]")?.textContent).toBe(" of 2 selected");
	});

	it("keeps a sender the reader added on the list after its row is unticked", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(`${GMAIL}?added=${encodeURIComponent(TLDR)}&add=1`)).text);

		expect(checklistRows(doc)).toEqual([
			["known", MORNING, "Morning Brew", false],
			["added", TLDR, "Dan at TLDR", false],
		]);
		expect(addedFields(doc)).toEqual([TLDR]);
	});

	it("adds a picked sender as a ticked row and answers with the clean address, by redirect or by pushing it for htmx", async () => {
		const { agent } = await connectedAgent();
		const pickedUrl = `${GMAIL}?search=dan&sender=crew%40morningbrew.com&sender=dan%40tldr.tech&added=dan%40tldr.tech&readlist=default&add=1&discovery=started`;

		const picked = await agent.get(`${GMAIL}?sender=${encodeURIComponent(MORNING)}&search=dan&add=1&pick=${encodeURIComponent(TLDR)}`);
		const boosted = await agent.get(`${GMAIL}?sender=${encodeURIComponent(MORNING)}&search=dan&add=1&pick=${encodeURIComponent(TLDR)}`).set("HX-Request", "true");

		expect([picked.status, picked.headers.location]).toEqual([303, pickedUrl]);
		expect(checklistRows(load((await agent.get(pickedUrl)).text))).toEqual([
			["known", MORNING, "Morning Brew", true],
			["added", TLDR, "Dan at TLDR", true],
		]);
		expect([boosted.status, boosted.headers["hx-push-url"]]).toEqual([200, pickedUrl]);
		expect(checklistRows(load(boosted.text))).toEqual([
			["known", MORNING, "Morning Brew", true],
			["added", TLDR, "Dan at TLDR", true],
		]);
	});

	it("dismisses an added sender through the selection form, preserves the other choices, and keeps it searchable", async () => {
		const { agent, gmail, createReadlist } = await connectedAgent({ scope: READONLY_SCOPES });
		await createReadlist({ slug: "tech", label: "Tech" });
		const state = new URLSearchParams({ search: "dan", add: "1", delivery: "both", import: "1" });
		state.append("sender", MORNING);
		state.append("sender", TLDR);
		state.append("added", TLDR);
		state.append("readlist", "default");
		state.append("readlist", "tech");
		const before = load((await agent.get(`${GMAIL}?${state}`)).text);
		const remove = before.querySelector<HTMLButtonElement>(`[data-test-gmail-checklist-remove="${TLDR}"]`);
		assert(remove, "the added sender must offer removal");
		expect([remove.type, remove.getAttribute("form"), remove.getAttribute("formmethod"), remove.hasAttribute("formnovalidate")]).toEqual([
			"submit", "gmail-readlist-selection", "get", true,
		]);
		expect(Array.from(checklist(before).querySelectorAll("[data-test-gmail-checklist-remove]"), (button) => button.getAttribute("data-test-gmail-checklist-remove"))).toEqual([TLDR]);
		state.set(remove.name, remove.value);

		const dismissedUrl = `${GMAIL}?search=dan&sender=crew%40morningbrew.com&readlist=default&readlist=tech&delivery=both&import=1&add=1&discovery=started`;
		const response = await agent.get(`${GMAIL}?${state}`);
		expect([response.status, response.headers.location]).toEqual([303, dismissedUrl]);
		const after = load((await agent.get(dismissedUrl)).text);
		expect(checklistRows(after)).toEqual([["known", MORNING, "Morning Brew", true]]);
		expect(optionEmails(after)).toEqual([TLDR]);
		expect(gmail.rewriteRequests).toEqual([]);

		const boosted = await agent.get(`${GMAIL}?${state}`).set("HX-Request", "true").set("HX-Target", "gmail-dialog-body");
		expect([boosted.status, boosted.headers["hx-push-url"]]).toEqual([200, dismissedUrl]);
		expect(checklistRows(load(boosted.text))).toEqual(checklistRows(after));
	});

	it("submits the typed search through the mapping form with GET, so the live ticks reach the reloaded page without JavaScript", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(`${GMAIL}?search=dan&sender=${encodeURIComponent(MORNING)}&add=1`)).text);

		const input = doc.querySelector<HTMLInputElement>("#gmail-sender-search");
		assert(input, "the sender search input must render");
		expect([input.getAttribute("form"), input.name, input.value]).toEqual(["gmail-readlist-selection", "search", "dan"]);
		const submit = doc.querySelector("#gmail-sender-search-submit");
		assert(submit, "the sender search button must render");
		expect(["type", "form", "formmethod", "formaction", "formnovalidate"].map((name) => submit.getAttribute(name))).toEqual([
			"submit",
			"gmail-readlist-selection",
			"get",
			GMAIL,
			"",
		]);
		const selection = doc.querySelector("#gmail-readlist-selection");
		assert(selection, "the mapping form must render");
		expect(Array.from(selection.querySelectorAll<HTMLInputElement>('input[type="hidden"]'), (field) => field.name)).toEqual([
			"add",
			"discovery",
			"utm_source",
			"utm_medium",
			"utm_content",
			"readlist",
		]);
	});

	it("ticks a picked known newsletter in place instead of adding it again", async () => {
		const { agent } = await connectedAgent();

		const picked = await agent.get(`${GMAIL}?add=1&pick=${encodeURIComponent(MORNING)}`);

		expect(picked.headers.location).toBe(`${GMAIL}?sender=crew%40morningbrew.com&readlist=default&add=1&discovery=started`);
		expect(checklistRows(load((await agent.get(picked.headers.location)).text))).toEqual([["known", MORNING, "Morning Brew", true]]);
	});

	it("ticks every listed row with Select all and clears them all with Clear selection, keeping the added senders listed", async () => {
		const { agent } = await connectedAgent();

		const selected = await agent.get(`${GMAIL}?added=${encodeURIComponent(TLDR)}&add=1&select=all`);
		const boosted = await agent.get(`${GMAIL}?added=${encodeURIComponent(TLDR)}&add=1&select=all`).set("HX-Request", "true");
		const cleared = await agent.get(`${GMAIL}?sender=${encodeURIComponent(MORNING)}&sender=${encodeURIComponent(TLDR)}&added=${encodeURIComponent(TLDR)}&add=1&select=none`);

		const everyRow = `${GMAIL}?sender=crew%40morningbrew.com&sender=dan%40tldr.tech&added=dan%40tldr.tech&readlist=default&add=1&discovery=started`;
		expect([selected.status, selected.headers.location]).toEqual([303, everyRow]);
		expect(boosted.headers["hx-push-url"]).toBe(everyRow);
		const all = load((await agent.get(everyRow)).text);
		expect(checklistRows(all)).toEqual([
			["known", MORNING, "Morning Brew", true],
			["added", TLDR, "Dan at TLDR", true],
		]);
		expect(checklistActions(all)).toEqual([["select", "select", "none", "Clear selection"]]);
		expect(cleared.headers.location).toBe(`${GMAIL}?added=dan%40tldr.tech&add=1&discovery=started`);
		const none = load((await agent.get(cleared.headers.location)).text);
		expect(checklistRows(none)).toEqual([
			["known", MORNING, "Morning Brew", false],
			["added", TLDR, "Dan at TLDR", false],
		]);
		expect(checklistActions(none)).toEqual([["select", "select", "all", "Select all"]]);
	});

	it("submits the mapping form from Select all with its tracking, so the ticks travel with it", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(`${GMAIL}?add=1`)).text);

		const toggle = checklist(doc).querySelector('[data-test-gmail-checklist-action="select"]');
		assert(toggle, "Select all must render while rows are listed");
		expect([toggle.getAttribute("type"), toggle.getAttribute("form"), toggle.getAttribute("formmethod"), toggle.hasAttribute("formnovalidate")]).toEqual(["submit", "gmail-readlist-selection", "get", true]);
		const selection = doc.querySelector("#gmail-readlist-selection");
		assert(selection, "the mapping form must render");
		expect([selection.getAttribute("method"), selection.getAttribute("action")]).toEqual(["GET", GMAIL]);
		expect(hiddenFields(selection)).toEqual({
			add: "1",
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "choose-readlists",
			readlist: "default",
		});
	});

	it("offers each search result as a pick button on the mapping form and carries the ticks into the search", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(`${GMAIL}?search=tldr&sender=${encodeURIComponent(MORNING)}&added=${encodeURIComponent(TLDR)}&add=1`)).text);

		expect(optionEmails(doc)).toEqual([TLDR]);
		const option = doc.querySelector(`[data-test-gmail-sender-option="${TLDR}"]`);
		assert(option, "the matching sender must render as an option");
		expect([
			option.getAttribute("type"),
			option.getAttribute("form"),
			option.getAttribute("formmethod"),
			option.hasAttribute("formnovalidate"),
			option.getAttribute("name"),
			option.getAttribute("value"),
		]).toEqual(["submit", "gmail-readlist-selection", "get", true, "pick", TLDR]);
		expect(option.querySelector("[data-test-gmail-sender-option-name]")?.textContent).toBe("Dan at TLDR");
		expect(option.querySelector(".gmail__option-email")?.textContent).toBe(TLDR);
		expect(doc.querySelector("#gmail-sender-choice")?.textContent).toBe("Search all senders");
		const search = doc.querySelector("#gmail-sender-search-form");
		assert(search, "the sender search form must render");
		expect(search.getAttribute("hx-include")).toBe("#gmail-sender-search, input[form='gmail-readlist-selection'][name='sender'], input[form='gmail-readlist-selection'][name='added']");
		expect(Array.from(search.querySelectorAll<HTMLInputElement>(':scope > input[type="hidden"]'), (input) => [input.name, input.value])).toEqual([
			["readlist", "default"],
			["add", "1"],
			["discovery", "started"],
			["utm_source", "integrations-gmail"],
			["utm_medium", "internal"],
			["utm_content", "search-senders"],
		]);
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
		const full = await agent.get(`${GMAIL}/senders?search=${encodeURIComponent(search)}&add=1`);
		expect(optionEmails(load(full.text))).toEqual(expected);
	});

	it("lists every unmapped sender for an empty search with recognised newsletters first, and leaves a mapped sender to Your newsletters", async () => {
		const { agent, mapSender } = await connectedAgent({ catalog: catalogOf([[TLDR, "TLDR"]]) });
		const unmapped = load((await agent.get(`${GMAIL}?add=1`)).text);
		expect([results(unmapped).getAttribute("data-results-state"), optionEmails(unmapped)]).toEqual(["listed", [TLDR, MORNING]]);
		await mapSender(TLDR, "default");
		const doc = load((await agent.get(`${GMAIL}?add=1`)).text);
		expect(optionEmails(doc)).toEqual([MORNING]);
		expect(Array.from(doc.querySelectorAll("[data-test-gmail-mapping-row]"), (el) => el.getAttribute("data-test-gmail-mapping-row"))).toEqual([TLDR]);
	});

	it("tells apart no discovered senders, no known newsletters, every known newsletter mapped, and no matches", async () => {
		const empty = await connectedAgent({ discovered: false });
		const none = load((await empty.agent.get(`${GMAIL}?add=1&discovery=started`)).text);
		expect([checklist(none).getAttribute("data-checklist-state"), checklist(none).querySelector("[data-test-gmail-checklist-message]")?.textContent, checklistRows(none), checklistActions(none)]).toEqual([
			"no-discovered-senders",
			"No senders discovered yet.",
			[],
			[],
		]);
		expect([results(none).getAttribute("data-results-state"), none.querySelector("[data-test-gmail-results-message]")?.textContent]).toEqual(["no-discovered-senders", "No senders discovered yet."]);

		const unknown = await connectedAgent({ catalog: catalogOf([]) });
		const unrecognised = load((await unknown.agent.get(`${GMAIL}?add=1`)).text);
		expect([checklist(unrecognised).getAttribute("data-checklist-state"), checklist(unrecognised).querySelector("[data-test-gmail-checklist-message]")?.textContent, checklistRows(unrecognised)]).toEqual([
			"no-known-newsletters",
			"None of your senders is a known newsletter yet. Search all your senders below to add one.",
			[],
		]);
		expect([results(unrecognised).getAttribute("data-results-state"), optionEmails(unrecognised)]).toEqual(["listed", [MORNING, TLDR]]);

		const mapped = await connectedAgent();
		await mapped.mapSender(MORNING, "default");
		const allMapped = load((await mapped.agent.get(`${GMAIL}?add=1`)).text);
		expect([checklist(allMapped).getAttribute("data-checklist-state"), checklist(allMapped).querySelector("[data-test-gmail-checklist-message]")?.textContent, checklistRows(allMapped)]).toEqual([
			"all-known-mapped",
			"Every known newsletter in your Gmail is already in your newsletters. Search all your senders below to add another.",
			[],
		]);

		const unmatched = load((await unknown.agent.get(`${GMAIL}?search=zzz&add=1`)).text);
		expect(results(unmatched).getAttribute("data-results-state")).toBe("no-matches");
		expect(unmatched.querySelector("[data-test-gmail-results-message]")?.textContent).toBe("No discovered senders match “zzz”.");
	});

	it("offers Try again and the search while newsletter suggestions are unavailable, keeping the ticked senders", async () => {
		const { agent, catalog } = await connectedAgent();
		catalog.failReads(true);
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&add=1&discovery=started`)).text);
		expect(checklist(doc).getAttribute("data-checklist-state")).toBe("catalog-unavailable");
		expect(checklist(doc).querySelector("[data-test-gmail-checklist-message]")?.textContent).toBe(
			"Newsletter suggestions are unavailable right now. Try again, or search all your senders below.",
		);
		expect(checklistRows(doc)).toEqual([["added", TLDR, "Dan at TLDR", true]]);
		expect(checklistActions(doc)).toEqual([
			["retry", null, null, "Try again"],
			["select", "select", "none", "Clear selection"],
		]);
		const retry = checklist(doc).querySelector('[data-test-gmail-checklist-action="retry"]');
		assert(retry, "Try again must render while the catalog is unavailable");
		expect([retry.getAttribute("form"), retry.getAttribute("formmethod")]).toEqual(["gmail-readlist-selection", "get"]);
		const searched = load((await agent.get(`${GMAIL}?search=tldr&add=1`)).text);
		expect([results(searched).getAttribute("data-results-state"), optionEmails(searched)]).toEqual(["listed", [TLDR]]);
		catalog.failReads(false);
		expect(checklistRows(load((await agent.get(`${GMAIL}?add=1`)).text))).toEqual([["known", MORNING, "Morning Brew", false]]);
	});

	it("caps an empty search at 100 senders with recognised newsletters first and asks for a narrower search", async () => {
		const ZETA = ForwardableSenderSchema.parse("zeta@zeta.example");
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ discovered: false, catalog: catalogOf([[ZETA, "Zeta Weekly"]]) });
		const bulk: DiscoveredGmailSender[] = Array.from({ length: 150 }, (_, index) => ({
			email: ForwardableSenderSchema.parse(`sender-${String(index).padStart(3, "0")}@bulk.example`),
			name: undefined,
		}));
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [...bulk, { email: ZETA, name: "Zeta" }], generation: "bulk", state: "complete" });

		const doc = load((await agent.get(`${GMAIL}?add=1&discovery=started`)).text);

		const emails = optionEmails(doc);
		expect([emails.length, emails[0]]).toEqual([100, ZETA]);
		expect(results(doc).getAttribute("data-results-state")).toBe("limited");
		expect(doc.querySelector("[data-test-gmail-refine-search]")?.textContent).toBe("Showing 100 of 151 senders. Refine your search to find another sender.");
		expect(checklistRows(doc)).toEqual([["known", ZETA, "Zeta Weekly", false]]);
	});

	it("offers to show newsletters found since the checklist was listed, through the mapping form so the ticks are kept", async () => {
		const { agent } = await connectedAgent({ catalog: catalogOf([[MORNING, "Morning Brew"], [TLDR, "TLDR"]]) });
		const refresh = async (listed: number) => {
			const fragment = load((await agent.get(`${GMAIL}/senders?sender=${encodeURIComponent(MORNING)}&discovery=started&poll=1&listed=${listed}`).set("HX-Request", "true")).text);
			return Array.from(senderStatus(fragment).querySelectorAll("[data-test-gmail-refresh-checklist]"), (button) => [button.id, button.textContent, button.getAttribute("form"), button.getAttribute("formmethod")]);
		};

		expect(await refresh(0)).toEqual([["gmail-refresh-checklist", "Show 2 newly found newsletters", "gmail-readlist-selection", "get"]]);
		expect(await refresh(1)).toEqual([["gmail-refresh-checklist", "Show 1 newly found newsletter", "gmail-readlist-selection", "get"]]);
		expect(await refresh(2)).toEqual([]);
	});

	it("pushes the whole picker state to the address bar for a search fragment but not for a poll", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const state = `search=dan&sender=${encodeURIComponent(TLDR)}&readlist=tech`;
		const fragment = await agent.get(`${GMAIL}/senders?${state}&discovery=started`).set("HX-Request", "true");
		expect(fragment.headers["hx-push-url"]).toBe(`${GMAIL}?search=dan&sender=dan%40tldr.tech&added=dan%40tldr.tech&readlist=default&readlist=tech&discovery=started`);
		const poll = await agent.get(`${GMAIL}/senders?${state}&discovery=started&poll=1`).set("HX-Request", "true");
		expect(poll.headers["hx-push-url"]).toBeUndefined();
		const polled = load(poll.text);
		expect(Array.from(polled.querySelectorAll("[hx-swap-oob]"), (element) => element.id)).toEqual(["gmail-load-senders-button"]);
		expect(Array.from(polled.body.children, (element) => element.id)).toEqual(["gmail-load-senders-button", "gmail-sender-status"]);
	});

	it("refreshes the mapping choice, and the mappings that carry the search, when a typed search swaps in new results", async () => {
		const { agent, createReadlist, mapSender } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		await mapSender(MORNING, "default");
		const typed = load((await agent.get(`${GMAIL}/senders?search=dan&sender=${encodeURIComponent(TLDR)}&readlist=tech&discovery=started`).set("HX-Request", "true")).text);
		expect(Array.from(typed.querySelectorAll("[hx-swap-oob]"), (element) => [element.id, element.getAttribute("hx-swap-oob")])).toEqual([
			["gmail-mapping-choice", "outerHTML"],
			["gmail-mappings", "outerHTML"],
		]);
		const selection = typed.querySelector("#gmail-readlist-selection");
		assert(selection, "the mapping form must be swapped in out of band");
		expect(hiddenFields(selection)).toEqual({
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "choose-readlists",
			readlist: "default",
		});
		expect(hiddenFields(rowAction(row(typed, MORNING), "remove")).search).toBe("dan");
		const unticked = load((await agent.get(`${GMAIL}/senders?search=dan&discovery=started`).set("HX-Request", "true")).text);
		expect(Array.from(unticked.querySelectorAll("[hx-swap-oob]"), (element) => element.id)).toEqual(["gmail-mapping-choice", "gmail-mappings"]);
		const page = load((await agent.get(`${GMAIL}?search=dan&sender=${encodeURIComponent(TLDR)}&readlist=tech&add=1`)).text);
		expect(["#gmail-load-senders-button", "#gmail-mapping-choice", "#gmail-mappings"].map((id) => page.querySelector(id)?.hasAttribute("hx-swap-oob"))).toEqual([false, false, false]);
	});

	it("starts background discovery only through POST, keeps the picker state and requests reconsent for older grants", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const discovery = await gmail.bundle.gmailDiscoveryStore.findDiscoveryByUserId(userId);
		assert(discovery);
		const started = await agent.post(DISCOVER).type("form").send(new URLSearchParams([["search", "tldr"], ["sender", TLDR], ["sender", MORNING], ["added", TLDR], ["readlist", "default"], ["discovery_after", "stale"]]).toString());
		expect(started.headers.location).toBe(
			`${GMAIL}?search=tldr&sender=dan%40tldr.tech&sender=crew%40morningbrew.com&added=dan%40tldr.tech&readlist=default&discovery=started&discovery_after=${encodeURIComponent(discovery.updatedAt)}`,
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

	it("keeps polling a cached list until the queued refresh starts, leaving the ticks and readlists on the page rather than in every poll", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const started = await agent.post(DISCOVER).type("form").send({ search: "tldr", sender: TLDR, readlist: "tech", add: "1" });
		const doc = load((await agent.get(started.headers.location)).text);
		const status = senderStatus(doc);
		const pollUrl = status.getAttribute("hx-get");
		assert(pollUrl, "the status must poll while the refresh is queued");
		const poll = new URL(pollUrl, TEST_APP_ORIGIN);
		expect([poll.pathname, Array.from(poll.searchParams)]).toEqual([
			`${GMAIL}/senders`,
			[["search", "tldr"], ["readlist", "default"], ["readlist", "tech"], ["add", "1"], ["discovery", "started"], ["discovery_after", expect.any(String)], ["poll", "1"]],
		]);
		expect([
			status.getAttribute("hx-trigger"),
			status.getAttribute("hx-include"),
			status.getAttribute("hx-swap"),
			status.getAttribute("hx-disinherit"),
			status.hasAttribute("data-background-request"),
		]).toEqual(["every 3s", "#gmail-checklist-listed", "outerHTML show:none", "hx-include", true]);
		expect(checklistRows(doc)).toEqual([
			["known", MORNING, "Morning Brew", false],
			["added", TLDR, "Dan at TLDR", true],
		]);
		expect(doc.querySelector("#gmail-readlist-choice")?.textContent).toBe("All, Tech");
		const fragment = await agent.get(`${pollUrl}&listed=1`).set("HX-Request", "true");
		const next = new URL(senderStatus(load(fragment.text)).getAttribute("hx-get") ?? "", TEST_APP_ORIGIN).searchParams;
		expect([next.getAll("readlist"), next.get("poll"), next.has("listed")]).toEqual([["default", "tech"], "2", false]);
		expect(fragment.headers["hx-push-url"]).toBeUndefined();
	});

	it("reports checked messages while loading and swaps only the load button and the status", async () => {
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
		const running = load((await agent.get(`${GMAIL}?add=1&discovery=started`)).text);
		expect(running.querySelector("[data-test-gmail-discovery-status]")?.textContent).toBe("Checking for new messages · Checked 275 messages");
		expect(running.querySelector("#gmail-load-senders-button")?.textContent).toBe("Checking for new messages…");
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "settled", state: "complete", mode: "history", checkedMessageCount: 275, scannedMessages: 1 });
		const settled = load((await agent.get(`${GMAIL}?add=1&discovery=started`)).text);
		expect(settled.querySelector("[data-test-gmail-checked-count]")?.textContent).toBe("Checked 276 messages");
		expect(settled.querySelector("[data-test-gmail-discovery-status]")?.textContent).toMatch(/^\d+ senders? discovered · Checked 276 messages$/);
	});

	it("slows polling after the first minute and stops honestly once the discovery budget runs out", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "budget", state: "running", scannedMessages: 25 });
		const slow = load((await agent.get(`${GMAIL}/senders?discovery=started&poll=20`).set("HX-Request", "true")).text);
		expect(senderStatus(slow).getAttribute("hx-trigger")).toBe("every 15s");
		expect(senderStatus(slow).hasAttribute("data-background-request")).toBe(true);
		const stopped = load((await agent.get(`${GMAIL}/senders?discovery=started&poll=260`).set("HX-Request", "true")).text);
		expect(senderStatus(stopped).hasAttribute("hx-get")).toBe(false);
		expect(stopped.querySelector("[data-test-gmail-discovery-status]")?.textContent).toBe("Still checking. Checked 25 messages so far…");
		expect(stopped.querySelector("#gmail-load-senders-button")?.textContent).toBe("Load senders");
	});

	it("auto-loads senders through an untracked request and keeps the tracked load-senders action for the reader's own submit", async () => {
		const { agent } = await connectedAgent();
		const autoLoads = (doc: Document) => Array.from(doc.querySelectorAll("[data-test-gmail-auto-load-senders]"), (autoLoad) =>
			[autoLoad.getAttribute("data-test-gmail-auto-load-senders"), autoLoad.getAttribute("hx-post"), autoLoad.getAttribute("hx-trigger")]);
		expect(autoLoads(load((await agent.get(GMAIL)).text))).toEqual([["page", "/newsletters/gmail/discovery/start", "load"]]);
		const page = load((await agent.get(`${GMAIL}?add=1`)).text);
		expect(autoLoads(page)).toEqual([["dialog", "/newsletters/gmail/discovery/start", "load"]]);
		const form = page.querySelector("[data-test-gmail-load-senders]");
		assert(form);
		expect(form.getAttribute("hx-trigger")).toBe("submit");
		expect(form.getAttribute("hx-post")).toBe(
			"/newsletters/gmail/discovery/start?utm_source=integrations-gmail&utm_medium=internal&utm_content=load-senders",
		);
		const started = load((await agent.get(`${GMAIL}?discovery=started`)).text);
		const add = started.querySelector("#gmail-add-newsletters-form");
		assert(add, "the closed page must offer Add newsletters");
		expect(hiddenFields(add).discovery).toBe("started");
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
		const response = await agent.post(DISCOVER).set("HX-Request", "true").type("form").send({ add: "1" }).redirects(1);
		expect(response.status).toBe(200);
		const page = load(response.text);
		const form = page.querySelector("[data-test-gmail-load-senders]");
		assert(form);
		expect([form.getAttribute("hx-target"), form.getAttribute("hx-select"), form.getAttribute("hx-swap")]).toEqual(["#gmail-sender-status", "#gmail-sender-status", "outerHTML show:none"]);
		expect(form.getAttribute("hx-select-oob")).toBe("#gmail-load-senders-button:outerHTML");
		expect(form.querySelector("#gmail-load-senders-button")?.textContent).toBe("Load senders");
		expect(senderStatus(page).hasAttribute("hx-get")).toBe(false);
	});

	it("asks for a reconnect when discovery needs one", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "reconnect", state: "running" });
		await gmail.bundle.gmailDiscoveryStore.failDiscovery({ userId, generation: "reconnect", error: "invalid_grant", requiresReconnect: true });
		const doc = load((await agent.get(GMAIL)).text);
		expect(sections(doc)).toEqual([]);
		const reconnect = doc.querySelector("[data-test-gmail-metadata-reconnect] form");
		expect(reconnect?.getAttribute("action")).toBe(
			"/newsletters/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=grant-sender-access",
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
		expect(reconnect?.getAttribute("action")).toBe("/newsletters/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=reconnect");
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
		expect((await agent.get(`${GMAIL}/status`)).headers.location).toBe("/newsletters");
	});
});

describe("Choose a readlist", () => {
	it("offers All and every custom readlist once a newsletter is chosen, keeping the rest of the state in the Add popup an unmapped edit resolves to", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const doc = load((await agent.get(`${GMAIL}?search=dan&sender=${encodeURIComponent(TLDR)}&readlist=tech&edit=1&discovery=started`)).text);
		expect(doc.querySelector("#gmail-dialog")?.getAttribute("data-test-confirm-popover")).toBe("gmail-add");
		const picker = doc.querySelector("[data-test-gmail-readlist-picker]");
		assert(picker);
		expect(picker.hasAttribute("open")).toBe(false);
		const options = Array.from(doc.querySelectorAll("[data-test-gmail-readlist-option]"));
		expect(options.map((option) => [option.getAttribute("data-test-gmail-readlist-option"), option.hasAttribute("checked"), option.hasAttribute("disabled")])).toEqual([
			["default", true, true],
			["tech", true, false],
		]);
		const form = options[0]?.closest("form");
		assert(form);
		expect(form.getAttribute("method")).toBe("GET");
		expect(Array.from(form.elements, (field) => [field.getAttribute("name"), field.getAttribute("type")]).filter(([name]) => name === "search")).toEqual([["search", "search"]]);
		expect(hiddenFields(form)).toEqual({
			add: "1",
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "choose-readlists",
			readlist: "default",
		});
		expect(checklistRows(doc)).toEqual([
			["known", MORNING, "Morning Brew", false],
			["added", TLDR, "Dan at TLDR", true],
		]);
		expect(form.querySelector('[data-test-gmail-readlist-create] button')?.getAttribute("formaction")).toBe(`${CREATE_READLIST}?utm_source=integrations-gmail&utm_medium=internal&utm_content=create-readlist`);
		expect(form.querySelector('input[name="readlist_name"]')?.getAttribute("maxlength")).toBe("24");
	});

	it("closes the readlist picker once a readlist is chosen and disables Save until a destination is chosen", async () => {
		const { agent } = await connectedAgent();
		const chosen = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&add=1`)).text);
		expect(chosen.querySelector("[data-test-gmail-readlist-picker]")?.hasAttribute("open")).toBe(false);
		expect(chosen.querySelector("#gmail-readlist-choice")?.textContent).toBe("All");
		expect(Array.from(chosen.querySelectorAll("[data-test-gmail-save]"), (el) => el.textContent)).toEqual(["Save"]);
		const senderOnly = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=unknown&add=1`)).text);
		expect(senderOnly.querySelector("#gmail-readlist-choice")?.textContent).toBe("All");
		expect(Array.from(senderOnly.querySelectorAll("[data-test-gmail-save]"), (button) => button.hasAttribute("disabled"))).toEqual([true]);
	});

	it("replaces the create form with the limit once the reader keeps the maximum number of readlists", async () => {
		const { agent, createReadlist } = await connectedAgent();
		for (let index = 0; index < READLIST_MAX_PER_USER; index++) await createReadlist({ slug: `list-${index}`, label: `List ${index}` });
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&add=1`)).text);
		expect(doc.querySelector("[data-test-gmail-readlist-limit]")?.textContent).toBe("You can keep up to 7 readlists. Choose an existing readlist.");
		expect(doc.querySelectorAll("[data-test-gmail-readlist-option]")).toHaveLength(READLIST_MAX_PER_USER + 1);
	});

	it("creates a readlist, selects it, and keeps the chosen newsletter without saving a mapping", async () => {
		const { agent, gmail, userId, articleStore } = await connectedAgent();
		const created = await agent.post(CREATE_READLIST).type("form").send({ search: "dan", sender: TLDR, readlist_name: "Science", add: "1" });
		const params = locationParams(created.headers.location);
		const definitions = await articleStore.listReadlistDefinitions(userId);
		expect(definitions.map((definition) => definition.label)).toEqual(["Science"]);
		expect(params).toEqual({ notice: "readlist_created", search: "dan", sender: TLDR, readlist: definitions[0]?.slug, add: "1", discovery: "started" });
		const doc = load((await agent.get(created.headers.location)).text);
		expect(doc.querySelector('#gmail-dialog-body > [data-test-alert="readlist_created"]')?.textContent).toBe("Readlist created. Save the newsletter to use it.");
		expect(doc.querySelector("#gmail-readlist-choice")?.textContent).toBe("All, Science");

		const reused = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, readlist_name: "science", add: "1" });
		expect(locationParams(reused.headers.location)).toEqual({ notice: "readlist_reused", sender: TLDR, readlist: definitions[0]?.slug, add: "1", discovery: "started" });
		const reserved = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, readlist_name: "All", add: "1" });
		expect(reserved.headers.location).toBe(`${GMAIL}?notice=readlist_reused&sender=dan%40tldr.tech&readlist=default&add=1&discovery=started`);
		expect((await articleStore.listReadlistDefinitions(userId)).map((definition) => definition.label)).toEqual(["Science"]);
		expect(await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("keeps the Edit popup open with its picker closed once a readlist is created or reused inside it, so the edit can be saved", async () => {
		const { agent, userId, articleStore, mapSender } = await connectedAgent();
		await mapSender(TLDR, "default");
		const created = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, edit: "1", readlist_name: "Science" });
		const definitions = await articleStore.listReadlistDefinitions(userId);
		expect(locationParams(created.headers.location)).toEqual({ notice: "readlist_created", sender: TLDR, readlist: definitions[0]?.slug, edit: "1", discovery: "started" });
		const doc = load((await agent.get(created.headers.location)).text);
		expect(doc.querySelector("#gmail-dialog")?.getAttribute("data-test-confirm-popover")).toBe("gmail-edit");
		expect(dialogAlertKeys(doc)).toEqual(["readlist_created"]);
		const picker = doc.querySelector("[data-test-gmail-readlist-picker]");
		assert(picker);
		expect(picker.hasAttribute("open")).toBe(false);
		const reserved = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, edit: "1", readlist_name: "All" });
		expect(reserved.headers.location).toBe(`${GMAIL}?notice=readlist_reused&sender=dan%40tldr.tech&readlist=default&edit=1&discovery=started`);
	});

	it("keeps an invalid readlist name in the open picker and refuses a readlist past the limit", async () => {
		const { agent, gmail, userId, createReadlist } = await connectedAgent();
		const tooLong = "x".repeat(25);
		const invalid = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, readlist_name: tooLong, add: "1" });
		expect(invalid.headers.location).toBe(`${GMAIL}?error=readlist_name_invalid&sender=dan%40tldr.tech&readlist_name=${tooLong}&add=1&discovery=started`);
		const doc = load((await agent.get(invalid.headers.location)).text);
		expect(doc.querySelector("[data-test-gmail-readlist-picker]")?.hasAttribute("open")).toBe(true);
		expect(doc.querySelector<HTMLInputElement>('input[name="readlist_name"]')?.value).toBe(tooLong);
		expect(dialogAlertKeys(doc)).toEqual(["readlist_name_invalid"]);
		expect((await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, add: "1" })).headers.location).toBe(`${GMAIL}?error=readlist_name_invalid&sender=dan%40tldr.tech&add=1&discovery=started`);
		for (let index = 0; index < READLIST_MAX_PER_USER; index++) await createReadlist({ slug: `list-${index}`, label: `List ${index}` });
		const limited = await agent.post(CREATE_READLIST).type("form").send({ sender: TLDR, readlist_name: "Overflow", add: "1" });
		expect(limited.headers.location).toBe(`${GMAIL}?error=readlist_limit&sender=dan%40tldr.tech&readlist_name=Overflow&add=1&discovery=started`);
		expect(await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).toEqual([]);
	});
});

describe("Save a newsletter to a readlist", () => {
	it("saves an approved newsletter to All without suggesting it", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const save = await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default", search: "morning" });
		expect(save.headers.location).toBe(`${GMAIL}?notice=sender_mapped&search=morning&discovery=started`);
		const saved = await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: MORNING });
		assert(saved?.mappedAddresses);
		const entry = await gmail.bundle.findInboxAddress(saved.mappedAddresses[0]);
		expect({ purpose: entry?.purpose, readlist: entry?.readlist }).toEqual({ purpose: "gmail-readlist", readlist: undefined });
		expect(saved.addedToFilterAt).toBeDefined();
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
		expect(gmail.newsletterSenderSubmissions).toEqual([]);
		const doc = load((await agent.get(save.headers.location)).text);
		const mapped = row(doc, MORNING);
		expect(mapped.querySelector("[data-test-gmail-mapping-source]")?.textContent).toBe(`Morning Brew${MORNING}`);
		expect(mapped.querySelector("[data-test-gmail-mapping-destination]")?.textContent).toBe("Saved to All");
		expect(doc.querySelector('[data-test-alert="sender_mapped"]')?.textContent).toBe("Newsletter added. Gmail will forward its new issues, and what you chose to save goes to All and any readlists you picked.");
	});

	it("reuses one readlist address for every newsletter sent to the same custom readlist", async () => {
		const { agent, gmail, userId, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		for (const sender of [TLDR, MORNING]) await agent.post(ADD).type("form").send({ sender, readlist: "tech" });
		const rows = await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId);
		const addresses = new Set(rows.map((entry) => entry.mappedAddresses?.[0]));
		expect(addresses.size).toBe(1);
		expect((await gmail.addresses.listAddressesByUserId(userId)).filter((entry) => entry.purpose === "gmail-readlist").map((entry) => entry.readlist)).toEqual([TECH]);
		const doc = load((await agent.get(GMAIL)).text);
		expect(Array.from(doc.querySelectorAll("[data-test-gmail-mapping-destination]"), (el) => el.textContent)).toEqual(["Saved to All, Tech", "Saved to All, Tech"]);
		const allHref = "/queue?utm_source=integrations-gmail&utm_medium=internal&utm_content=open-readlist";
		const techHref = "/queue?queue=tech&utm_source=integrations-gmail&utm_medium=internal&utm_content=open-readlist";
		expect(Array.from(doc.querySelectorAll("[data-test-gmail-mapping-destination] a"), (link) => link.getAttribute("href"))).toEqual([allHref, techHref, allHref, techHref]);
	});

	it("submits only the address of a sender that is not an approved newsletter, including while the catalog is unavailable", async () => {
		const { agent, gmail, catalog } = await connectedAgent();
		await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });
		expect(gmail.newsletterSenderSubmissions).toEqual([{ senderEmail: TLDR }]);
		catalog.failReads(true);
		await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default" });
		expect(gmail.newsletterSenderSubmissions).toEqual([{ senderEmail: TLDR }, { senderEmail: MORNING }]);
	});

	it("submits a sender recognised only through the approved wildcard for its domain, but not one approved by its own record", async () => {
		const { agent, gmail } = await connectedAgent({
			catalog: NewsletterCatalogDocumentSchema.parse({
				version: 1,
				records: [
					{ from: "*@tldr.tech", name: "TLDR", status: "approved", evidence: [{ kind: "admin", addedAt: AT }], createdAt: AT, updatedAt: AT },
					{ from: MORNING, name: "Morning Brew", status: "approved", evidence: [{ kind: "seed", addedAt: AT }], createdAt: AT, updatedAt: AT },
				],
			}),
		});
		await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });
		await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default" });
		expect(gmail.newsletterSenderSubmissions).toEqual([{ senderEmail: TLDR }]);
	});

	it("offers the import unchecked, and only for a newsletter not yet mapped", async () => {
		const { agent, mapSender } = await connectedAgent();
		const fresh = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&add=1`)).text);
		const form = fresh.querySelector("[data-test-gmail-save-mapping]");
		assert(form);
		expect(form.querySelector("[data-test-gmail-save]")?.getAttribute("formaction")).toBe(`${ADD}?utm_source=integrations-gmail&utm_medium=internal&utm_content=save-mapping`);
		expect(hiddenFields(form)).toMatchObject({ readlist: "default" });
		expect(checklistRows(fresh)).toEqual([
			["known", MORNING, "Morning Brew", false],
			["added", TLDR, "Dan at TLDR", true],
		]);
		expect(form.querySelector('input[name="import"]')?.hasAttribute("checked")).toBe(false);
		const checked = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&import=1&add=1`)).text);
		expect(checked.querySelector('[data-test-gmail-save-mapping] input[name="import"]')?.hasAttribute("checked")).toBe(true);
		await mapSender(TLDR, "default");
		const mapped = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&edit=1`)).text);
		const editing = mapped.querySelector("[data-test-gmail-save-mapping]");
		assert(editing, "the Edit popup must render the mapping form");
		expect(Array.from(editing.querySelectorAll("input[type=checkbox]"), (box) => box.getAttribute("name"))).toEqual(["readlist"]);
	});

	it("offers to save the issue itself for a newsletter not yet mapped, and keeps the reader's own choice", async () => {
		const { agent } = await connectedAgent();
		const deliveryOptions = (doc: Document) =>
			Array.from(doc.querySelectorAll<HTMLInputElement>("[data-test-gmail-save-mapping] [data-test-gmail-delivery-option]"), (input) => [input.value, input.checked]);

		const fresh = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&add=1`)).text);
		const chosen = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&delivery=both&add=1`)).text);

		expect(deliveryOptions(fresh)).toEqual([["issue", true], ["links", false], ["both", false]]);
		expect(Array.from(fresh.querySelectorAll(".gmail__delivery-label"), (el) => el.textContent)).toEqual(["The issue itself", "The articles it links to", "Both"]);
		expect(deliveryOptions(chosen)).toEqual([["issue", false], ["links", false], ["both", true]]);
		const form = chosen.querySelector("[data-test-gmail-save-mapping]");
		assert(form);
		expect(hiddenFields(form)).toEqual({
			readlist: "default",
			add: "1",
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "choose-readlists",
		});
	});

	it("saves the delivery the reader chose, and the issue itself when the form sent no choice", async () => {
		const { agent, gmail, userId } = await connectedAgent();

		await agent.post(ADD).type("form").send({ sender: MORNING, readlist: "default", delivery: "links" });
		await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });

		const saved = await Promise.all([MORNING, TLDR].map((senderEmail) => gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail })));
		expect(saved.map((sender) => sender?.deliveryMode)).toEqual(["links", "issue"]);
		const doc = load((await agent.get(GMAIL)).text);
		const delivery = (sender: string) => {
			const line = row(doc, sender).querySelector("[data-test-gmail-mapping-delivery]");
			return [line?.getAttribute("data-test-gmail-mapping-delivery"), line?.textContent];
		};
		expect([delivery(MORNING), delivery(TLDR)]).toEqual([["links", "Saves the linked articles"], ["issue", "Saves each issue"]]);
	});

	it("moves a newsletter to another readlist, stops its import, and leaves a shared named inbox untouched", async () => {
		const { agent, gmail, userId, createReadlist, seedJob, findJob } = await connectedAgent({ scope: READONLY_SCOPES });
		await createReadlist({ slug: "tech", label: "Tech" });
		const named = await gmail.addresses.createAddress({ userId, domain: "read.place", name: AliasNameSchema.parse("reading"), purpose: "user-alias" });
		await gmail.addresses.setAddressReadlist({ userId, address: named.address, readlist: TECH });
		await gmail.bundle.gmailMappingStore.mapSenderToAddress({ userId, accountEmail: EMAIL, senderEmail: TLDR, mappedAddresses: [named.address], deliveryMode: "links" });
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		const before = await gmail.bundle.findInboxAddress(named.address);
		expect(row(load((await agent.get(GMAIL)).text), TLDR).querySelector("[data-test-gmail-mapping-destination]")?.textContent).toBe("Saved to All, Tech");
		const jobId = await seedJob({ sender: TLDR, destination: named.address, state: "running" });

		const moved = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });

		expect(moved.headers.location).toBe(`${GMAIL}?notice=sender_remapped&discovery=started`);
		expect(await gmail.bundle.findInboxAddress(named.address)).toEqual(before);
		const remapped = await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		assert(remapped?.mappedAddresses);
		expect((await gmail.bundle.findInboxAddress(remapped.mappedAddresses[0]))?.purpose).toBe("gmail-readlist");
		expect({ state: (await findJob(jobId))?.state, reason: (await findJob(jobId))?.cancelReason }).toEqual({ state: "cancelled", reason: "destination-changed" });
		expect(gmail.importStartRequests).toEqual([]);
		const doc = load((await agent.get(moved.headers.location)).text);
		expect(doc.querySelector('[data-test-alert="sender_remapped"]')?.textContent).toBe("Newsletter updated. From its next issue, what you chose to save goes to All and any readlists you picked.");
	});

	it("keeps the picker state, including the ticks and the import choice, when validation fails", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const unknownReadlist = await agent.post(ADD).type("form").send(new URLSearchParams([["sender", TLDR], ["sender", MORNING], ["added", TLDR], ["readlist", "nope"], ["search", "dan"], ["add", "1"]]).toString());
		expect(unknownReadlist.headers.location).toBe(`${GMAIL}?error=readlist_invalid&search=dan&sender=dan%40tldr.tech&sender=crew%40morningbrew.com&added=dan%40tldr.tech&readlist=nope&add=1&discovery=started`);
		const doc = load((await agent.get(unknownReadlist.headers.location)).text);
		expect(doc.querySelector("[data-test-gmail-readlist-picker]")?.hasAttribute("open")).toBe(true);
		expect(dialogAlertKeys(doc)).toEqual(["readlist_invalid"]);
		expect(checklistRows(doc)).toEqual([
			["known", MORNING, "Morning Brew", true],
			["added", TLDR, "Dan at TLDR", true],
		]);
		const importKept = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "nope", import: "1", delivery: "both", add: "1" });
		expect(importKept.headers.location).toBe(`${GMAIL}?error=readlist_invalid&sender=dan%40tldr.tech&readlist=nope&delivery=both&import=1&add=1&discovery=started`);
		expect(await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("asks for at least one ticked newsletter, keeping the senders the reader added", async () => {
		const { agent, gmail, userId } = await connectedAgent();

		const noneTicked = await agent.post(ADD).type("form").send({ added: TLDR, readlist: "default", add: "1" });
		const malformed = await agent.post(ADD).type("form").send({ sender: "bad", readlist: "default", add: "1" });

		expect(noneTicked.headers.location).toBe(`${GMAIL}?error=sender_invalid&added=dan%40tldr.tech&readlist=default&add=1&discovery=started`);
		expect(malformed.headers.location).toBe(`${GMAIL}?error=sender_invalid&sender=bad&readlist=default&add=1&discovery=started`);
		const doc = load((await agent.get(noneTicked.headers.location)).text);
		expect(doc.querySelector('#gmail-dialog-body > [data-test-alert="sender_invalid"]')?.textContent).toBe("Tick at least one newsletter to save.");
		expect(checklistRows(doc)).toEqual([
			["known", MORNING, "Morning Brew", false],
			["added", TLDR, "Dan at TLDR", false],
		]);
		expect(await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("saves every ticked newsletter with one shared readlist and delivery choice, rewriting the filter once", async () => {
		const THIRD = ForwardableSenderSchema.parse("news@letters.example");
		const { agent, gmail, userId, gatewayAddress, createReadlist } = await connectedAgent({ discovered: false });
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [...DISCOVERED, { email: THIRD, name: "Letters" }], generation: "three", state: "complete" });
		await createReadlist({ slug: "tech", label: "Tech" });

		const save = await agent.post(ADD).type("form").send(
			new URLSearchParams([["sender", TLDR], ["sender", MORNING], ["sender", THIRD], ["sender", TLDR], ["added", TLDR], ["readlist", "default"], ["readlist", "tech"], ["delivery", "both"], ["search", "letters"], ["add", "1"]]).toString(),
		);

		expect(save.headers.location).toBe(`${GMAIL}?notice=senders_saved&saved=3&search=letters&discovery=started`);
		const saved = await Promise.all([TLDR, MORNING, THIRD].map((senderEmail) => gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail })));
		expect(saved.map((mapping) => [mapping?.deliveryMode, mapping?.addedToFilterAt !== undefined])).toEqual([["both", true], ["both", true], ["both", true]]);
		expect(new Set(saved.map((mapping) => mapping?.mappedAddresses?.join(","))).size).toBe(1);
		expect((await gmail.addresses.listAddressesByUserId(userId)).filter((entry) => entry.purpose === "gmail-readlist").map((entry) => entry.readlist)).toEqual([TECH]);
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
		expect(gmail.newsletterSenderSubmissions).toEqual([{ senderEmail: TLDR }, { senderEmail: THIRD }]);
		const doc = load((await agent.get(save.headers.location)).text);
		expect(doc.querySelector('[data-test-alert="senders_saved"]')?.textContent).toBe(
			"3 newsletters saved. Gmail will forward their new issues, and what you chose to save goes to All and any readlists you picked.",
		);
		expect(Array.from(doc.querySelectorAll("[data-test-gmail-mapping-row]"), (mapped) => [
			mapped.getAttribute("data-test-gmail-mapping-row"),
			mapped.querySelector("[data-test-gmail-mapping-destination]")?.textContent,
			mapped.querySelector("[data-test-gmail-mapping-delivery]")?.getAttribute("data-test-gmail-mapping-delivery"),
		])).toEqual([
			[TLDR, "Saved to All, Tech", "both"],
			[MORNING, "Saved to All, Tech", "both"],
			[THIRD, "Saved to All, Tech", "both"],
		]);
		expect(doc.querySelectorAll("#gmail-dialog")).toHaveLength(0);
		const add = doc.querySelector("#gmail-add-newsletters-form");
		assert(add, "the closed page must offer Add newsletters again");
		expect(hiddenFields(add)).toMatchObject({ search: "letters", add: "1", discovery: "started" });
		expect(checklist(load((await agent.get(`${GMAIL}?add=1&discovery=started`)).text)).getAttribute("data-checklist-state")).toBe("all-known-mapped");
	});

	it("says how many newsletters were saved while forwarding waits for Gmail's confirmation, and nothing without a count", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const counted = load((await agent.get(`${GMAIL}?notice=senders_saved&saved=2`)).text);
		const uncounted = load((await agent.get(`${GMAIL}?notice=senders_saved`)).text);

		expect(counted.querySelector('[data-test-alert="senders_saved"]')?.textContent).toBe(
			"2 newsletters saved. Their new issues will be forwarded once Gmail confirms the forwarding address.",
		);
		expect(Array.from(uncounted.querySelectorAll("[data-test-alert]"), (alert) => alert.getAttribute("data-test-alert"))).toEqual([]);
	});

	it("refuses the whole save when one ticked sender is unknown, keeping every tick", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const before = await gmail.addresses.listAddressesByUserId(userId);

		const refused = await agent.post(ADD).type("form").send(new URLSearchParams([["sender", TLDR], ["sender", MORNING], ["sender", "unknown@example.com"], ["added", TLDR], ["readlist", "default"], ["add", "1"]]).toString());

		expect(refused.headers.location).toBe(`${GMAIL}?error=sender_unknown&sender=dan%40tldr.tech&sender=crew%40morningbrew.com&sender=unknown%40example.com&added=dan%40tldr.tech&readlist=default&add=1&discovery=started`);
		expect(await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).toEqual([]);
		expect(await gmail.addresses.listAddressesByUserId(userId)).toEqual(before);
		expect(gmail.rewriteRequests).toEqual([]);
		expect(gmail.newsletterSenderSubmissions).toEqual([]);
		const doc = load((await agent.get(refused.headers.location)).text);
		expect(dialogAlertKeys(doc)).toEqual(["sender_unknown"]);
		expect(doc.querySelector('[data-test-alert="sender_unknown"]')?.textContent).toBe("I couldn't find one of those senders. Load your Gmail senders and try again.");
		expect(checklistRows(doc)).toEqual([
			["known", MORNING, "Morning Brew", true],
			["added", TLDR, "Dan at TLDR", true],
		]);
	});

	it("imports unread messages only for the newsletters the save maps for the first time", async () => {
		const { agent, gmail, userId, mapSender } = await connectedAgent({ scope: READONLY_SCOPES });
		await mapSender(TLDR, "default");

		const save = await agent.post(ADD).type("form").send(new URLSearchParams([["sender", TLDR], ["sender", MORNING], ["readlist", "default"], ["import", "1"]]).toString());

		expect(save.headers.location).toBe(`${GMAIL}?notice=import_started&discovery=started`);
		const jobs = await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId);
		expect(jobs.map((job) => [job.senderEmail, job.state])).toEqual([[MORNING, "queued"]]);
		expect(gmail.importStartRequests).toHaveLength(1);
	});

	it("saves every ticked newsletter but stops importing once Google has ended the grant", async () => {
		const { agent, gmail, userId } = await connectedAgent({ scope: READONLY_SCOPES });
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });

		const save = await agent.post(ADD).type("form").send(new URLSearchParams([["sender", TLDR], ["sender", MORNING], ["readlist", "default"], ["import", "1"]]).toString());

		expect(save.headers.location).toBe(`${GMAIL}?error=import_revoked&notice=senders_saved&saved=2&discovery=started`);
		expect((await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).map((mapping) => mapping.senderEmail).sort()).toEqual([MORNING, TLDR]);
		expect(await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId)).toEqual([]);
		expect(gmail.importStartRequests).toEqual([]);
	});

	it("starts the imports it can and reports the one already underway", async () => {
		const { agent, gmail, userId, seedJob } = await connectedAgent({ scope: READONLY_SCOPES });
		const earlier = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG });
		await seedJob({ sender: TLDR, destination: earlier.address, state: "running" });

		const save = await agent.post(ADD).type("form").send(new URLSearchParams([["sender", TLDR], ["sender", MORNING], ["readlist", "default"], ["import", "1"]]).toString());

		expect(save.headers.location).toBe(`${GMAIL}?error=import_in_progress&notice=senders_saved&saved=2&discovery=started`);
		const jobs = await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId);
		expect(jobs.map((job) => [job.senderEmail, job.state]).sort()).toEqual([[MORNING, "queued"], [TLDR, "running"]]);
		const doc = load((await agent.get(save.headers.location)).text);
		expect([
			doc.querySelector('[data-test-alert="senders_saved"]')?.textContent,
			doc.querySelector('[data-test-alert="import_in_progress"]')?.textContent,
		]).toEqual([
			"2 newsletters saved. Gmail will forward their new issues, and what you chose to save goes to All and any readlists you picked.",
			"An import for this newsletter is already underway. Wait for it to finish, or cancel it first.",
		]);
	});

	it("refuses another reader's readlist without minting an address", async () => {
		const { agent, gmail, userId, harness, createReadlist } = await connectedAgent();
		const other = await harness.auth.createUser({ email: "other@example.com", password: "password123" });
		assert(other.ok);
		await createReadlist({ slug: "secret", label: "Secret", owner: other.userId });
		const response = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "secret" });
		expect(response.headers.location).toContain("error=readlist_invalid");
		expect((await gmail.addresses.listAddressesByUserId(userId)).map((entry) => entry.purpose)).toEqual(["gmail-forwarding"]);
		expect(await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).toEqual([]);
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
		expect(await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).toEqual([]);
		expect(await gmail.addresses.listAddressesByUserId(userId)).toEqual(before);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("lets an existing mapping be reassigned before mailbox reconsent", async () => {
		const { agent, gmail, userId } = await connectedAgent({ discovered: false, scope: GMAIL_SETTINGS_SCOPE });
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		expect((await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" })).headers.location).toBe(`${GMAIL}?notice=sender_remapped&discovery=started`);
		expect((await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR }))?.mappedAddresses).toBeDefined();
	});

	it("saves a mapping during Step 2 and says forwarding starts after confirmation", async () => {
		const { agent, gmail, userId } = await connectedAgent({ confirmed: false });
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });
		const doc = load((await agent.get(save.headers.location)).text);
		expect(doc.querySelector("[data-test-gmail-state]")?.getAttribute("data-test-gmail-state")).toBe("awaiting-confirmation");
		const notice = doc.querySelector('[data-test-alert="sender_mapped"]');
		assert(notice);
		expect(notice.getAttribute("data-test-alert-variant")).toBe("success");
		expect(notice.textContent).toBe("Newsletter added. Its new issues will be forwarded once Gmail confirms the forwarding address.");
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
	});

	it("starts an import of unread messages when the reader already granted read access", async () => {
		const { agent, gmail, userId } = await connectedAgent({ scope: READONLY_SCOPES });
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });
		expect(save.headers.location).toBe(`${GMAIL}?notice=import_started&discovery=started`);
		const [job] = await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId);
		assert(job);
		const saved = await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		expect({ state: job.state, sender: job.senderEmail, destination: job.destinationAddresses }).toEqual({ state: "queued", sender: TLDR, destination: saved?.mappedAddresses });
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
		expect(consent.getAttribute("action")).toBe("/newsletters/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=grant-import-permission");
		expect(hiddenFields(consent)).toEqual({ intent: "import", sender: TLDR });
		expect(rowActionKeys(mapped)).toEqual(["edit", "cancel-import", "remove"]);
		const picking = load((await agent.get(`${GMAIL}?search=dan&sender=${encodeURIComponent(MORNING)}&readlist=default&edit=1`)).text);
		const carried = row(picking, TLDR).querySelector("[data-test-gmail-import-consent] form");
		assert(carried);
		expect(Array.from(carried.querySelectorAll<HTMLInputElement>('input[type="hidden"]'), (input) => [input.name, input.value])).toEqual([
			["search", "dan"],
			["readlist", "default"],
			["intent", "import"],
			["sender", TLDR],
		]);
	});

	it("treats choosing a readlist for a legacy newsletter as an edit, without the import option", async () => {
		const { agent, gmail, userId } = await connectedAgent({ discovered: false, scope: READONLY_SCOPES });
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		const editing = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=default&edit=1`)).text);
		const form = editing.querySelector("[data-test-gmail-save-mapping]");
		assert(form);
		expect(Array.from(form.querySelectorAll('input[name="import"]'))).toEqual([]);
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });
		expect(save.headers.location).toBe(`${GMAIL}?notice=sender_remapped&discovery=started`);
		expect((await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR }))?.mappedAddresses).toBeDefined();
		expect(await gmail.bundle.gmailHistoryImportStore.listJobsByUserId(userId)).toEqual([]);
		expect(gmail.importStartRequests).toEqual([]);
	});

	it("confirms the saved mapping while explaining why its import could not start", async () => {
		const { agent, gmail, userId, seedJob } = await connectedAgent({ scope: READONLY_SCOPES });
		const earlier = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG });
		await seedJob({ sender: TLDR, destination: earlier.address, state: "running" });
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", import: "1" });
		expect(save.headers.location).toBe(`${GMAIL}?error=import_in_progress&notice=sender_mapped&discovery=started`);
		expect((await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR }))?.addedToFilterAt).toBeDefined();
		const doc = load((await agent.get(save.headers.location)).text);
		expect([
			doc.querySelector('[data-test-alert="sender_mapped"]')?.textContent,
			doc.querySelector('[data-test-alert="import_in_progress"]')?.textContent,
		]).toEqual([
			"Newsletter added. Gmail will forward its new issues, and what you chose to save goes to All and any readlists you picked.",
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
			if (address !== undefined) await gmail.bundle.gmailMappingStore.mapSenderToAddress({ userId, accountEmail: EMAIL, senderEmail: sender, mappedAddresses: [address], deliveryMode: "links" });
			await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: sender });
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
		expect(described(LEGACY)).toEqual(["unresolved", "Choose a readlist", "No readlist yet. Edit it to choose a readlist.", "Not forwarding", ["edit", "remove"]]);
		expect(described(DISABLED)).toEqual(["unresolved", "Choose a readlist", "Its destination was switched off. Edit it to choose a readlist.", "Not forwarding", ["edit", "remove"]]);
		expect(described(MISSING)).toEqual(["unresolved", "Choose a readlist", "Its destination no longer exists. Edit it to choose a readlist.", "Not forwarding", ["edit", "remove"]]);
		expect(described(FOREIGN)).toEqual(["unresolved", "Choose a readlist", "Its destination no longer exists. Edit it to choose a readlist.", "Not forwarding", ["edit", "remove"]]);
		expect(described(DELETED)).toEqual(["readlist", "Saved to All", undefined, "Waiting for Gmail", ["edit", "start-import", "remove"]]);
		const edit = rowAction(row(doc, LEGACY), "edit");
		expect(edit.getAttribute("method")).toBe("GET");
		expect(hiddenFields(edit)).toEqual({ sender: LEGACY, edit: "1", discovery: "started", utm_source: "integrations-gmail", utm_medium: "internal", utm_content: "edit-mapping" });
	});

	it("pre-selects what a newsletter saves when it is edited, whatever another newsletter's choice was", async () => {
		const { agent, mapSender } = await connectedAgent();
		await mapSender(TLDR, "default");
		const page = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(MORNING)}&readlist=default&delivery=both`)).text);
		const edit = rowAction(row(page, TLDR), "edit");
		expect(row(page, TLDR).querySelector("[data-test-gmail-mapping-action=\"edit\"]")?.textContent).toBe("Edit");
		expect(hiddenFields(edit)).toEqual({
			sender: TLDR,
			readlist: "default",
			edit: "1",
			discovery: "started",
			utm_source: "integrations-gmail",
			utm_medium: "internal",
			utm_content: "edit-mapping",
		});

		const editing = load((await agent.get(`${GMAIL}?${new URLSearchParams(hiddenFields(edit))}`)).text);

		expect([editing.querySelector("#gmail-dialog")?.getAttribute("data-test-confirm-popover"), editing.querySelector("#gmail-dialog-title")?.textContent]).toEqual(["gmail-edit", "Edit Dan at TLDR"]);
		const selection = editing.querySelector("#gmail-readlist-selection");
		assert(selection, "the Edit popup must render the mapping form");
		expect(hiddenFields(selection)).toMatchObject({ sender: TLDR, edit: "1" });

		const checked = editing.querySelector<HTMLInputElement>("[data-test-gmail-save-mapping] [data-test-gmail-delivery-option]:checked");
		expect(checked?.value).toBe("links");
	});

	it("says a newsletter without a live readlist is not forwarding even when Gmail's filter is live", async () => {
		let now = new Date("2026-09-16T00:00:00.000Z");
		const { agent, gmail, userId, mapSender } = await connectedAgent({ discovered: false, now: () => now });
		const LEGACY = ForwardableSenderSchema.parse("legacy@example.com");
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: LEGACY });
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
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: LEGACY });
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
		expect(Array.from(section.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual(["/queue?utm_source=integrations-gmail&utm_medium=internal&utm_content=open-readlist"]);
		const edit = rowAction(row(doc, TLDR), "edit");
		expect(hiddenFields(edit)).toMatchObject({ sender: TLDR, readlist: "default", edit: "1" });
		const remove = rowAction(row(doc, TLDR), "remove");
		expect(remove.getAttribute("action")).toBe(`${REMOVE}?utm_source=integrations-gmail&utm_medium=internal&utm_content=remove-mapping`);
	});

	it("shows an empty list before any newsletter is mapped", async () => {
		const { agent } = await connectedAgent();
		const doc = load((await agent.get(GMAIL)).text);
		const empty = doc.querySelector("[data-test-gmail-mappings-empty]");
		assert(empty, "an empty list must say so");
		expect([empty.querySelector(".gmail__empty-copy")?.textContent, empty.querySelector("[data-test-gmail-add-newsletters]")?.textContent]).toEqual(["No newsletters yet.", "Add newsletters"]);
		expect(doc.querySelector("[data-test-gmail-filter-message]")?.textContent).toBe("No forwarding rule in Gmail yet.");
	});

	it.each<[string, { state: GmailHistoryImportState; counts?: Partial<GmailHistoryImportCounts>; failureReason?: GmailHistoryImportFailureReason; cancelReason?: GmailHistoryImportCancelReason }, boolean, string, string[], string[], boolean]>([
		["no import", { state: "complete", counts: { listed: 0 } }, true, "No unread messages from the last 30 days.", [], ["edit", "start-import", "remove"], false],
		["waiting for permission with read access", { state: "awaiting-permission" }, true, "Waiting for permission to read your Gmail messages.", [], ["edit", "retry-import", "cancel-import", "remove"], false],
		["queued", { state: "queued" }, false, "Import queued.", [], ["edit", "cancel-import", "remove"], false],
		["running", { state: "running", counts: { listed: 4, imported: 2 } }, false, "Importing unread messages from the last 30 days…", ["2 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "cancel-import", "remove"], false],
		["complete", { state: "complete", counts: { listed: 5, imported: 3, alreadyImported: 1, skippedNoMessageId: 1 } }, false, "Import complete. The imported emails are in your Inbox; their article links may still be processing.", ["3 imported", "1 already imported", "1 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "start-import", "remove"], false],
		["complete with every message skipped", { state: "complete", counts: { listed: 3, skippedNoMessageId: 1, skippedSenderMismatch: 2 } }, true, "Import complete.", ["0 imported", "0 already imported", "1 skipped (no message ID)", "2 skipped (different sender)", "0 failed"], ["edit", "start-import", "remove"], false],
		["partly failed with read access", { state: "complete", counts: { listed: 3, imported: 1, skippedSenderMismatch: 1, failed: 1 } }, true, "Import finished, but some messages failed. The imported emails are in your Inbox; their article links may still be processing.", ["1 imported", "0 already imported", "0 skipped (no message ID)", "1 skipped (different sender)", "1 failed"], ["edit", "retry-import", "remove"], false],
		["partly failed without read access", { state: "complete", counts: { listed: 1, failed: 1 } }, false, "Import finished, but some messages failed.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "1 failed"], ["edit", "remove"], true],
		["failed after Gmail rejected it", { state: "failed", failureReason: "gmail-rejected" }, true, "Gmail refused the import.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "retry-import", "remove"], false],
		["failed after permission was revoked", { state: "failed", failureReason: "permission-revoked" }, false, "Readplace lost permission to read your Gmail messages.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "remove"], true],
		["dead-lettered", { state: "failed", failureReason: "dead-lettered" }, true, "The import stopped after repeated errors.", ["0 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"], ["edit", "retry-import", "remove"], false],
		["cancelled", { state: "cancelled", cancelReason: "user-cancelled", counts: { imported: 2, cancelled: 3 } }, false, "Import cancelled.", ["2 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed", "3 cancelled"], ["edit", "start-import", "remove"], false],
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

	it("polls the mappings while an import runs, keeps the picker state without the popup, and stops at the poll budget", async () => {
		const { agent, mapSender, seedJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		await seedJob({ sender: TLDR, destination, state: "running" });
		const first = load((await agent.get(`${GMAIL}?search=dan&sender=${encodeURIComponent(MORNING)}&add=1`)).text);
		const section = first.querySelector("#gmail-mappings");
		assert(section);
		expect(section.getAttribute("data-imports-polling")).toBe("true");
		expect(section.getAttribute("hx-get")).toBe(`${GMAIL}?search=dan&sender=crew%40morningbrew.com&readlist=default&discovery=started&imports_poll=1`);
		expect(section.getAttribute("hx-select")).toBe("#gmail-mappings");
		const next = load((await agent.get(`${GMAIL}?discovery=started&imports_poll=99`)).text).querySelector("#gmail-mappings");
		expect(next?.getAttribute("hx-get")).toBe(`${GMAIL}?discovery=started&imports_poll=100`);
		const exhausted = load((await agent.get(`${GMAIL}?discovery=started&imports_poll=100`)).text);
		expect(exhausted.querySelector("#gmail-mappings")?.getAttribute("data-imports-polling")).toBe("false");
		expect(exhausted.querySelector("#gmail-mappings")?.hasAttribute("hx-get")).toBe(false);
		expect(exhausted.querySelector("[data-test-gmail-imports-exhausted]")?.textContent).toBe("Still importing. Refresh to check again.");
	});

	it("shows no import for a newsletter moved to another readlist after its import finished", async () => {
		let now = new Date("2026-09-30T20:20:00.000Z");
		const { agent, createReadlist, mapSender, seedJob } = await connectedAgent({ scope: READONLY_SCOPES, now: () => now, appNow: () => now });
		await createReadlist({ slug: "dev-newsletters", label: "Dev newsletters" });
		const devNewsletters = await mapSender(TLDR, "dev-newsletters");
		now = new Date("2026-09-30T20:24:54.000Z");
		await seedJob({ sender: TLDR, destination: devNewsletters, state: "complete", counts: { listed: 1, alreadyImported: 1 } });
		expect(importSummary(row(load((await agent.get(GMAIL)).text), TLDR))).toEqual({
			state: "complete",
			message: ["Import complete. The imported emails are in your Inbox; their article links may still be processing."],
			counts: ["0 imported", "1 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"],
			actions: ["edit", "start-import", "remove"],
		});

		now = new Date("2026-09-30T20:30:00.000Z");
		await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });

		const moved = row(load((await agent.get(GMAIL)).text), TLDR);
		expect(moved.querySelector("[data-test-gmail-mapping-destination]")?.textContent).toBe("Saved to All");
		expect(importSummary(moved)).toEqual({ state: "none", message: [], counts: [], actions: ["edit", "start-import", "remove"] });
	});

	it("keeps a newsletter's mapping but shows no import after Gmail is disconnected and reconnected, until it imports again", async () => {
		let now = new Date("2026-09-30T20:20:00.000Z");
		const { agent, gmail, userId, createReadlist, mapSender, seedJob } = await connectedAgent({ scope: READONLY_SCOPES, now: () => now, appNow: () => now });
		const disconnectGmail = initDisconnectGmail({
			connections: gmail.bundle.gmailConnectionStore,
			credentials: gmail.bundle.gmailCredentialsStore,
			senders: gmail.bundle.gmailSenderStore,
			discovery: gmail.bundle.gmailDiscoveryStore,
			addresses: gmail.addresses,
			removeGmailFilter: async () => ({ ok: true, filterCount: 0, senderCount: 0 }),
			revokeGmailGrant: async () => ({ ok: true }),
			cancelGmailHistoryImports: gmail.bundle.cancelGmailHistoryImports,
			logger: HutchLogger.from(noopLogger),
		});
		gmail.bundle.publishDisconnectGmail = async (input) => {
			await disconnectGmail(input);
		};
		await createReadlist({ slug: "dev-newsletters", label: "Dev newsletters" });
		const devNewsletters = await mapSender(TLDR, "dev-newsletters");
		now = new Date("2026-09-30T20:24:54.000Z");
		await seedJob({ sender: TLDR, destination: devNewsletters, state: "complete", counts: { listed: 1, alreadyImported: 1 } });

		now = new Date("2026-09-30T20:40:00.000Z");
		await agent.post(`${GMAIL}/disconnect`);
		const reconnectedGateway = await gmail.bundle.mintGatewayAddress({ userId });
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress: reconnectedGateway });
		await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: EMAIL });
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: READONLY_SCOPES });
		await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
		await seedDiscovery({ gmail, userId, gatewayAddress: reconnectedGateway, senders: DISCOVERED, generation: "reconnected", state: "complete" });

		now = new Date("2026-09-30T20:43:08.444Z");
		const kept = row(load((await agent.get(GMAIL)).text), TLDR);
		expect(kept.querySelector("[data-test-gmail-mapping-destination]")?.textContent).toBe("Saved to All, Dev newsletters");
		expect(importSummary(kept)).toEqual({ state: "none", message: [], counts: [], actions: ["edit", "start-import", "remove"] });

		now = new Date("2026-09-30T20:44:11.000Z");
		await agent.post(IMPORT_START).type("form").send({ sender: TLDR });

		expect(importSummary(row(load((await agent.get(GMAIL)).text), TLDR))).toEqual({
			state: "queued",
			message: ["Import queued."],
			counts: [],
			actions: ["edit", "cancel-import", "remove"],
		});
	});

	it("keeps a running import on its newsletter when the newsletter is saved again to the readlist it already uses", async () => {
		let now = new Date("2026-09-30T20:20:00.000Z");
		const { agent, createReadlist, mapSender, seedJob } = await connectedAgent({ now: () => now, appNow: () => now });
		await createReadlist({ slug: "tech", label: "Tech" });
		const tech = await mapSender(TLDR, "tech");
		now = new Date("2026-09-30T20:21:00.000Z");
		await seedJob({ sender: TLDR, destination: tech, state: "running", counts: { listed: 2, imported: 1 } });

		now = new Date("2026-09-30T20:22:00.000Z");
		const saved = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "tech" });

		expect(saved.headers.location).toBe(`${GMAIL}?notice=sender_remapped&discovery=started`);
		expect(importSummary(row(load((await agent.get(GMAIL)).text), TLDR))).toEqual({
			state: "running",
			message: ["Importing unread messages from the last 30 days…"],
			counts: ["1 imported", "0 already imported", "0 skipped (no message ID)", "0 skipped (different sender)", "0 failed"],
			actions: ["edit", "cancel-import", "remove"],
		});
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
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: TLDR });
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
		const { agent, gmail } = await connectedAgent({ discovered: false, accountEmail: false, scope: READONLY_SCOPES });
		const started = await agent.post(IMPORT_START).type("form").send({ sender: TLDR });
		expect(started.headers.location).toBe(`${GMAIL}?error=import_reconnect_required&discovery=started`);
		expect(gmail.importStartRequests).toEqual([]);
		const doc = load((await agent.get(started.headers.location)).text);
		expect(doc.querySelector('[data-test-alert="import_reconnect_required"]')?.textContent).toBe(
			"Readplace doesn't know which Gmail account this connection belongs to, so it can't import unread messages. Disconnect Gmail below and connect it again to import them.",
		);
	});

	it("has no mapping to remove through a connection that never recorded its Gmail account", async () => {
		const { agent, gmail, userId } = await connectedAgent({ accountEmail: false });

		const removed = await agent.post(REMOVE).type("form").send({ sender: TLDR });

		expect(removed.headers.location).toBe(`${GMAIL}?notice=sender_removed&discovery=started`);
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-removed" }]);
	});

	it("knows no sender to map through a connection that never recorded its Gmail account", async () => {
		const { agent, gmail } = await connectedAgent({ accountEmail: false });

		const refused = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default" });

		expect(locationParams(refused.headers.location).error).toBe("sender_unknown");
		expect(gmail.rewriteRequests).toEqual([]);
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
		expect(moved.querySelector("[data-test-gmail-import-state]")?.getAttribute("data-test-gmail-import-state")).toBe("none");
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
		expect(doc.querySelector('[data-test-alert="import_cancelled"]')?.textContent).toBe("Import cancelled. Messages already imported stay in your readlists.");
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
		expect((await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).map((entry) => entry.senderEmail)).toEqual([MORNING]);
		expect({ state: (await findJob(jobId))?.state, reason: (await findJob(jobId))?.cancelReason }).toEqual({ state: "cancelled", reason: "mapping-removed" });
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-removed" }]);
		expect((await gmail.bundle.findInboxAddress(destination))?.disabledAt).toBeUndefined();
		const doc = load((await agent.get(removed.headers.location)).text);
		expect(Array.from(doc.querySelectorAll("[data-test-gmail-mapping-row]"), (el) => el.getAttribute("data-test-gmail-mapping-row"))).toEqual([MORNING]);
		expect(doc.querySelector('[data-test-alert="sender_removed"]')?.textContent).toBe("Newsletter removed. Articles you already saved stay in your readlists.");
	});

	it("rejects a malformed removal", async () => {
		const { agent } = await connectedAgent();
		expect((await agent.post(REMOVE).type("form").send({ sender: "bad" })).headers.location).toBe(`${GMAIL}?error=sender_invalid&discovery=started`);
	});

	it("disconnects through the background teardown and stops every import", async () => {
		const { agent, gmail, userId, mapSender, seedJob, findJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		const jobId = await seedJob({ sender: TLDR, destination, state: "queued" });
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/newsletters?notice=gmail_disconnected");
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
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/newsletters?notice=gmail_disconnected");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
		expect(attempts).toBe(2);
	});
});

describe("Read-only and locked readers", () => {
	it.each([1, -1])("offers a tracked upgrade for a revoked connection when the trial ends in %s days", async (trialDays) => {
		const { agent, gmail, userId, harness } = await connectedAgent();
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() + trialDays * ONE_DAY_MS).toISOString() });
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });

		const response = await agent.get(GMAIL).set("HX-Request", "true");
		expect(response.status).toBe(200);
		const doc = load(response.text);
		const reconnect = doc.querySelector("[data-test-gmail-reconnect]");
		assert(reconnect);
		expect(reconnect.querySelector(".gmail__step-copy")?.textContent).toBe("Gmail integration is only available with an active paid subscription.");
		const button = reconnect.querySelector('[data-test-gmail-connection-action="upgrade-gmail"]');
		assert(button);
		expect(button.textContent).toBe("Upgrade");
		const form = button.closest("form");
		assert(form);
		expect(form.getAttribute("method")).toBe("GET");
		expect(form.getAttribute("action")).toBe("/account/plans?utm_source=integrations-gmail&utm_medium=internal&utm_content=upgrade-gmail");
		expect(hiddenFields(form)).toEqual({ utm_source: "integrations-gmail", utm_medium: "internal", utm_content: "upgrade-gmail" });
		const disconnect = doc.querySelector("[data-test-gmail-disconnect]")?.closest("form");
		assert(disconnect);
		expect(disconnect.getAttribute("action")).toBe("/newsletters/gmail/disconnect?utm_source=integrations-gmail&utm_medium=internal&utm_content=disconnect");
	});

	it("offers upgrade for missing metadata permission and in a discovery reconnect fragment", async () => {
		const { agent, gmail, userId, harness, gatewayAddress } = await connectedAgent({ scope: GMAIL_SETTINGS_SCOPE });
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() + ONE_DAY_MS).toISOString() });
		const doc = load((await agent.get(GMAIL)).text);
		const metadata = doc.querySelector("[data-test-gmail-metadata-reconnect]");
		assert(metadata);
		expect(metadata.querySelector(".gmail__step-copy")?.textContent).toBe("Gmail integration is only available with an active paid subscription.");
		const upgrade = metadata.querySelector('[data-test-gmail-connection-action="upgrade-gmail"]')?.closest("form");
		assert(upgrade);
		expect(upgrade.getAttribute("method")).toBe("GET");
		expect(hiddenFields(upgrade)).toEqual({ utm_source: "integrations-gmail", utm_medium: "internal", utm_content: "upgrade-gmail" });

		await seedDiscovery({ gmail, userId, gatewayAddress, senders: [], generation: "upgrade-reconnect", state: "running" });
		await gmail.bundle.gmailDiscoveryStore.failDiscovery({ userId, generation: "upgrade-reconnect", error: "invalid_grant", requiresReconnect: true });
		const fragment = load((await agent.get(`${GMAIL}/senders?discovery=started&poll=1`).set("HX-Request", "true")).text);
		expect(fragment.querySelector("[data-test-gmail-discovery-status]")?.textContent).toBe("Gmail integration is only available with an active paid subscription.");
		const reconnect = senderStatus(fragment).querySelector('[data-test-gmail-connection-action="upgrade-gmail"]')?.closest("form");
		assert(reconnect);
		expect(reconnect.getAttribute("method")).toBe("GET");
		expect(hiddenFields(reconnect)).toEqual({ utm_source: "integrations-gmail", utm_medium: "internal", utm_content: "upgrade-gmail" });
	});

	it.each([1, -1])("offers upgrade instead of new import permission in pages and fragments when the trial ends in %s days", async (trialDays) => {
		const { agent, harness, userId, mapSender, seedJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		await seedJob({ sender: TLDR, destination, state: "awaiting-permission" });
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() + trialDays * ONE_DAY_MS).toISOString() });
		const page = await agent.get(GMAIL);
		const fragment = await agent.get(`${GMAIL}/senders?search=dan`).set("HX-Request", "true");
		for (const response of [page, fragment]) {
			expect(response.status).toBe(200);
			const mapping = row(load(response.text), TLDR);
			const consent = mapping.querySelector("[data-test-gmail-import-consent]");
			assert(consent);
			expect(consent.querySelector(".gmail-mappings__consent-copy")?.textContent).toBe("Gmail integration is only available with an active paid subscription.");
			const form = consent.querySelector('[data-test-gmail-mapping-action="upgrade-gmail"]')?.closest("form");
			assert(form);
			expect(form.getAttribute("method")).toBe("GET");
			expect(form.getAttribute("action")).toBe("/account/plans?utm_source=integrations-gmail&utm_medium=internal&utm_content=upgrade-gmail");
			expect(hiddenFields(form)).toEqual({ utm_source: "integrations-gmail", utm_medium: "internal", utm_content: "upgrade-gmail" });
			expect(rowActionKeys(mapping)).toEqual(["edit", "cancel-import", "remove"]);
		}
	});

	it("keeps paid readers' reconnect action available", async () => {
		const { agent, harness, userId } = await connectedAgent({ scope: GMAIL_SETTINGS_SCOPE });
		await harness.subscriptionProviders.upsertActive({ userId, customerId: "gmail-customer", subscriptionId: "gmail-subscription" });
		const doc = load((await agent.get(GMAIL)).text);
		const button = doc.querySelector("[data-test-gmail-metadata-reconnect-button]");
		assert(button);
		expect(button.textContent).toBe("Reconnect Gmail");
		const form = button.closest("form");
		assert(form);
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe("/newsletters/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=grant-sender-access");
	});

	it("lets a read-only reader remove a newsletter, cancel an import and disconnect", async () => {
		const { agent, gmail, userId, harness, mapSender, seedJob, findJob } = await connectedAgent();
		const destination = await mapSender(TLDR, "default");
		const jobId = await seedJob({ sender: MORNING, destination, state: "running" });
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString() });
		expect((await agent.post(IMPORT_CANCEL).type("form").send({ job: jobId })).headers.location).toBe(`${GMAIL}?notice=import_cancelled&discovery=started`);
		expect((await findJob(jobId))?.state).toBe("cancelled");
		expect((await agent.post(REMOVE).type("form").send({ sender: TLDR })).headers.location).toBe(`${GMAIL}?notice=sender_removed&discovery=started`);
		expect(await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).toEqual([]);
		expect((await agent.post(`${GMAIL}/disconnect`).send()).headers.location).toBe("/newsletters?notice=gmail_disconnected");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
	});

	it("lets a locked reader disconnect Gmail", async () => {
		const { agent, gmail, userId } = await connectedAgent({ appNow: () => new Date(Date.now() + 8 * ONE_DAY_MS) });
		const response = await agent.post(`${GMAIL}/disconnect`).set("Accept", "text/html").send();
		expect(response.headers.location).toBe("/newsletters?notice=gmail_disconnected");
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
		expect((await gmail.bundle.gmailMappingStore.listMappingsByUserId(userId)).map((entry) => entry.senderEmail)).toEqual([MORNING]);
		expect(await articleStore.listReadlistDefinitions(userId)).toEqual([]);
		expect(gmail.discoveryRequests).toEqual([]);
		expect(gmail.importStartRequests).toEqual([]);
	});
});

describe("Gmail multiple readlists and notification confirmation", () => {
	it("requires explicit notification choice for a legacy filtered sender without destinations", async () => {
		const { agent, gmail, userId, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		const existing = await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&notification=1`)).text);
		expect(doc.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(true);
		expect(doc.querySelector('input[name="readlist_choice_for"]')?.getAttribute("value")).toBe(TLDR);
		const confirm = doc.querySelector('button[name="confirm_readlists"]');
		assert(confirm, "the readlist picker must offer its confirmation");
		expect([confirm.getAttribute("value"), confirm.getAttribute("formmethod"), confirm.textContent]).toEqual(["1", "get", "Confirm readlists"]);
		expect(checklistRows(doc)).toEqual([
			["editing", TLDR, "Dan at TLDR", true],
			["known", MORNING, "Morning Brew", false],
		]);
		const selection = doc.querySelector("#gmail-readlist-selection");
		assert(selection, "the Add popup must render the mapping form");
		expect(Array.from(selection.querySelectorAll("input[type=checkbox]"), (box) => box.getAttribute("name"))).toEqual(["readlist", "readlist"]);
		const refused = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "tech", readlist_choice_for: TLDR, add: "1" });
		expect(locationParams(refused.headers.location)).toMatchObject({ error: "readlist_choice_required", readlist_choice_for: TLDR, readlist: "tech", add: "1" });
		expect(dialogAlertKeys(load((await agent.get(refused.headers.location)).text))).toEqual(["readlist_choice_required"]);
		expect(await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR })).toEqual(existing);
		expect(gmail.rewriteRequests).toEqual([]);
		const confirmation = await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=tech&readlist_choice_for=${encodeURIComponent(TLDR)}&add=1&confirm_readlists=1`);
		expect(new URL(confirmation.headers.location, TEST_APP_ORIGIN).searchParams.get("readlist_choice_for")).toBeNull();
		expect(load((await agent.get(confirmation.headers.location)).text).querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
	});

	it("opens a destination-bearing partial mapping with its complete saved selection enabled", async () => {
		const { agent, gmail, userId, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		await createReadlist({ slug: "work", label: "Work" });
		const tech = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: ReadlistSlugSchema.parse("tech") });
		const work = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: ReadlistSlugSchema.parse("work") });
		await gmail.bundle.gmailMappingStore.mapSenderToAddress({ userId, accountEmail: EMAIL, senderEmail: TLDR, mappedAddresses: [tech.address, work.address], deliveryMode: "links" });
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&notification=1&readlist_choice_for=${encodeURIComponent(TLDR)}`)).text);
		expect(doc.querySelector("#gmail-readlist-choice")?.textContent).toBe("All, Tech, Work");
		expect(doc.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
		expect(doc.querySelector('input[name="import"]')).not.toBeNull();
		const saved = await agent.post(ADD).type("form").send(new URLSearchParams([["sender", TLDR], ["readlist", "tech"], ["readlist", "work"], ["readlist_choice_for", TLDR]]).toString());
		expect(locationParams(saved.headers.location).notice).toBe("sender_mapped");
		expect((await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR }))?.addedToFilterAt).toBeDefined();
		expect((await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR }))?.mappedAddresses).toEqual([tech.address, work.address]);
	});

	it("deduplicates repeated selections, validates every custom list, and enforces All when omitted", async () => {
		const { agent, gmail, userId, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		await createReadlist({ slug: "science", label: "Science" });
		const bad = await agent.post(ADD).type("form").send(new URLSearchParams([["sender", TLDR], ["readlist", "tech"], ["readlist", "foreign"]]).toString());
		expect(locationParams(bad.headers.location).error).toBe("readlist_invalid");
		const malformed = await agent.post(ADD).send({ sender: TLDR, readlist: 12 });
		expect(locationParams(malformed.headers.location).error).toBe("readlist_invalid");
		expect(await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR })).toBeUndefined();
		const saved = await agent.post(ADD).type("form").send(new URLSearchParams([["sender", TLDR], ["readlist", "tech"], ["readlist", "science"], ["readlist", "tech"]]).toString());
		expect(locationParams(saved.headers.location).notice).toBe("sender_mapped");
		const mapping = await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		assert(mapping?.mappedAddresses);
		expect(mapping.mappedAddresses).toHaveLength(2);
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&edit=1`)).text);
		expect(doc.querySelector("#gmail-readlist-choice")?.textContent).toBe("All, Science, Tech");
		expect(row(doc, TLDR).querySelector("[data-test-gmail-mapping-destination]")?.textContent).toBe("Saved to All, Science, Tech");
		expect(doc.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
		await agent.post(ADD).type("form").send({ sender: TLDR });
		const allOnly = await gmail.bundle.gmailMappingStore.findMapping({ userId, accountEmail: EMAIL, senderEmail: TLDR });
		assert(allOnly?.mappedAddresses);
		expect(allOnly.mappedAddresses).toHaveLength(1);
		expect((await gmail.bundle.findInboxAddress(allOnly.mappedAddresses[0]))?.readlist).toBeUndefined();
	});

	it("keeps pending notification choice through search, polls, validation and sender changes until explicit All-only confirmation", async () => {
		const { agent, gmail, userId, gatewayAddress, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const pending = new URLSearchParams({ sender: TLDR, readlist_choice_for: TLDR, readlist: "default", add: "1", discovery: "started" });
		const initial = load((await agent.get(`${GMAIL}?${pending}`)).text);
		expect(initial.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(true);
		for (const extra of ["&search=dan", "&error=readlist_name_invalid"]) {
			const doc = load((await agent.get(`${GMAIL}/senders?${pending}${extra}`).set("HX-Request", "true")).text);
			expect(doc.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(true);
		}
		await seedDiscovery({ gmail, userId, gatewayAddress, senders: DISCOVERED, generation: "pending-choice", state: "running" });
		const polled = load((await agent.get(`${GMAIL}?${pending}`)).text);
		expect(new URL(senderStatus(polled).getAttribute("hx-get") ?? "", TEST_APP_ORIGIN).searchParams.get("readlist_choice_for")).toBe(TLDR);
		const changedState = new URLSearchParams(pending);
		changedState.set("sender", MORNING);
		const changed = load((await agent.get(`${GMAIL}?${changedState}`)).text);
		expect(changed.querySelector('input[name="readlist_choice_for"]')?.getAttribute("value")).toBe(TLDR);
		const failed = await agent.post(ADD).type("form").send(Object.fromEntries(pending));
		expect(locationParams(failed.headers.location)).toMatchObject({ error: "readlist_choice_required", readlist_choice_for: TLDR });
		const confirmation = await agent.get(`${GMAIL}?${pending}&confirm_readlists=1`);
		expect(new URL(confirmation.headers.location, TEST_APP_ORIGIN).searchParams.get("readlist_choice_for")).toBeNull();
		const confirmed = load((await agent.get(confirmation.headers.location)).text);
		expect(confirmed.querySelector("#gmail-readlist-choice")?.textContent).toBe("All");
		expect(confirmed.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
		expect(Array.from(confirmed.querySelectorAll('input[name="readlist_choice_for"]'))).toEqual([]);
	});

	it("preserves selections and pending choice after inline creation errors and adds successful creation to the selection", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const state = { sender: TLDR, readlist: "tech", readlist_choice_for: TLDR, add: "1" };
		const failed = await agent.post(CREATE_READLIST).type("form").send({ ...state, readlist_name: " " });
		expect(locationParams(failed.headers.location)).toMatchObject({ readlist: "tech", readlist_choice_for: TLDR, error: "readlist_name_invalid" });
		const created = await agent.post(CREATE_READLIST).type("form").send({ ...state, readlist_name: "Science" });
		const url = new URL(created.headers.location, TEST_APP_ORIGIN);
		expect(url.searchParams.getAll("readlist")).toHaveLength(2);
		expect(url.searchParams.get("readlist_choice_for")).toBeNull();
		const doc = load((await agent.get(created.headers.location)).text);
		expect(doc.querySelector("#gmail-readlist-choice")?.textContent).toBe("All, Tech, Science");
		expect(doc.querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
	});
});

describe("Gmail confirmation URLs", () => {
	it("pushes confirmed repeated choices and keeps a pending choice bound to another sender", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const confirmed = await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&readlist=tech&readlist_choice_for=${encodeURIComponent(TLDR)}&add=1&confirm_readlists=1`).set("HX-Request", "true");
		const state = new URL(confirmed.headers["hx-push-url"], TEST_APP_ORIGIN).searchParams;
		expect(state.getAll("readlist")).toEqual(["default", "tech"]);
		expect(state.get("readlist_choice_for")).toBeNull();
		expect(load(confirmed.text).querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
		const other = await agent.get(`${GMAIL}?sender=${encodeURIComponent(MORNING)}&readlist_choice_for=${encodeURIComponent(TLDR)}&add=1&confirm_readlists=1`).set("HX-Request", "true");
		expect(new URL(other.headers["hx-push-url"], TEST_APP_ORIGIN).searchParams.get("readlist_choice_for")).toBe(TLDR);
		expect(load(other.text).querySelector("[data-test-gmail-save]")?.hasAttribute("disabled")).toBe(false);
	});

	it("keeps a pending choice when nothing is ticked at confirmation", async () => {
		const { agent, createReadlist } = await connectedAgent();
		await createReadlist({ slug: "tech", label: "Tech" });
		const confirmed = await agent.get(`${GMAIL}?readlist_choice_for=${encodeURIComponent(TLDR)}&confirm_readlists=1`);
		expect(confirmed.status).toBe(303);
		expect(new URL(confirmed.headers.location, TEST_APP_ORIGIN).searchParams.get("readlist_choice_for")).toBe(TLDR);
	});
});

describe("GMail Newsletters popup", () => {
	it("offers Add newsletters on the closed page, opening the popup at the same address with add=1", async () => {
		const { agent } = await connectedAgent();
		const closed = load((await agent.get(`${GMAIL}?search=tl&discovery=started`)).text);
		expect(closed.querySelectorAll("#gmail-dialog")).toHaveLength(0);
		const add = closed.querySelector("#gmail-add-newsletters-form");
		assert(add, "the closed page must offer Add newsletters");
		expect([add.getAttribute("method"), add.getAttribute("action")]).toEqual(["GET", GMAIL]);
		const opened = load((await agent.get(`${GMAIL}?${new URLSearchParams(hiddenFields(add))}`)).text);
		expect([opened.querySelector("#gmail-dialog")?.getAttribute("data-test-confirm-popover"), opened.querySelector<HTMLInputElement>("#gmail-sender-search")?.value]).toEqual(["gmail-add", "tl"]);
	});

	it("opens the popup the notification email links to with that newsletter ticked and focused", async () => {
		const { agent } = await connectedAgent();
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(MORNING)}&notification=1&readlist_choice_for=${encodeURIComponent(MORNING)}`)).text);
		expect(doc.querySelector("#gmail-dialog")?.getAttribute("data-test-confirm-popover")).toBe("gmail-add");
		expect(Array.from(doc.querySelectorAll("[autofocus]"), (target) => target.getAttribute("value"))).toEqual([MORNING]);
		const selection = doc.querySelector("#gmail-readlist-selection");
		assert(selection, "the popup must render the mapping form");
		expect(hiddenFields(selection).add).toBe("1");
	});

	it("refreshes the popup without autofocus when the request targets its body", async () => {
		const { agent, mapSender } = await connectedAgent();
		await mapSender(TLDR, "default");
		const url = `${GMAIL}?sender=${encodeURIComponent(TLDR)}&edit=1&discovery=started`;
		const opening = load((await agent.get(url).set("HX-Request", "true")).text);
		expect(Array.from(opening.querySelectorAll("[autofocus]"), (target) => target.id)).toEqual(["gmail-save"]);
		const refresh = load((await agent.get(url).set("HX-Request", "true").set("HX-Target", "gmail-dialog-body")).text);
		expect([refresh.querySelectorAll("#gmail-dialog-body").length, refresh.querySelectorAll("[autofocus]").length]).toEqual([1, 0]);
	});

	it("closes the popup for row and import actions taken from behind it", async () => {
		const { agent, mapSender, seedJob } = await connectedAgent({ scope: READONLY_SCOPES });
		const destination = await mapSender(TLDR, "default");
		await seedJob({ sender: TLDR, destination, state: "failed", failureReason: "gmail-rejected" });
		const queued = await mapSender(MORNING, "default");
		await seedJob({ sender: MORNING, destination: queued, state: "queued" });
		const doc = load((await agent.get(`${GMAIL}?sender=${encodeURIComponent(TLDR)}&edit=1&search=dan&discovery=started`)).text);
		const modeOf = (form: Element) => {
			const fields = hiddenFields(form);
			return { add: fields.add ?? "none", edit: fields.edit ?? "none", search: fields.search };
		};
		expect([
			["edit", modeOf(rowAction(row(doc, TLDR), "edit"))],
			["retry-import", modeOf(rowAction(row(doc, TLDR), "retry-import"))],
			["remove", modeOf(rowAction(row(doc, TLDR), "remove"))],
			["cancel-import", modeOf(rowAction(row(doc, MORNING), "cancel-import"))],
		]).toEqual([
			["edit", { add: "none", edit: "1", search: "dan" }],
			["retry-import", { add: "none", edit: "none", search: "dan" }],
			["remove", { add: "none", edit: "none", search: "dan" }],
			["cancel-import", { add: "none", edit: "none", search: "dan" }],
		]);
		const cancelled = await agent.post(IMPORT_CANCEL).type("form").send({ ...hiddenFields(rowAction(row(doc, MORNING), "cancel-import")) });
		expect(cancelled.headers.location).toBe(`${GMAIL}?notice=import_cancelled&search=dan&sender=dan%40tldr.tech&readlist=default&discovery=started`);
		const consenting = await connectedAgent();
		const pending = await consenting.mapSender(TLDR, "default");
		await consenting.seedJob({ sender: TLDR, destination: pending, state: "awaiting-permission" });
		const asking = load((await consenting.agent.get(`${GMAIL}?add=1&search=dan&discovery=started`)).text);
		const consent = row(asking, TLDR).querySelector("[data-test-gmail-import-consent] form");
		assert(consent, "a newsletter waiting for read access must offer the consent form");
		expect(modeOf(consent)).toEqual({ add: "none", edit: "none", search: "dan" });
		const removed = await agent.post(REMOVE).type("form").send({ sender: TLDR, edit: "1", add: "1", search: "dan" });
		expect(removed.headers.location).toBe(`${GMAIL}?notice=sender_removed&search=dan&discovery=started`);
		const started = await agent.post(IMPORT_START).type("form").send({ sender: TLDR, edit: "1", add: "1" });
		expect(started.headers.location).toBe(`${GMAIL}?error=import_unavailable&discovery=started`);
	});

	it("closes on a successful Save and keeps a refused Save inside the popup", async () => {
		const { agent, mapSender } = await connectedAgent();
		await mapSender(TLDR, "default");
		const saved = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "default", edit: "1", search: "dan" });
		expect(saved.headers.location).toBe(`${GMAIL}?notice=sender_remapped&search=dan&discovery=started`);
		const landed = load((await agent.get(saved.headers.location)).text);
		expect([landed.querySelectorAll("#gmail-dialog").length, Array.from(landed.querySelectorAll(".gmail__container > [data-test-alert]"), (alert) => alert.getAttribute("data-test-alert"))]).toEqual([0, ["sender_remapped"]]);
		const refused = await agent.post(ADD).type("form").send({ sender: TLDR, readlist: "nope", edit: "1" });
		const kept = load((await agent.get(refused.headers.location)).text);
		expect([kept.querySelector("#gmail-dialog")?.getAttribute("data-test-confirm-popover"), dialogAlertKeys(kept), alertKeys(kept)]).toEqual(["gmail-edit", ["readlist_invalid"], []]);
	});

	it("closes to the page with its own notices, leaving the popup's errors behind", async () => {
		const { agent } = await connectedAgent();
		const doc = load((await agent.get(`${GMAIL}?add=1&search=tl&error=sender_unknown`)).text);
		const cancel = doc.querySelector('[data-test-action="gmail-add-cancel"]');
		assert(cancel, "the popup must offer Cancel");
		expect([cancel.getAttribute("hx-target"), locationParams(cancel.getAttribute("href") ?? "")]).toEqual(["main", {
			search: "tl", discovery: "started", utm_source: "integrations-gmail", utm_medium: "internal", utm_content: "cancel-dialog",
		}]);
	});

	it("lands a Load senders refused for permission on the closed page", async () => {
		const { agent } = await connectedAgent({ scope: GMAIL_SETTINGS_SCOPE });
		const refused = await agent.post(DISCOVER).type("form").send({ add: "1" });
		const landed = load((await agent.get(refused.headers.location)).text);
		expect([landed.querySelectorAll("#gmail-dialog").length, alertKeys(landed), landed.querySelector("[data-test-gmail-metadata-reconnect] .gmail__step-copy")?.textContent]).toEqual([
			0,
			["metadata_required"],
			"Reconnect Gmail to choose senders from your mailbox. The newsletters you set up stay in place.",
		]);
	});
});
