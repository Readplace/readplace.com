import assert from "node:assert/strict";
import { READLIST_PURPOSE_MAX_LENGTH } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;

const PURPOSE = "Essays on how teams actually ship.";

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function createReadlist(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

function preferencesPath(slug: string): string {
	return `/queue/queues/${slug}/preferences`;
}

function withPreferencesFeature(path: string): string {
	return `${path}${path.includes("?") ? "&" : "?"}feature=pref`;
}

function filterTabs(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-filter]"), (tab) =>
		tab.getAttribute("data-test-filter"),
	);
}

function savePurpose(agent: TestAgent, slug: string, purpose: string) {
	return agent.post(preferencesPath(slug)).type("form").send({ purpose });
}

function panel(doc: Document): Element {
	const section = doc.querySelector("[data-test-readlist-preferences]");
	assert(section, "the preferences tab must render its panel");
	return section;
}

function field(doc: Document, surface: "popover" | "inline"): Element {
	const textarea = doc.querySelector(
		`[data-test-wizard-surface="${surface}"] [data-test-field="purpose"]`,
	);
	assert(textarea, `the ${surface} surface must render the purpose field`);
	return textarea;
}

async function makeReadOnly(harness: TestHarness): Promise<void> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in test user must exist");
	await harness.subscriptionProviders.upsertActive({
		userId: user.userId,
		subscriptionId: "sub_ro",
		customerId: "cus_ro",
	});
	await harness.subscriptionProviders.markCancelledByUserId({ userId: user.userId });
}

describe("GET /queue/queues/:slug/preferences", () => {
	it("offers to set the readlist up while it has no purpose", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(panel(doc).getAttribute("data-test-preferences-state")).toBe("unset");
		const setup = doc.querySelector('[data-test-action="readlist-preferences-setup"]');
		assert(setup, "the unset state must offer the set-up call to action");
		expect(setup.textContent).toBe("Set up New Readlist");
		expect(field(doc, "popover").textContent).toBe("");
	});

	it("shows the stored purpose read-only once it is set, pre-filled for editing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		await savePurpose(agent, slug, PURPOSE);

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(panel(doc).getAttribute("data-test-preferences-state")).toBe("set");
		expect(doc.querySelector("[data-test-preferences-purpose]")?.textContent).toBe(PURPOSE);
		expect(field(doc, "popover").textContent).toBe(PURPOSE);
		expect(field(doc, "inline").textContent).toBe(PURPOSE);
	});

	it("keeps the wizard closed until something asks for it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(panel(doc).className).toContain("readlist-preferences--unset");
		expect(panel(doc).className).not.toContain("readlist-preferences--wizard-open");
	});

	it("reopens the wizard on a draft carried in the URL, without touching what is stored", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		await savePurpose(agent, slug, PURPOSE);

		const doc = parse((await agent.get(`${preferencesPath(slug)}?purpose=Drafting`)).text);

		expect(panel(doc).className).toContain("readlist-preferences--wizard-open");
		expect(field(doc, "popover").textContent).toBe("Drafting");
		expect(doc.querySelector("[data-test-preferences-purpose]")?.textContent).toBe(PURPOSE);
	});

	it("names the third tab and marks it the one being read", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(withPreferencesFeature(preferencesPath(slug)))).text);

		expect(filterTabs(doc)).toEqual(["unread", "read", "preferences"]);
		const preferences = doc.querySelector('[data-test-filter="preferences"]');
		assert(preferences, "the preferences tab must render");
		expect(preferences.getAttribute("aria-current")).toBe("page");
		expect(preferences.getAttribute("href")).toContain("utm_source=queue-filters");
	});

	it("hides the tab on the built-in readlist, which has no row to describe", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get(withPreferencesFeature("/queue"))).text);

		expect(filterTabs(doc)).toEqual(["unread", "read"]);
	});

	it("offers the tab from a reader-made readlist's listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(withPreferencesFeature(`/queue?queue=${slug}`))).text);
		const preferences = doc.querySelector('[data-test-filter="preferences"]');
		assert(preferences, "a reader-made readlist's listing must offer the preferences tab");

		expect(preferences.getAttribute("href")).toContain(preferencesPath(slug));
	});

	it("keeps the tab out of a reader-made readlist's listing until the feature is asked for", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(`/queue?queue=${slug}`)).text);

		expect(filterTabs(doc)).toEqual(["unread", "read"]);
	});

	it("keeps the tab out of its own page until the feature is asked for", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(filterTabs(doc)).toEqual(["unread", "read"]);
		expect(panel(doc).getAttribute("data-test-preferences-state")).toBe("unset");
	});

	it("carries the feature forward on every tab, so the strip survives a hop back to the listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(withPreferencesFeature(preferencesPath(slug)))).text);
		const hrefs = Array.from(doc.querySelectorAll("[data-test-filter]"), (tab) =>
			tab.getAttribute("href"),
		);

		expect(hrefs.every((href) => href?.includes("feature=pref"))).toBe(true);
	});

	it("sends a reader asking for a readlist they do not have back to the default one", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(preferencesPath("a1b2c3d4"));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("sends a reader asking for a malformed readlist back to the default one", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(preferencesPath("Not A Slug"));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("asks a signed-out visitor to log in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get(preferencesPath("a1b2c3d4"));

		expect(response.status).toBe(303);
		expect(response.headers.location).toContain("/login");
	});

	it("still renders for a read-only reader, who can read what they wrote", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		await savePurpose(agent, slug, PURPOSE);
		await makeReadOnly(harness);

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(doc.querySelector("[data-test-preferences-purpose]")?.textContent).toBe(PURPOSE);
	});
});

