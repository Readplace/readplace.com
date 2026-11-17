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

describe("pin and unpin on a read-only account", () => {
	it.each([
		["pin", pin],
		["unpin", unpin],
	])("refuses to %s and sends the reader to the inactive-subscription notice", async (_name, send) => {
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
		const before = await pinned();

		const response = await send(agent, slug);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
		expect(await pinned()).toEqual(before);
	});
});

describe("POST /queue/queues/:slug/unpin", () => {
	it.each([
		["the readlist every reader is given", "default"],
		["a readlist the reader does not own", "not-mine"],
		["a slug no readlist could carry", "Not A Slug"],
	])("sends an unpin of %s to the not-found alert", async (_name, slug) => {
		const { agent } = await setup();

		const response = await agent
			.post(`/queue/queues/${encodeURIComponent(slug)}/unpin`)
			.type("form")
			.send({});

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			"/queue?queue_error=unknown_readlist",
		);
	});
});

describe("the nav's Pin and Unpin menu items", () => {
	async function navOf(agent: TestAgent, path: string): Promise<Document> {
		const response = await agent.get(path);
		expect(response.status).toBe(200);
		return new JSDOM(response.text).window.document;
	}

	function railNames(doc: Document): string[] {
		return Array.from(
			doc.querySelectorAll("[data-test-readlist-rail] [data-test-readlist]"),
			(link) => String(link.getAttribute("data-test-readlist")),
		);
	}

	it("pins a readlist from its menu in More, moving it onto the rail with Unpin offered", async () => {
		const { agent } = await setup();
		for (const label of [
			"One",
			"Two",
			"Three",
			"Four",
			"Five",
			"Six",
			"Seven",
			"Eight",
		]) {
			await createReadlist(agent, label);
		}
		const before = await navOf(agent, "/queue");
		const last = before
			.querySelector(
				"[data-test-readlist-popover='more'] [data-test-readlist-more-entry]",
			)
			?.getAttribute("data-test-readlist-more-entry");
		assert(last, "the eighth readlist sits in More");
		const form = before.querySelector(
			`[data-test-readlist-popover="more"] [data-test-readlist-menu="${last}"] [data-test-form="readlist-pin"]`,
		);
		const action = form?.getAttribute("action");
		assert(action, "a readlist in More offers Pin in its menu");
		expect(form?.getAttribute("method")).toBe("POST");

		const response = await agent.post(action).type("form").send({});

		expect(response.status).toBe(303);
		const after = await navOf(agent, response.headers.location);
		expect(railNames(after)).toEqual([
			"default",
			last,
			...railNames(before).slice(1, 4),
		]);
		expect(
			after.querySelector(
				`[data-test-readlist-rail] [data-test-readlist-menu="${last}"] [data-test-form="readlist-unpin"]`,
			),
		).not.toBeNull();
	});
});
