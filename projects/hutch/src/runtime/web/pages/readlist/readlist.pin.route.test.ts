import assert from "node:assert/strict";
import type { UserId } from "@packages/domain/user";
import {
	TEST_APP_ORIGIN,
	type TestAppFixture,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

async function createReadlist(
	agent: TestAgent,
	label: string,
): Promise<string> {
	const response = await agent
		.post("/queue/queues")
		.type("form")
		.send({ label });
	const slug = new URL(
		response.headers.location,
		TEST_APP_ORIGIN,
	).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

function pin(agent: TestAgent, slug: string) {
	return agent
		.post(`/queue/queues/${slug}/pin?queue=${slug}`)
		.type("form")
		.send({});
}

function unpin(agent: TestAgent, slug: string) {
	return agent
		.post(`/queue/queues/${slug}/unpin?queue=${slug}`)
		.type("form")
		.send({});
}

async function setup(
	now: () => Date = () => new Date("2026-11-01T09:00:00.000Z"),
) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const readers: UserId[] = [];
	const harness = useApp({
		...fixture,
		shared: { ...fixture.shared, now },
		articleStore: {
			...fixture.articleStore,
			listReadlistDefinitions: async (userId) => {
				readers.push(userId);
				return fixture.articleStore.listReadlistDefinitions(userId);
			},
		},
	});
	const agent = await loginAgent(harness.server, harness.auth);
	const pinned = async () => {
		const [userId] = readers;
		assert(userId, "the reader's readlists must have been read by a request");
		const definitions =
			await fixture.articleStore.listReadlistDefinitions(userId);
		return definitions.flatMap((definition) =>
			definition.pinnedAt === undefined
				? []
				: [[definition.slug, definition.pinnedAt.toISOString()]],
		);
	};
	return { agent, pinned, harness };
}

describe("POST /queue/queues/:slug/pin", () => {
	it("pins the readlist at the clock's time and lands the reader back where they were", async () => {
		const { agent, pinned } = await setup();
		const slug = await createReadlist(agent, "Work");

		const response = await pin(agent, slug);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue?queue=${slug}`);
		expect(await pinned()).toEqual([[slug, "2026-11-01T09:00:00.000Z"]]);
	});

	it("keeps the first pin time when the reader pins the same readlist again", async () => {
		let clock = new Date("2026-11-01T09:00:00.000Z");
		const { agent, pinned } = await setup(() => clock);
		const slug = await createReadlist(agent, "Work");
		await pin(agent, slug);
		clock = new Date("2026-11-02T09:00:00.000Z");

		await pin(agent, slug);

		expect(await pinned()).toEqual([[slug, "2026-11-01T09:00:00.000Z"]]);
	});

	it("refuses a fifth pin with the pin-limit alert and leaves the pins alone", async () => {
		const { agent, pinned } = await setup();
		const slugs: string[] = [];
		for (const label of ["One", "Two", "Three", "Four", "Five"])
			slugs.push(await createReadlist(agent, label));
		for (const slug of slugs.slice(0, 4)) await pin(agent, slug);
		const fifth = slugs[4];
		assert(fifth);

		const response = await pin(agent, fifth);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/queue?queue=${fifth}&queue_error=pin_limit`,
		);
		expect((await pinned()).map(([slug]) => slug).sort()).toEqual(
			slugs.slice(0, 4).sort(),
		);
		const page = new JSDOM((await agent.get(response.headers.location)).text)
			.window.document;
		const alert = page.querySelector('[data-test-alert="readlist"]');
		assert(alert, "the readlist alert box must be rendered");
		expect(alert.classList.contains("alert--visible")).toBe(true);
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
			t("readlistNav.pin.alerts.limit.title"),
		);
	});

	it("frees a slot once the reader unpins a readlist", async () => {
		const { agent, pinned } = await setup();
		const slugs: string[] = [];
		for (const label of ["One", "Two", "Three", "Four", "Five"])
			slugs.push(await createReadlist(agent, label));
		for (const slug of slugs.slice(0, 4)) await pin(agent, slug);
		const [first, , , , fifth] = slugs;
		assert(first && fifth);

		const unpinResponse = await unpin(agent, first);
		const pinResponse = await pin(agent, fifth);

		expect(unpinResponse.headers.location).toBe(`/queue?queue=${first}`);
		expect(pinResponse.headers.location).toBe(`/queue?queue=${fifth}`);
		expect((await pinned()).map(([slug]) => slug).sort()).toEqual(
			slugs.slice(1).sort(),
		);
	});

	it.each([
		["the readlist every reader is given", "default"],
		["a readlist the reader does not own", "not-mine"],
		["a slug no readlist could carry", "Not A Slug"],
	])("sends a pin of %s to the not-found alert", async (_name, slug) => {
		const { agent } = await setup();

		const response = await agent
			.post(`/queue/queues/${encodeURIComponent(slug)}/pin`)
			.type("form")
			.send({});

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			"/queue?queue_error=unknown_readlist",
		);
	});

	it("sends the pin to the not-found alert when the readlist disappears before the write", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				pinReadlistDefinition: async () => ({ pinned: false }),
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent, "Work");

		const response = await pin(agent, slug);

		expect(response.headers.location).toBe(
			"/queue?queue_error=unknown_readlist",
		);
	});
});

