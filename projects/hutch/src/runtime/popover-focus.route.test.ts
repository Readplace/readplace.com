import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { MinutesSchema } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { AliasNameSchema, emailIssueArticleUrl } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { describePopoverFocusGaps, findPopoverFocusGaps } from "@packages/web-test-harness";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const ARTICLE_URL = "https://example.com/article";
const ONE_DAY_MS = 86_400_000;

function createdSlug(location: string): string {
	const slug = new URL(location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land on it");
	return slug;
}

const GUEST_PATHS = ["/", "/import", "/save"];

const MEMBER_PATHS = [
	"/queue",
	"/queue?tab=done",
	"/queue",
	"/account",
	"/account?section=subscription",
	"/newsletters",
	"/import",
];

const EXTENSION_CALLBACK = "http://127.0.0.1:3000/oauth/callback";

async function connectChromeExtension(agent: Awaited<ReturnType<typeof loginAgent>>): Promise<void> {
	const verifier = randomBytes(32).toString("base64url");
	const authorize = await agent.post("/oauth/authorize").type("form").send({
		client_id: "hutch-chrome-extension",
		redirect_uri: EXTENSION_CALLBACK,
		response_type: "code",
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
		state: "popover-focus",
		action: "approve",
	});
	const code = new URL(authorize.headers.location).searchParams.get("code");
	assert(code, "approving the Chrome extension must redirect with a code");
	const token = await agent.post("/oauth/token").type("form").send({
		grant_type: "authorization_code",
		code,
		redirect_uri: EXTENSION_CALLBACK,
		client_id: "hutch-chrome-extension",
		code_verifier: verifier,
	});
	assert.equal(token.status, 200, "the code must exchange for the Chrome extension's tokens");
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function gapsOn({ path, html }: { path: string; html: string }): string[] {
	return describePopoverFocusGaps(findPopoverFocusGaps(html)).map((line) => `${path}  ${line}`);
}

function dialogKeys(html: string): string[] {
	return Array.from(parse(html).querySelectorAll("[data-test-confirm-popover]"), (panel) =>
		panel.getAttribute("data-test-confirm-popover") ?? "",
	);
}

async function highlightedReaderPath(input: {
	agent: Awaited<ReturnType<typeof loginAgent>>;
	articleId: string;
	exact: string;
}): Promise<string> {
	const path = `/queue/${input.articleId}/view`;
	const content = parse((await input.agent.get(path)).text).querySelector(".article-body__content");
	assert(content, "the reader must render its content");
	const start = normaliseText(collectTextChunks<Node>(content)).text.indexOf(input.exact);
	assert(start >= 0, `the served text must hold "${input.exact}"`);
	const created = await input.agent
		.post(`/queue/${input.articleId}/highlights`)
		.type("form")
		.send({
			exact: input.exact,
			start: String(start),
			end: String(start + input.exact.length),
			origin: "mouse",
			note: "A note on the passage",
		});
	assert.equal(created.status, 303, "the highlight must be created");
	return path;
}

function autofocusCount(scope: ParentNode): number {
	return scope.querySelectorAll("[autofocus]").length;
}

function lockKeys(html: string): string[] {
	const keys = Array.from(parse(html).querySelectorAll("[data-test-needs-upgrade]"), (lock) =>
		lock.getAttribute("data-test-needs-upgrade") ?? "",
	);
	return [...new Set(keys)];
}

async function readOnlyReader() {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const agent = await loginAgent(harness.server, harness.auth);
	const reader = await harness.auth.findUserByEmail("test@example.com");
	assert(reader, "the logged-in reader must exist");
	await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });
	const slug = createdSlug((await agent.post("/queue/queues").type("form").send({ label: "Tech" })).headers.location);
	const queue = parse((await agent.get("/queue").set(BROWSER_REQUEST_HEADERS)).text);
	const readerHref = queue.querySelector("[data-test-article-title]")?.getAttribute("href");
	assert(readerHref, "the saved article must link to its reader");
	await harness.subscriptionProviders.upsertTrialing({
		userId: reader.userId,
		trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
	});
	return { agent, slug, readerHref };
}

