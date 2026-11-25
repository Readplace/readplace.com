import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";
import { seedInto } from "../../test-helpers/readlist-seed";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;

const PURPOSE = "Papers and essays on distributed systems.";

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function preferencesPath(slug: string): string {
	return `/queue/queues/${slug}/preferences`;
}

function slugFrom(location: string): string {
	const slug = new URL(location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function createReadlist(agent: TestAgent, fields: Record<string, string>): Promise<string> {
	const response = await agent.post("/queue/queues").type("form").send(fields);
	assert.equal(response.status, 303);
	return slugFrom(response.headers.location);
}

async function makeFreePlan(harness: TestHarness): Promise<void> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in test user must exist");
	await harness.subscriptionProviders.upsertActive({ userId: user.userId, subscriptionId: "sub_smart", customerId: "cus_smart" });
	await harness.subscriptionProviders.markCancelledByUserId({ userId: user.userId });
}

async function definitionOf(harness: TestHarness, slug: string) {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in test user must exist");
	const definitions = await harness.articleStore.listReadlistDefinitions(user.userId);
	return definitions.find((definition) => definition.slug === ReadlistSlugSchema.parse(slug));
}

async function setUp() {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const agent = await loginAgent(harness.server, harness.auth);
	return { harness, agent };
}

describe("creating a Smart Readlist", () => {
	it("creates a manual readlist from a name alone", async () => {
		const { harness, agent } = await setUp();
		const slug = await createReadlist(agent, { label: "Reading" });

		expect((await definitionOf(harness, slug))?.filing).toEqual({ mode: "manual" });
	});

	it("creates a smart readlist holding the purpose on a paid plan", async () => {
		const { harness, agent } = await setUp();
		const slug = await createReadlist(agent, { label: "Systems", smart: "1", purpose: PURPOSE });

		const definition = await definitionOf(harness, slug);
		expect(definition?.purpose).toBe(PURPOSE);
		expect(definition?.filing?.mode).toBe("smart");
	});

	it("sends a free-plan reader to the plans page and creates nothing", async () => {
		const { harness, agent } = await setUp();
		await makeFreePlan(harness);
		const response = await agent.post("/queue/queues").type("form").send({ label: "Systems", smart: "1", purpose: PURPOSE });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account/plans");
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the logged-in test user must exist");
		const definitions = await harness.articleStore.listReadlistDefinitions(user.userId);
		expect(definitions.some((definition) => definition.label === "Systems")).toBe(false);
	});

	it("refuses a smart readlist with no purpose and creates nothing", async () => {
		const { harness, agent } = await setUp();
		const response = await agent.post("/queue/queues").type("form").send({ label: "Systems", smart: "1", purpose: "  " });

		expect(response.status).toBe(303);
		expect(new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue_error")).toBe("create_invalid-purpose");
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the logged-in test user must exist");
		const definitions = await harness.articleStore.listReadlistDefinitions(user.userId);
		expect(definitions.some((definition) => definition.label === "Systems")).toBe(false);
	});

	it("re-renders the dialog with the smart option still checked when an htmx create is refused", async () => {
		const { agent } = await setUp();
		const response = await agent.post("/queue/queues").set("HX-Request", "true").type("form").send({ label: "Systems", smart: "1", purpose: "" });

		const doc = parse(response.text);
		const toggle = doc.querySelector<HTMLInputElement>('[data-test-field="smart"]');
		assert(toggle, "the refused form must keep the smart option");
		expect(toggle.checked).toBe(true);
		expect(doc.querySelector("[data-dialog-form-error]")?.textContent).toMatch(/Say what this readlist is for/);
	});

	it("offers the smart option in the nav create dialog, with its own commit label", async () => {
		const { agent } = await setUp();
		const doc = parse((await agent.get("/queue")).text);

		const form = doc.querySelector('[data-test-form="readlist-create"]');
		assert(form, "the nav must render the create dialog");
		expect(form.querySelector('[data-test-field="smart"]')).not.toBeNull();
		expect(form.querySelector('[data-test-field="smart-purpose"]')).not.toBeNull();
		expect(Array.from(form.querySelectorAll(".readlist-name-form__commit-label"), (label) => label.textContent)).toEqual([
			"Create readlist",
			"Create Smart Readlist",
		]);
	});
});

describe("Smart Readlist preferences", () => {
	it("offers a legacy readlist its destination controls and the convert section", async () => {
		const { agent } = await setUp();
		const slug = await createReadlist(agent, { label: "Reading" });
		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(doc.querySelector("[data-test-readlist-inboxes]")).not.toBeNull();
		expect(doc.querySelector('[data-test-smart-filing="manual"] [data-test-form="smart-convert"]')).not.toBeNull();
		expect(doc.querySelector('[data-test-form="smart-off"]')).toBeNull();
		expect(doc.querySelector("[data-test-filter-beta]")).not.toBeNull();
	});

	it("converts a readlist to smart with the purpose", async () => {
		const { harness, agent } = await setUp();
		const slug = await createReadlist(agent, { label: "Reading" });
		const response = await agent.post(`${preferencesPath(slug)}/smart`).type("form").send({ purpose: PURPOSE });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`${preferencesPath(slug)}?preferences_saved=1`);
		const definition = await definitionOf(harness, slug);
		expect(definition?.filing?.mode).toBe("smart");
		expect(definition?.purpose).toBe(PURPOSE);
	});

	it("shows a smart readlist its instructions, choices, turn-off and source links, and no destination controls", async () => {
		const { agent } = await setUp();
		const slug = await createReadlist(agent, { label: "Systems", smart: "1", purpose: PURPOSE });
		const doc = parse((await agent.get(preferencesPath(slug))).text);

		const section = doc.querySelector('[data-test-smart-filing="smart"]');
		assert(section, "a smart readlist must render its smart section");
		expect(section.querySelector('[data-test-form="smart-rule"] textarea')?.textContent).toBe(PURPOSE);
		expect(section.querySelector('[data-test-form="smart-off"]')).not.toBeNull();
		expect(new URL(section.querySelector('[data-test-smart-source="newsletters"]')?.getAttribute("href") ?? "", TEST_APP_ORIGIN).pathname).toBe("/inbox");
		expect(new URL(section.querySelector('[data-test-smart-source="gmail"]')?.getAttribute("href") ?? "", TEST_APP_ORIGIN).pathname).toBe("/newsletters/gmail");
		expect(section.querySelector("[data-test-smart-paused]")).toBeNull();
		expect(doc.querySelector("[data-test-readlist-inboxes]")).toBeNull();
		expect(doc.querySelector("[data-test-readlist-gmail-senders]")).toBeNull();
		expect(doc.querySelector("[data-test-filter-beta]")).not.toBeNull();
	});

	it("bumps the revision when the instructions change", async () => {
		const { harness, agent } = await setUp();
		const slug = await createReadlist(agent, { label: "Systems", smart: "1", purpose: PURPOSE });
		const before = (await definitionOf(harness, slug))?.filing;
		assert(before?.mode === "smart", "the readlist must start smart");

		await agent.post(`${preferencesPath(slug)}/smart`).type("form").send({ purpose: "Only consensus papers." });

		const after = await definitionOf(harness, slug);
		assert(after?.filing?.mode === "smart", "the readlist must stay smart");
		expect(after.filing.revision).toBeGreaterThan(before.revision);
		expect(after.purpose).toBe("Only consensus papers.");
	});

	it("refuses empty instructions and shows the error", async () => {
		const { agent } = await setUp();
		const slug = await createReadlist(agent, { label: "Systems", smart: "1", purpose: PURPOSE });
		const response = await agent.post(`${preferencesPath(slug)}/smart`).type("form").send({ purpose: " " });

		expect(response.headers.location).toBe(`${preferencesPath(slug)}?preferences_error=invalid-smart-purpose`);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(doc.querySelector("[data-test-smart-purpose-error]")?.textContent).toMatch(/Say what this readlist is for/);
	});

	it("sends a rule change for a readlist the reader does not own back to the readlists", async () => {
		const { agent } = await setUp();
		const response = await agent.post(`${preferencesPath("nobody")}/smart`).type("form").send({ purpose: PURPOSE });

		expect(new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue_error")).not.toBeNull();
	});

	it("turns smart matching off on a free plan and keeps the articles", async () => {
		const { harness, agent } = await setUp();
		const slug = await createReadlist(agent, { label: "Systems", smart: "1", purpose: PURPOSE });
		await seedInto(harness, { readlist: slug, url: "https://example.com/raft" });
		await makeFreePlan(harness);

		const paused = parse((await agent.get(preferencesPath(slug))).text);
		expect(paused.querySelector("[data-test-smart-paused]")).not.toBeNull();

		const response = await agent.post(`${preferencesPath(slug)}/smart/off`);
		expect(response.headers.location).toBe(`${preferencesPath(slug)}?preferences_saved=1`);
		expect((await definitionOf(harness, slug))?.filing).toEqual({ mode: "manual" });
		expect((await agent.get(`/queue?queue=${slug}`)).text).toContain("https://example.com/raft");
	});

	it("sends a turn-off for a readlist the reader does not own back to the readlists", async () => {
		const { agent } = await setUp();
		const response = await agent.post(`${preferencesPath("nobody")}/smart/off`);

		expect(new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue_error")).not.toBeNull();
	});
});

describe("Smart Readlist marks", () => {
	it("shows the sparkle, the Smart Readlist label and the accessible name for a smart readlist only", async () => {
		const { agent } = await setUp();
		const smart = await createReadlist(agent, { label: "Research", smart: "1", purpose: PURPOSE });
		const manual = await createReadlist(agent, { label: "Work" });
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/paxos" });
		const doc = parse((await agent.get(`/queue?queue=${smart}`)).text);

		const marked = Array.from(doc.querySelectorAll("[data-test-readlist-smart]"));
		expect(marked.length).toBeGreaterThan(0);
		expect(marked.every((element) => element.getAttribute("aria-label") === "Research, Smart Readlist")).toBe(true);
		expect(doc.querySelector("[data-test-readlist-smart-label]")?.textContent).toBe("Smart Readlist");
		expect(doc.querySelectorAll(".readlist-nav__smart svg").length).toBeGreaterThan(0);
		expect(doc.querySelector(`[aria-label="Work, Smart Readlist"]`)).toBeNull();
		expect(manual).not.toBe(smart);

		const all = parse((await agent.get("/queue")).text);
		const destination = all.querySelector(`[data-test-move-destination="${smart}"]`);
		assert(destination, "the move dialog must offer the smart readlist");
		expect(destination.querySelector(".readlist-row__smart svg")).not.toBeNull();
		expect(all.querySelector(`[data-test-move-destination="${manual}"] .readlist-row__smart`)).toBeNull();
	});

	it.each([
		["manual", { label: "Empty" }],
		["smart", { label: "Empty", smart: "1", purpose: PURPOSE }],
	])("keeps the empty-list Preferences action's Beta chip and the Preferences tab's Beta chip on a %s readlist", async (_mode, fields) => {
		const { agent } = await setUp();
		const slug = await createReadlist(agent, fields);
		const empty = parse((await agent.get(`/queue?queue=${slug}`)).text);
		const preferences = parse((await agent.get(preferencesPath(slug))).text);

		const betaActions = Array.from(empty.querySelectorAll(`a[href*="/preferences"]`)).filter((link) => link.textContent?.includes("Beta"));
		expect(betaActions).toHaveLength(1);
		expect(preferences.querySelector('[data-test-filter="preferences"] [data-test-filter-beta]')).not.toBeNull();
	});
});
