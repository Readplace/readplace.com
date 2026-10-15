import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { AliasNameSchema } from "@packages/domain/inbox";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { describePopoverFocusGaps, findPopoverFocusGaps } from "@packages/web-test-harness";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const ARTICLE_URL = "https://example.com/article";

function createdSlug(location: string): string {
	const slug = new URL(location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land on it");
	return slug;
}

const GUEST_PATHS = ["/", "/import", "/save"];

const MEMBER_PATHS = [
	"/queue",
	"/queue?tab=done",
	"/queue?feature=pref",
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

function gapsOn(path: string, html: string): string[] {
	return describePopoverFocusGaps(findPopoverFocusGaps(html)).map((line) => `${path}  ${line}`);
}

function dialogKeys(html: string): string[] {
	return Array.from(parse(html).querySelectorAll("[data-test-confirm-popover]"), (panel) =>
		panel.getAttribute("data-test-confirm-popover") ?? "",
	);
}

function autofocusCount(scope: ParentNode): number {
	return scope.querySelectorAll("[autofocus]").length;
}

describe("every popup opens on its first decision", () => {
	it("holds across the logged-out funnel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const gaps: string[] = [];
		const keys = new Set<string>();
		for (const path of GUEST_PATHS) {
			const response = await request(harness.server).get(path).set(BROWSER_REQUEST_HEADERS);
			gaps.push(...gapsOn(path, response.text));
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
		let drawerSeen = false;
		for (const path of [
			...MEMBER_PATHS,
			`/queue?queue=${madeReadlist}&feature=pref`,
			`/queue/queues/${madeReadlist}/preferences?feature=pref`,
			`/queue/queues/${describedReadlist}/preferences?feature=pref`,
			readerHref,
		]) {
			const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);
			expect({ path, status: response.status }).toEqual({ path, status: 200 });
			gaps.push(...gapsOn(path, response.text));
			for (const key of dialogKeys(response.text)) keys.add(key);
			drawerSeen ||= parse(response.text).querySelector("[data-test-discovery-drawer]") !== null;
		}

		expect(gaps).toEqual([]);
		expect(drawerSeen).toBe(true);
		expect([...keys].sort()).toEqual([
			"account-profile",
			"article-version-delete",
			"delete",
			"delete-account",
			"disconnect-app",
			"exit-confirm",
			"mark-status",
			"move",
			"readlist-create",
			"readlist-create-move",
			"readlist-delete",
			"readlist-preferences",
			"readlist-purpose-delete",
			"readlist-rename",
			"save-tip",
			"share",
			"subscribe-plans",
		]);
	});

	it("holds on the Gmail disclaimer a member outside a trial meets before connecting", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.get("/newsletters").set(BROWSER_REQUEST_HEADERS);

		expect(gapsOn("/newsletters", response.text)).toEqual([]);
		expect(dialogKeys(response.text)).toContain("gmail-connect-disclaimer");
	});

	it("keeps autofocus off every inline copy and on the refused field of a 422", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const plans = parse((await agent.get("/account/plans").set(BROWSER_REQUEST_HEADERS)).text);
		const madeReadlist = createdSlug(
			(await agent.post("/queue/queues").type("form").send({ label: "New Readlist" })).headers.location,
		);
		const preferences = parse(
			(await agent.get(`/queue/queues/${madeReadlist}/preferences?feature=pref`).set(BROWSER_REQUEST_HEADERS)).text,
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
	});
});