describe("every popup opens on its first decision", () => {
	it("holds across the logged-out funnel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const gaps: string[] = [];
		const keys = new Set<string>();
		for (const path of GUEST_PATHS) {
			const response = await request(harness.server).get(path).set(BROWSER_REQUEST_HEADERS);
			gaps.push(...gapsOn({ path, html: response.text }));
			for (const key of dialogKeys(response.text)) keys.add(key);
		}

		expect(gaps).toEqual([]);
		expect(keys.has("save-tip")).toBe(true);
	});

	it("holds across the signed-in surfaces, including the reader and its article history", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const reader = await harness.auth.findUserByEmail("test@example.com");
		assert(reader, "the logged-in reader must exist");
		await harness.subscriptionProviders.upsertTrialing({
			userId: reader.userId,
			trialEndsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
		});
		await fixture.inboxAddress.inboxAddressStore.createAddress({
			userId: reader.userId,
			domain: fixture.inboxAddress.inboxAddressDomain,
			name: AliasNameSchema.parse("news"),
			purpose: "user-alias",
		});
		await connectChromeExtension(agent);
		await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });
		await fixture.articleStore.setCrawlVersions({
			url: ARTICLE_URL,
			versions: [
				{ crawledAtMinute: "2026-07-10T09:14Z", authorUserId: reader.userId },
				{ crawledAtMinute: "2026-06-28T22:01Z" },
			],
		});
		const queue = parse((await agent.get("/queue").set(BROWSER_REQUEST_HEADERS)).text);
		const readerHref = queue.querySelector("[data-test-article-title]")?.getAttribute("href");
		assert(readerHref, "the saved article must link to its reader");
		const issueUrl = emailIssueArticleUrl({
			userId: reader.userId,
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<issue-42@tldr.tech>",
		});
		await fixture.articleStore.saveArticle({
			userId: reader.userId,
			url: issueUrl,
			metadata: { title: "TLDR 2026-06-24", siteName: "TLDR", excerpt: "Today's links", wordCount: 480 },
			estimatedReadTime: MinutesSchema.parse(2),
			provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
			savedAt: new Date("2026-06-24T09:01:00.000Z"),
			saveTrigger: "manual",
		});
		await fixture.articleStore.writeContent({ url: issueUrl, content: "<p>Today's links, with commentary.</p>" });
		await fixture.articleCrawl.markCrawlReady({ url: issueUrl });
		const issue = await fixture.articleStore.findArticleByUrl(issueUrl);
		assert(issue, "the seeded issue is saved");
		const highlightedPath = await highlightedReaderPath({ agent, articleId: issue.id.value, exact: "commentary" });
		const madeReadlist = createdSlug(
			(await agent.post("/queue/queues").type("form").send({ label: "New Readlist" })).headers.location,
		);
		const describedReadlist = createdSlug(
			(await agent.post("/queue/queues").type("form").send({ label: "Described Readlist" })).headers.location,
		);
		await agent
			.post(`/queue/queues/${describedReadlist}/preferences`)
			.type("form")
			.send({ purpose: "Essays on how teams actually ship." });

		const gaps: string[] = [];
		const keys = new Set<string>();
		const readerKeys: string[] = [];
		const highlightedKeys: string[] = [];
		const highlightedPreviews: { previews: (string | null)[]; marks: (string | null)[] } = { previews: [], marks: [] };
		let drawerSeen = false;
		for (const path of [
			...MEMBER_PATHS,
			`/queue?queue=${madeReadlist}`,
			`/queue/queues/${madeReadlist}/preferences`,
			`/queue/queues/${describedReadlist}/preferences`,
			readerHref,
			`/queue/${issue.id.value}/view`,
			highlightedPath,
		]) {
			const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);
			expect({ path, status: response.status }).toEqual({ path, status: 200 });
			gaps.push(...gapsOn({ path, html: response.text }));
			for (const key of dialogKeys(response.text)) keys.add(key);
			if (path === readerHref) readerKeys.push(...dialogKeys(response.text));
			if (path === highlightedPath) {
				highlightedKeys.push(...dialogKeys(response.text));
				const page = parse(response.text);
				highlightedPreviews.previews = Array.from(page.querySelectorAll("[data-test-highlight-preview]"), (preview) =>
					preview.getAttribute("data-test-highlight-preview"),
				);
				highlightedPreviews.marks = [
					...new Set(Array.from(page.querySelectorAll("mark[data-highlight-id]"), (mark) => mark.getAttribute("data-highlight-id"))),
				];
			}
			drawerSeen ||= parse(response.text).querySelector("[data-test-discovery-drawer]") !== null;
		}

		expect(gaps).toEqual([]);
		expect(drawerSeen).toBe(true);
		expect(readerKeys).toContain("delete");
		expect(highlightedPreviews.marks).toHaveLength(1);
		expect(highlightedPreviews.previews).toEqual(highlightedPreviews.marks);
		expect(highlightedKeys).toEqual(expect.arrayContaining(["highlight-delete", "highlight-note", "highlight-note-edit"]));
		expect([...keys].sort()).toEqual([
			"account-profile",
			"add-link",
			"article-version-delete",
			"delete",
			"delete-account",
			"disconnect-app",
			"download-guide",
			"exit-confirm",
			"highlight-delete",
			"highlight-note",
			"highlight-note-edit",
			"mark-status",
			"move",
			"readlist-create",
			"readlist-create-move",
			"readlist-delete",
			"readlist-preferences",
			"readlist-rename",
			"save-tip",
			"share",
			"sharing-off",
			"subscribe-plans",
		]);
	}, 30000);

	it("holds on the Gmail newsletters popups, which open on their first decision, and keeps the closed page free of autofocus", async () => {
		const gmail = initInMemoryGmailIntegration({
			grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
			addresses: initInMemoryInboxAddress({ now: () => new Date() }),
		});
		const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle });
		const agent = await loginAgent(harness.server, harness.auth);
		const reader = await harness.auth.findUserByEmail("test@example.com");
		assert(reader, "the logged-in reader must exist");
		const userId = reader.userId;
		const accountEmail = GmailAccountEmailSchema.parse("reader@gmail.com");
		const mapped = ForwardableSenderSchema.parse("dan@tldr.tech");
		const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail });
		await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: GMAIL_SCOPES });
		const destination = await gmail.bundle.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG });
		await gmail.bundle.gmailMappingStore.mapSenderToAddress({ userId, accountEmail, senderEmail: mapped, mappedAddresses: [destination.address], deliveryMode: "links" });
		await gmail.bundle.gmailMappingStore.addSenderToFilter({ userId, accountEmail, senderEmail: mapped });

		const gaps: string[] = [];
		const keys: string[] = [];
		for (const path of [
			"/newsletters/gmail?add=1",
			`/newsletters/gmail?sender=${encodeURIComponent(mapped)}&edit=1&discovery=started`,
		]) {
			const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);
			expect({ path, status: response.status }).toEqual({ path, status: 200 });
			gaps.push(...gapsOn({ path, html: response.text }));
			keys.push(...dialogKeys(response.text));
		}
		const closed = parse((await agent.get("/newsletters/gmail").set(BROWSER_REQUEST_HEADERS)).text);

		expect(gaps).toEqual([]);
		expect(keys).toEqual(["gmail-add", "gmail-edit"]);
		expect([closed.querySelectorAll("#gmail-add-newsletters-form").length, autofocusCount(closed)]).toEqual([1, 0]);
	});

	it("holds on the Gmail disclaimer a member outside a trial meets before connecting", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.get("/newsletters").set(BROWSER_REQUEST_HEADERS);

		expect(gapsOn({ path: "/newsletters", html: response.text })).toEqual([]);
		expect(dialogKeys(response.text)).toContain("gmail-connect-disclaimer");
	});

	it("holds on a readlist's Gmail connect disclaimer, and keeps its picker free of autofocus", async () => {
		const gmail = initInMemoryGmailIntegration({
			grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
			addresses: initInMemoryInboxAddress({ now: () => new Date() }),
		});
		const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle });
		const agent = await loginAgent(harness.server, harness.auth);
		const reader = await harness.auth.findUserByEmail("test@example.com");
		assert(reader, "the logged-in reader must exist");
		const userId = reader.userId;
		const accountEmail = GmailAccountEmailSchema.parse("reader@gmail.com");
		const slug = createdSlug((await agent.post("/queue/queues").type("form").send({ label: "Tech" })).headers.location);
		const preferences = `/queue/queues/${slug}/preferences`;
		const unconnected = await agent.get(preferences).set(BROWSER_REQUEST_HEADERS);
		const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail });
		await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: GMAIL_SCOPES });
		const searched = parse((await agent.get(`${preferences}?gmail_selection=1&search=tldr`).set(BROWSER_REQUEST_HEADERS)).text);
		const section = searched.querySelector("[data-test-readlist-gmail-senders]");
		assert(section, "the connected readlist must render its Gmail newsletters section");

		expect(gapsOn({ path: preferences, html: unconnected.text })).toEqual([]);
		expect(dialogKeys(unconnected.text)).toContain("gmail-connect-disclaimer");
		expect([section.getAttribute("data-test-gmail-senders-state"), autofocusCount(section)]).toEqual(["picker", 0]);
	});

	it("holds with one plan chooser on every page a read-only reader can meet a lock on", async () => {
		const { agent, slug, readerHref } = await readOnlyReader();
		const gaps: string[] = [];
		const keys = new Set<string>();
		const choosers: { path: string; count: number }[] = [];
		const paths = [
			"/queue",
			`/queue?queue=${slug}`,
			`/queue/queues/${slug}/preferences`,
			"/account",
			"/install?client=chrome",
			"/import",
			"/newsletters",
			readerHref,
		];
		for (const path of paths) {
			const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);
			expect({ path, status: response.status }).toEqual({ path, status: 200 });
			gaps.push(...gapsOn({ path, html: response.text }));
			for (const key of dialogKeys(response.text)) keys.add(key);
			choosers.push({ path, count: parse(response.text).querySelectorAll("#subscribe-plans").length });
		}

		expect(gaps).toEqual([]);
		expect(keys.has("subscribe-plans")).toBe(true);
		expect(choosers).toEqual(paths.map((path) => ({ path, count: 1 })));
	}, 30000);

	it("holds on the Connectors page of an active trial, whose one lock is Connect Gmail", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const reader = await harness.auth.findUserByEmail("test@example.com");
		assert(reader, "the logged-in reader must exist");
		await harness.subscriptionProviders.upsertTrialing({
			userId: reader.userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/newsletters").set(BROWSER_REQUEST_HEADERS);

		expect(gapsOn({ path: "/newsletters", html: response.text })).toEqual([]);
		expect(dialogKeys(response.text)).toContain("subscribe-plans");
		expect(parse(response.text).querySelectorAll("#subscribe-plans").length).toBe(1);
		expect(lockKeys(response.text)).toEqual(["connect-gmail"]);
	});

	it("keeps autofocus off every inline copy and on the refused field of a 422", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const unservedUrl = "https://mail.google.com/mail/u/0/";
		await agent.post("/queue/save").type("form").send({ url: unservedUrl });
		const unserved = await fixture.articleStore.findArticleByUrl(unservedUrl);
		assert(unserved, "the unserved article is saved");
		const refusedNote = await agent
			.post(`/queue/${unserved.id.value}/highlights`)
			.set("HX-Request", "true")
			.type("form")
			.send({ exact: "anything", start: "0", end: "8", origin: "mouse", note: "Kept", answer: "dialog" });
		const refusedNoteTargets = Array.from(parse(refusedNote.text).querySelectorAll("[autofocus]"), (target) =>
			target.hasAttribute("data-test-highlight-note-input"),
		);
		const plans = parse((await agent.get("/account/plans").set(BROWSER_REQUEST_HEADERS)).text);
		const madeReadlist = createdSlug(
			(await agent.post("/queue/queues").type("form").send({ label: "New Readlist" })).headers.location,
		);
		const preferences = parse(
			(await agent.get(`/queue/queues/${madeReadlist}/preferences`).set(BROWSER_REQUEST_HEADERS)).text,
		);
		const inline = preferences.querySelector('[data-test-wizard-surface="inline"]');
		const popover = preferences.querySelector('[data-test-wizard-surface="popover"]');
		assert(inline, "the preferences page must render the inline wizard");
		assert(popover, "the preferences page must render the popover wizard");
		const createForm = parse((await agent.get("/queue").set(BROWSER_REQUEST_HEADERS)).text).querySelector(
			'[data-test-confirm-popover="readlist-create"] form[data-test-form="readlist-create"]',
		);
		const action = createForm?.getAttribute("hx-post");
		assert(action, "the create dialog's form must post through htmx");
		const refused = await agent.post(action).set("HX-Request", "true").type("form").send({ label: "   " });
		const refusedTargets = Array.from(parse(refused.text).querySelectorAll("[autofocus]"), (target) =>
			target.hasAttribute("data-test-readlist-create-input"),
		);

		expect(autofocusCount(plans)).toBe(0);
		expect(autofocusCount(inline)).toBe(0);
		expect(Array.from(popover.querySelectorAll("[autofocus]"), (target) => target.getAttribute("data-test-field"))).toEqual([
			"purpose",
		]);
		expect(refused.status).toBe(422);
		expect(refusedTargets).toEqual([true]);
		expect(refusedNote.status).toBe(422);
		expect(refusedNoteTargets).toEqual([true]);
	});
});

describe("the in-app surface offers no upgrade to a read-only reader", () => {
	it.each([
		{ path: "/queue?platform=ios", marker: '#add-link input[name="url"][disabled]' },
		{ path: "/account?platform=ios", marker: 'form[action*="/account/delete"][action*="platform=ios"]' },
		{ path: "/account?shell=app", marker: "[data-test-account-back-link]" },
		{ path: "/newsletters?platform=ios", marker: '[data-test-integration-action="upgrade-gmail"]' },
	])("$path keeps today's rendering with no lock and no plan chooser", async ({ path, marker }) => {
		const { agent } = await readOnlyReader();

		const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);
		const doc = parse(response.text);

		expect(response.status).toBe(200);
		expect(lockKeys(response.text)).toEqual([]);
		expect(doc.querySelectorAll('#subscribe-plans, [popovertarget="subscribe-plans"]').length).toBe(0);
		expect(doc.querySelector(marker)).not.toBeNull();
	});
});