describe("POST /queue/queues/:slug/preferences", () => {
	it("stores the purpose and lands the reader back on the tab with it shown", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await savePurpose(agent, slug, `  ${PURPOSE}  `);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(preferencesPath(slug));
		const doc = parse((await agent.get(preferencesPath(slug))).text);
		expect(doc.querySelector("[data-test-preferences-purpose]")?.textContent).toBe(PURPOSE);
	});

	it("replaces the purpose when the reader edits it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		await savePurpose(agent, slug, PURPOSE);

		await savePurpose(agent, slug, "Weekend reading only.");

		const doc = parse((await agent.get(preferencesPath(slug))).text);
		expect(doc.querySelector("[data-test-preferences-purpose]")?.textContent).toBe(
			"Weekend reading only.",
		);
	});

	it("keeps one readlist's purpose off another's tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const described = await createReadlist(agent);
		const untouched = await createReadlist(agent);
		await savePurpose(agent, described, PURPOSE);

		const doc = parse((await agent.get(preferencesPath(untouched))).text);

		expect(panel(doc).getAttribute("data-test-preferences-state")).toBe("unset");
	});

	it("sends an empty purpose back to the tab with the wizard open and the reason shown", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await savePurpose(agent, slug, "   ");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`${preferencesPath(slug)}?preferences_error=invalid-purpose`,
		);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(panel(doc).className).toContain("readlist-preferences--wizard-open");
		const error = doc.querySelector(
			'[data-test-wizard-surface="popover"] [data-test-wizard-error]',
		);
		assert(error, "the refused save must explain itself on the panel");
		expect(error.className).toContain("wizard__error--visible");
		expect(error.textContent).toBe(
			"Say what this readlist is for, in up to 10,000 characters.",
		);
		expect(field(doc, "popover").getAttribute("aria-invalid")).toBe("true");
	});

	it("refuses a purpose longer than the field allows", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await savePurpose(agent, slug, "a".repeat(READLIST_PURPOSE_MAX_LENGTH + 1));

		expect(response.headers.location).toBe(
			`${preferencesPath(slug)}?preferences_error=invalid-purpose`,
		);
		const doc = parse((await agent.get(preferencesPath(slug))).text);
		expect(panel(doc).getAttribute("data-test-preferences-state")).toBe("unset");
	});

	it("refuses a submit with no purpose field at all", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent.post(preferencesPath(slug)).type("form").send({});

		expect(response.headers.location).toBe(
			`${preferencesPath(slug)}?preferences_error=invalid-purpose`,
		);
	});

	it("keeps the feature on the redirect, so the saved purpose lands on a page that still has the tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(withPreferencesFeature(preferencesPath(slug)))
			.type("form")
			.send({ purpose: PURPOSE });

		expect(response.headers.location).toBe(withPreferencesFeature(preferencesPath(slug)));
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(filterTabs(doc)).toEqual(["unread", "read", "preferences"]);
	});

	it("keeps the feature on a refusal, so the reopened wizard keeps its tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(withPreferencesFeature(preferencesPath(slug)))
			.type("form")
			.send({ purpose: "   " });

		expect(response.headers.location).toBe(
			`${preferencesPath(slug)}?preferences_error=invalid-purpose&feature=pref`,
		);
	});

	it("refuses to describe the built-in readlist, which has no row to describe", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await savePurpose(agent, "default", PURPOSE);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("refuses a readlist the reader does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await savePurpose(agent, "a1b2c3d4", PURPOSE);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("refuses a malformed readlist id", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await savePurpose(agent, "Not A Slug", PURPOSE);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("turns a read-only reader away from writing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		await makeReadOnly(harness);

		const response = await savePurpose(agent, slug, PURPOSE);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("asks a signed-out visitor to log in rather than writing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post(preferencesPath("a1b2c3d4"))
			.type("form")
			.send({ purpose: PURPOSE });

		expect(response.status).toBe(303);
		expect(response.headers.location).toContain("/login");
	});
});
