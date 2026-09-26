import assert from "node:assert/strict";
import {
	AliasNameSchema,
	type InboxAddress,
	type InboxAddressPurpose,
} from "@packages/domain/inbox";
import { READLIST_PURPOSE_MAX_LENGTH, ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;
type TestFixture = ReturnType<typeof createDefaultTestAppFixture>;

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

async function readerId(harness: TestHarness): Promise<UserId> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in test user must exist");
	return user.userId;
}

async function mintInbox(
	fixture: TestFixture,
	input: { userId: UserId; name: string; purpose?: InboxAddressPurpose; readlist?: string },
): Promise<InboxAddress> {
	const { inboxAddressStore, inboxAddressDomain } = fixture.inboxAddress;
	const inbox = await inboxAddressStore.createAddress({
		userId: input.userId,
		domain: inboxAddressDomain,
		name: AliasNameSchema.parse(input.name),
		purpose: input.purpose ?? "user-alias",
	});
	if (input.readlist !== undefined) {
		await inboxAddressStore.setAddressReadlist({
			userId: input.userId,
			address: inbox.address,
			readlist: ReadlistSlugSchema.parse(input.readlist),
		});
	}
	return inbox.address;
}

async function routingOf(fixture: TestFixture, address: InboxAddress): Promise<string | undefined> {
	const inbox = await fixture.inboxAddress.inboxAddressStore.findByAddress(address);
	assert(inbox, `${address} must have been minted by the test`);
	return inbox.readlist;
}

function inboxesPath(slug: string): string {
	return `${preferencesPath(slug)}/inboxes`;
}

function routeInbox(agent: TestAgent, slug: string, body: { address?: string; destination?: string }) {
	return agent.post(inboxesPath(slug)).type("form").send(body);
}

function inboxesSection(doc: Document): Element {
	const section = doc.querySelector("[data-test-readlist-inboxes]");
	assert(section, "the preferences tab must render its inboxes section");
	return section;
}

function inboxRows(doc: Document) {
	return Array.from(doc.querySelectorAll("[data-test-preferences-inbox]"), (row) => ({
		name: row.querySelector("[data-test-inbox-name]")?.textContent,
		destination: row.querySelector("[data-test-inbox-destination]")?.textContent,
		button: row.querySelector("button")?.textContent,
	}));
}

function alertOf(doc: Document): { visible: boolean; title: string | undefined; body: string | undefined } {
	const alert = doc.querySelector("[data-test-readlist-error]");
	assert(alert, "the alert must render in every state");
	return {
		visible: alert.classList.contains("readlist__alert--visible"),
		title: alert.querySelector("[data-test-readlist-error-title]")?.textContent ?? undefined,
		body: alert.querySelector(".readlist__alert-body")?.textContent ?? undefined,
	};
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

describe("GET /queue/queues/:slug/preferences inboxes", () => {
	it("lists the reader's inboxes under the purpose panel, saying where each one goes", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const other = await createReadlist(agent);
		const userId = await readerId(harness);
		await mintInbox(fixture, { userId, name: "news", readlist: slug });
		await mintInbox(fixture, { userId, name: "tech", readlist: other });
		await mintInbox(fixture, { userId, name: "deals" });
		await mintInbox(fixture, { userId, name: "old", readlist: "c9d0e1f2" });

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(inboxRows(doc)).toEqual([
			{ name: "deals", destination: "Goes to All", button: "Send here" },
			{ name: "news", destination: "Goes to New Readlist", button: "Send to All" },
			{ name: "old", destination: "Goes to All", button: "Send here" },
			{ name: "tech", destination: "Goes to New Readlist 2", button: "Send here" },
		]);
	});

	it("leaves out the Gmail gateway, turned-off inboxes and other readers' inboxes", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const userId = await readerId(harness);
		await mintInbox(fixture, { userId, name: "gmail", purpose: "gmail-forwarding" });
		const paused = await mintInbox(fixture, { userId, name: "paused" });
		await fixture.inboxAddress.inboxAddressStore.disableAddress({ userId, address: paused });
		await mintInbox(fixture, { userId: UserIdSchema.parse("someone-else"), name: "theirs" });
		await mintInbox(fixture, { userId, name: "tldr", purpose: "gmail-mapped" });

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(inboxRows(doc).map((row) => row.name)).toEqual(["tldr"]);
	});

	it("offers to create an inbox when the reader has none to route", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(inboxesSection(doc).getAttribute("data-test-inboxes-state")).toBe("empty");
		expect(doc.querySelector('[data-test-action="create-inbox"]')?.getAttribute("href")).toBe(
			"/inbox/addresses?utm_source=queue-preferences&utm_medium=internal&utm_content=create-inbox",
		);
	});

	it("tells the reader only the links that fit are kept once the readlist has a purpose", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		await savePurpose(agent, slug, PURPOSE);

		const doc = parse((await agent.get(preferencesPath(slug))).text);

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Newsletters sent to these inboxes are saved to New Readlist instead of All, keeping only the links that fit its purpose.",
		);
	});

	it("keeps the purpose wizard closed while an inbox refusal shows", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse(
			(await agent.get(`${preferencesPath(slug)}?preferences_error=unknown-inbox`)).text,
		);

		expect(panel(doc).className).toBe(
			"readlist-listing readlist-preferences readlist-preferences--unset",
		);
		expect(alertOf(doc).visible).toBe(true);
	});
});