describe("pin and unpin on a free-plan account", () => {
	it("lets the reader unpin and pin again, since readlists are core", async () => {
		const { agent, pinned, harness } = await setup();
		const slug = await createReadlist(agent, "Work");
		await pin(agent, slug);
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the logged-in user must exist");
		await harness.subscriptionProviders.upsertActive({
			userId: user.userId,
			subscriptionId: "sub_ro",
			customerId: "cus_ro",
		});
		await harness.subscriptionProviders.markCancelledByUserId({
			userId: user.userId,
		});

		const unpinned = await unpin(agent, slug);
		const afterUnpin = (await pinned()).map(([pinnedSlug]) => pinnedSlug);
		const repinned = await pin(agent, slug);

		expect([unpinned.status, repinned.status]).toEqual([303, 303]);
		expect(afterUnpin).toEqual([]);
		expect((await pinned()).map(([pinnedSlug]) => pinnedSlug)).toEqual([slug]);
	});
});

describe("pin and unpin over Siren", () => {
	interface Action {
		name: string;
		href: string;
		method: string;
	}

	async function sirenClient(
		withFixture: (fixture: TestAppFixture) => TestAppFixture = (fixture) => fixture,
	) {
		const harness = useApp(withFixture(createDefaultTestAppFixture(TEST_APP_ORIGIN)));
		const token = await createAccessToken(harness);
		const siren = (call: request.Test) =>
			call.set("Accept", SIREN_MEDIA_TYPE).set("Authorization", `Bearer ${token}`).redirects(0);
		const get = (href: string) => siren(request(harness.server).get(href));
		const submit = (action: Action) => siren(request(harness.server).post(action.href)).type("form").send({});
		const createReadlistHref = async (label: string): Promise<string> => {
			const created = await siren(request(harness.server).post("/queue/queues")).type("form").send({ label });
			assert.equal(created.status, 303);
			return created.headers.location;
		};
		const actionOn = async (href: string, name: string): Promise<Action> => {
			const collection = await get(href);
			const action = collection.body.actions.find((candidate: Action) => candidate.name === name);
			assert(action, `the collection at ${href} must advertise ${name}`);
			return action;
		};
		return { get, submit, createReadlistHref, actionOn };
	}

	it("follows pin-readlist and unpin-readlist from the collection and reads the pin state back", async () => {
		const client = await sirenClient();
		const href = await client.createReadlistHref("Work");

		const pinned = await client.submit(await client.actionOn(href, "pin-readlist"));
		const afterPin = await client.get(pinned.headers.location);
		const unpinned = await client.submit(await client.actionOn(pinned.headers.location, "unpin-readlist"));
		const afterUnpin = await client.get(unpinned.headers.location);

		expect([pinned.status, pinned.headers.location]).toEqual([303, href]);
		expect(afterPin.body.properties.readlists).toEqual([
			expect.objectContaining({ label: "All", pinned: false }),
			expect.objectContaining({ label: "Work", rel: "current", pinned: true }),
		]);
		expect(
			afterPin.body.actions
				.map((action: Action) => action.name)
				.filter((name: string) => name.endsWith("pin-readlist")),
		).toEqual(["unpin-readlist"]);
		expect([unpinned.status, unpinned.headers.location]).toEqual([303, href]);
		expect(afterUnpin.body.properties.readlists).toEqual([
			expect.objectContaining({ label: "All", pinned: false }),
			expect.objectContaining({ label: "Work", rel: "current", pinned: false }),
		]);
	});

	it("refuses a fifth pin with pin-limit-reached and leaves the readlist unpinned", async () => {
		const client = await sirenClient();
		const hrefs: string[] = [];
		for (const label of ["One", "Two", "Three", "Four", "Five"]) hrefs.push(await client.createReadlistHref(label));
		const fifth = hrefs[4];
		assert(fifth);
		const fifthPin = await client.actionOn(fifth, "pin-readlist");
		for (const href of hrefs.slice(0, 4)) await client.submit(await client.actionOn(href, "pin-readlist"));

		const response = await client.submit(fifthPin);

		expect(response.status).toBe(422);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body).toEqual({
			class: ["error"],
			properties: { code: "pin-limit-reached", message: t("readlistNav.pin.alerts.limit.body", { max: 4 }) },
		});
		expect((await client.get(fifth)).body.properties.readlists).toContainEqual(
			expect.objectContaining({ rel: "current", pinned: false }),
		);
	});

	it.each([
		["pin", "a readlist the reader does not own", "/queue/queues/not-mine/pin"],
		["pin", "a slug no readlist could carry", `/queue/queues/${encodeURIComponent("Not A Slug")}/pin`],
		["pin", "the readlist every reader is given", "/queue/queues/default/pin"],
		["unpin", "a readlist the reader does not own", "/queue/queues/not-mine/unpin"],
		["unpin", "the readlist every reader is given", "/queue/queues/default/unpin"],
	])("refuses a %s of %s with unknown-readlist", async (_verb, _name, href) => {
		const client = await sirenClient();

		const response = await client.submit({ name: "toggle", href, method: "POST" });

		expect(response.status).toBe(404);
		expect(response.body.properties.code).toBe("unknown-readlist");
	});

	it("refuses with unknown-readlist when the readlist disappears before the pin is written", async () => {
		const client = await sirenClient((fixture) => ({
			...fixture,
			articleStore: { ...fixture.articleStore, pinReadlistDefinition: async () => ({ pinned: false }) },
		}));
		const href = await client.createReadlistHref("Work");

		const response = await client.submit(await client.actionOn(href, "pin-readlist"));

		expect(response.status).toBe(404);
		expect(response.body.properties.code).toBe("unknown-readlist");
	});
});
