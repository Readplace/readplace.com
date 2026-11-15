import assert from "node:assert/strict";
import type { UserId } from "@packages/domain/user";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";

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