describe("POST /queue/queues/:slug/preferences/inboxes", () => {
	it("routes an inbox to the readlist and lands back on the tab showing it goes there", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const address = await mintInbox(fixture, { userId: await readerId(harness), name: "news" });

		const response = await routeInbox(agent, slug, { address, destination: slug });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(preferencesPath(slug));
		expect(await routingOf(fixture, address)).toBe(slug);
		expect(inboxRows(parse((await agent.get(response.headers.location)).text))).toEqual([
			{ name: "news", destination: "Goes to New Readlist", button: "Send to All" },
		]);
	});

	it("brings an inbox over from another readlist", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const other = await createReadlist(agent);
		const address = await mintInbox(fixture, {
			userId: await readerId(harness),
			name: "news",
			readlist: other,
		});

		await routeInbox(agent, slug, { address, destination: slug });

		expect(await routingOf(fixture, address)).toBe(slug);
	});

	it("sends an inbox back to All", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const address = await mintInbox(fixture, {
			userId: await readerId(harness),
			name: "news",
			readlist: slug,
		});

		const response = await routeInbox(agent, slug, { address, destination: "default" });

		expect(response.headers.location).toBe(preferencesPath(slug));
		expect(await routingOf(fixture, address)).toBeUndefined();
		expect(inboxRows(parse((await agent.get(response.headers.location)).text))).toEqual([
			{ name: "news", destination: "Goes to All", button: "Send here" },
		]);
	});

	it("routes an inbox through the form its row renders", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const address = await mintInbox(fixture, { userId: await readerId(harness), name: "news" });
		const doc = parse((await agent.get(withPreferencesFeature(preferencesPath(slug)))).text);
		const form = doc.querySelector(`[data-test-preferences-inbox="${address}"] form`);
		assert(form, "the inbox's row must carry its routing form");
		const action = form.getAttribute("action");
		assert(action, "the routing form must post somewhere");

		const response = await agent
			.post(action)
			.type("form")
			.send(
				Object.fromEntries(
					Array.from(form.querySelectorAll("input"), (input) => [
						input.getAttribute("name"),
						input.getAttribute("value"),
					]),
				),
			);

		expect(response.headers.location).toBe(withPreferencesFeature(preferencesPath(slug)));
		expect(await routingOf(fixture, address)).toBe(slug);
	});

	const UNAVAILABLE_INBOXES: [
		string,
		(fixture: TestFixture, userId: UserId) => Promise<string>,
	][] = [
		["an inbox no reader has", async () => "ghost-a1b2c3@read.place"],
		[
			"another reader's inbox",
			(fixture) => mintInbox(fixture, { userId: UserIdSchema.parse("someone-else"), name: "theirs" }),
		],
		[
			"a turned-off inbox",
			async (fixture, userId) => {
				const address = await mintInbox(fixture, { userId, name: "paused" });
				await fixture.inboxAddress.inboxAddressStore.disableAddress({ userId, address });
				return address;
			},
		],
		[
			"the Gmail gateway",
			(fixture, userId) => mintInbox(fixture, { userId, name: "gmail", purpose: "gmail-forwarding" }),
		],
		["something that is not an inbox address", async () => "not an address"],
	];

	it.each(UNAVAILABLE_INBOXES)("refuses %s, saying the inbox isn't available", async (_case, unavailable) => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const address = await unavailable(fixture, await readerId(harness));

		const response = await routeInbox(agent, slug, { address, destination: slug });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`${preferencesPath(slug)}?preferences_error=unknown-inbox`,
		);
		expect(alertOf(parse((await agent.get(response.headers.location)).text))).toEqual({
			visible: true,
			title: "That inbox isn't available",
			body: "It may have been turned off. Pick another inbox.",
		});
	});

	it("leaves another reader's inbox where it goes", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const theirs = await mintInbox(fixture, {
			userId: UserIdSchema.parse("someone-else"),
			name: "theirs",
		});

		await routeInbox(agent, slug, { address: theirs, destination: slug });

		expect(await routingOf(fixture, theirs)).toBeUndefined();
	});

	it("refuses to send an inbox anywhere but this readlist or All", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const other = await createReadlist(agent);
		const address = await mintInbox(fixture, { userId: await readerId(harness), name: "news" });

		const response = await routeInbox(agent, slug, { address, destination: other });

		expect(response.headers.location).toBe(
			`${preferencesPath(slug)}?preferences_error=unknown-inbox`,
		);
		expect(await routingOf(fixture, address)).toBeUndefined();
	});

	it("refuses a submit that names no inbox at all", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent.post(inboxesPath(slug));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`${preferencesPath(slug)}?preferences_error=unknown-inbox`,
		);
	});

	it("keeps the feature on the redirect, so the routed inbox lands on a page that still has the tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const address = await mintInbox(fixture, { userId: await readerId(harness), name: "news" });

		const response = await agent
			.post(withPreferencesFeature(inboxesPath(slug)))
			.type("form")
			.send({ address, destination: slug });

		expect(response.headers.location).toBe(withPreferencesFeature(preferencesPath(slug)));
		expect(filterTabs(parse((await agent.get(response.headers.location)).text))).toEqual([
			"unread",
			"read",
			"preferences",
		]);
	});

	it("keeps the feature on a refusal", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(withPreferencesFeature(inboxesPath(slug)))
			.type("form")
			.send({ address: "ghost-a1b2c3@read.place", destination: slug });

		expect(response.headers.location).toBe(
			`${preferencesPath(slug)}?preferences_error=unknown-inbox&feature=pref`,
		);
	});

	it("refuses to route an inbox to the built-in readlist, which every newsletter already reaches", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const address = await mintInbox(fixture, { userId: await readerId(harness), name: "news" });

		const response = await routeInbox(agent, "default", { address, destination: "default" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("refuses a readlist the reader does not have", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const address = await mintInbox(fixture, { userId: await readerId(harness), name: "news" });

		const response = await routeInbox(agent, "a1b2c3d4", { address, destination: "a1b2c3d4" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
		expect(await routingOf(fixture, address)).toBeUndefined();
	});

	it("refuses a malformed readlist id", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await routeInbox(agent, "Not A Slug", {
			address: "news-a1b2c3@read.place",
			destination: "default",
		});

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
	});

	it("turns a read-only reader away from routing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);
		const address = await mintInbox(fixture, { userId: await readerId(harness), name: "news" });
		await makeReadOnly(harness);

		const response = await routeInbox(agent, slug, { address, destination: slug });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
		expect(await routingOf(fixture, address)).toBeUndefined();
	});

	it("asks a signed-out visitor to log in rather than routing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post(inboxesPath("a1b2c3d4"))
			.type("form")
			.send({ address: "news-a1b2c3@read.place", destination: "a1b2c3d4" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toContain("/login");
	});
});
