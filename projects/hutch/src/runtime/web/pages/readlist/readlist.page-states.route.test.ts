import assert from "node:assert/strict";
import { saveableUrlErrorMessage } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";
import { READLIST_PAGE_SIZE } from "./readlist-page-size";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function save(agent: TestAgent, url: string): Promise<void> {
	await agent.post("/queue/save").type("form").send({ url });
}

async function saveMany(agent: TestAgent, count: number, prefix: string): Promise<void> {
	for (let i = 0; i < count; i++) {
		await save(agent, `${prefix}${i}`);
	}
}

async function firstArticleId(agent: TestAgent, path = "/queue"): Promise<string> {
	const doc = parse((await agent.get(path)).text);
	const id = doc
		.querySelector("[data-test-article-list] .readlist-article, [data-test-article-list] .readlist-article")
		?.getAttribute("data-test-article");
	assert(id, "a saved article must render with an id");
	return id;
}

async function loggedInUserId(harness: TestHarness): Promise<UserId> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in test user must exist");
	return user.userId;
}

async function createReadlist(agent: TestAgent): Promise<string> {
	const response = await agent.post("/queue/queues");
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

describe("GET /queue", () => {
	it("renders the readlist page in the account's appearance", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await loggedInUserId(harness);
		await harness.auth.setUserAppearance({ userId, appearance: "dark" });

		const doc = parse((await agent.get("/queue")).text);

		const main = doc.querySelector("main");
		assert(main, "the design page must render a <main>");
		expect(main.className).toBe("readlist");
		expect(main.hasAttribute("data-test-readlist-page")).toBe(true);
		expect(doc.body.classList.contains("page-readlist")).toBe(true);
		expect(doc.body.classList.contains("page-readlist")).toBe(true);
		expect(doc.body.classList.contains("theme-dark")).toBe(true);
	});
});

describe("GET /queue/counts", () => {
	it("names the saved total, the page position and the numbered pages", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/a");
		await save(agent, "https://example.com/b");

		const doc = parse((await agent.get("/queue/counts")).text);

		const count = doc.getElementById("readlist-count");
		assert(count, "the design count span must be rendered");
		expect(count.textContent).toBe("2 Saved Articles");

		const info = doc.getElementById("readlist-pagination-info");
		assert(info, "the design pagination-info span must be rendered");
		expect(info.textContent).toBe("Showing 2 of 2");

		const pages = doc.getElementById("readlist-pages");
		assert(pages, "the design pages list must be rendered");
		expect(pages.querySelectorAll("[data-test-pagination-page]").length).toBeGreaterThan(0);
	});

	it("counts the whole tab, not just the page in front of the reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/old-");

		const doc = parse((await agent.get("/queue/counts")).text);

		const info = doc.querySelector("[data-test-pagination-info]");
		assert(info, "the counts fragment must carry the pagination info across pages");
		expect(info.textContent).toBe(`Showing ${READLIST_PAGE_SIZE} of ${READLIST_PAGE_SIZE + 1}`);
	});
});

describe("GET /queue/:id/card", () => {
	it("answers the card the listing renders, addressed by the article it re-fetched", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");
		const id = await firstArticleId(agent);

		const doc = parse((await agent.get(`/queue/${id}/card`)).text);

		const card = doc.querySelector("[data-test-article]");
		assert(card, "the card must be rendered");
		expect(card.classList.contains("readlist-article")).toBe(true);
		expect(card.getAttribute("data-test-article")).toBe(id);
	});
});

describe("htmx card status swap", () => {
	it("returns a mutation fragment carrying the counts trigger and the toast's Undo", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveMany(agent, 2, "https://example.com/card-swap-");
		const id = await firstArticleId(agent);

		const response = await agent
			.post(`/queue/${id}/status?swap=card`)
			.set("HX-Request", "true")
			.type("form")
			.send({ status: "read" });

		expect(response.status).toBe(200);
		const doc = parse(response.text);

		const counts = doc.getElementById("readlist-counts");
		assert(counts, "the out-of-band counts trigger must be rendered");
		expect(counts.getAttribute("hx-get")).toBe("/queue/counts");

		const undoForm = doc.querySelector("[data-test-toast-action]")?.closest("form");
		assert(undoForm, "the toast's Undo action must be rendered");
		expect(undoForm.getAttribute("action")).toBe(
			`/queue/${id}/status?utm_source=queue-toast&utm_medium=internal&utm_content=undo`,
		);
	});
});

describe("the alert box", () => {
	it("shows visible with the reached-limit title when queue_error=limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get("/queue?queue_error=limit")).text);

		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert box must always be rendered");
		expect(alert.classList.contains("readlist__alert--visible")).toBe(true);
		const title = doc.querySelector("[data-test-readlist-error-title]");
		assert(title, "the alert title must be rendered");
		expect(title.textContent).toBe("Readlist limit reached");
	});

	it("stays hidden without queue_error", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get("/queue")).text);

		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert box must always be rendered");
		expect(alert.classList.contains("readlist__alert--hidden")).toBe(true);
	});
});

describe("empty states", () => {
	it("welcomes a fresh user with the install action", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get("/queue")).text);

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the empty state must be rendered for a fresh user");
		const title = empty.querySelector(".readlist-empty__title");
		assert(title, "the empty state title must be rendered");
		expect(title.textContent).toBe("Nothing saved yet");
		const install = doc.querySelector('[data-test-empty-action="install"]');
		assert(install, "the install empty action must be rendered");
	});

	it("keeps one-tap saving in reach of a caught-up reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");
		const id = await firstArticleId(agent);
		await agent.post(`/queue/${id}/status`).type("form").send({ status: "read" });

		const doc = parse((await agent.get("/queue")).text);

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the caught-up empty state must be rendered");
		const title = empty.querySelector(".readlist-empty__title");
		assert(title, "the empty state title must be rendered");
		expect(title.textContent).toBe("You're all caught up");
		expect(
			Array.from(empty.querySelectorAll("[data-test-empty-action]"), (action) =>
				action.getAttribute("data-test-empty-action"),
			),
		).toEqual(["install"]);
	});

	it("offers a view-unread action on the Read tab of a reader with only unread saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");

		const doc = parse((await agent.get("/queue?tab=done")).text);

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the no-finished-articles empty state must be rendered");
		const title = empty.querySelector(".readlist-empty__title");
		assert(title, "the empty state title must be rendered");
		expect(title.textContent).toBe("No finished articles yet");
		const viewUnread = doc.querySelector('[data-test-empty-action="view-unread"]');
		assert(viewUnread, "the view-unread action must be rendered");
		expect(viewUnread.getAttribute("href")).toBe(
			"/queue?utm_source=queue-empty&utm_medium=internal&utm_content=view-unread",
		);
		expect(
			Array.from(empty.querySelectorAll("[data-test-empty-action]"), (action) =>
				action.getAttribute("data-test-empty-action"),
			),
		).toEqual(["view-unread", "install"]);
	});

	it("points a new custom readlist's empty state at the default readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(`/queue?queue=${slug}`)).text);

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the custom-readlist empty state must be rendered");
		const title = empty.querySelector(".readlist-empty__title");
		assert(title, "the empty state title must be rendered");
		expect(title.textContent).toBe("No articles in this readlist yet");
		const openDefault = doc.querySelector('[data-test-empty-action="open-default"]');
		assert(openDefault, "the open-default empty action must be rendered");
	});
});

describe("the subscription card", () => {
	const ONE_DAY_MS = 86_400_000;

	it("shows the trial-countdown state with three tiles for a trialing user", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await loggedInUserId(harness);
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		const doc = parse((await agent.get("/queue")).text);

		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "the subscription card must always be rendered");
		expect(banner.classList.contains("readlist-subscription--trial-countdown")).toBe(true);
		expect(doc.querySelectorAll("[data-test-trial-tile]").length).toBe(3);
	});

	it("shows the cancellation-scheduled state with a Reactivate link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await loggedInUserId(harness);
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pc",
			customerId: "cus_pc",
		});
		await harness.subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const doc = parse((await agent.get("/queue")).text);

		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "the subscription card must always be rendered");
		expect(banner.classList.contains("readlist-subscription--cancellation-scheduled")).toBe(
			true,
		);
		const reactivate = banner.querySelector('[data-test-action="reactivate"]');
		assert(reactivate, "the Reactivate link must be rendered");
		expect(reactivate.textContent).toBe("Reactivate Subscription");
	});

	it("shows the inactive state and disables the save input for a cancelled user", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await loggedInUserId(harness);
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_cancelled",
			customerId: "cus_cancelled",
		});
		await harness.subscriptionProviders.markCancelledByUserId({ userId });

		const doc = parse((await agent.get("/queue")).text);

		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "the subscription card must always be rendered");
		expect(banner.classList.contains("readlist-subscription--inactive")).toBe(true);
		const input = doc.querySelector('[data-test-form="save-article"] input[name="url"]');
		assert(input, "the save input must always be rendered");
		expect(input.hasAttribute("disabled")).toBe(true);
	});

	it("shows the none state for a founding member with no subscription row", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get("/queue")).text);

		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "the subscription card must always be rendered");
		expect(banner.classList.contains("readlist-subscription--none")).toBe(true);
	});
});

describe("custom readlist chrome", () => {
	it("offers rename and delete from the rail menu, each with its own confirm popover", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent);

		const doc = parse((await agent.get("/queue")).text);

		const menu = doc.querySelector("[data-test-readlist-menu]");
		assert(menu, "the created readlist must render a rail menu");
		const rename = menu.querySelector('[data-test-action="readlist-rename"]');
		assert(rename, "the rail menu must offer rename");
		const remove = menu.querySelector('[data-test-action="readlist-delete"]');
		assert(remove, "the rail menu must offer delete");

		const renamePopover = doc.querySelector('[data-test-confirm-popover="readlist-rename"]');
		assert(renamePopover, "the rename confirm popover must be rendered");

		const deletePopover = doc.querySelector('[data-test-confirm-popover="readlist-delete"]');
		assert(deletePopover, "the delete confirm popover must be rendered");
		expect(deletePopover.classList.contains("confirm-popover--illustrated")).toBe(true);
	});

	it("renames from the modal without JavaScript: an HTML form post lands back on the renamed readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(`/queue/queues/${slug}/rename`)
			.set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
			.type("form")
			.send({ label: "Ideas & Inspiration" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue?queue=${slug}`);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(doc.querySelector(`[data-test-readlist="${slug}"]`)?.textContent?.trim()).toBe("Ideas & Inspiration");
	});

	it("explains a refused no-JavaScript rename in the alert box instead of answering JSON", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(`/queue/queues/${slug}/rename`)
			.set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
			.type("form")
			.send({ label: "" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue?queue=${slug}&queue_error=rename_invalid-name`);
		const doc = parse((await agent.get(response.headers.location)).text);
		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert box must be rendered");
		expect(alert.classList.contains("readlist__alert--visible")).toBe(true);
		expect(alert.querySelector("[data-test-readlist-error-title]")?.textContent).toBe("Couldn't rename the readlist");
	});

	it("keeps answering JSON to the in-page rename client, which asks for it explicitly", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(`/queue/queues/${slug}/rename`)
			.set("Accept", "application/json")
			.type("form")
			.send({ label: "Finance" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ slug, label: "Finance" });
	});
});

describe("the save error", () => {
	it("renders the save error and marks the input invalid", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse(
			(await agent.get("/queue?error_code=malformed_url")).text,
		);

		const error = doc.querySelector("[data-test-save-error]");
		assert(error, "the save error must be rendered");
		expect(error.textContent).toBe(saveableUrlErrorMessage("malformed_url"));

		const input = doc.querySelector('[data-test-form="save-article"] input[name="url"]');
		assert(input, "the save input must always be rendered");
		expect(input.classList.contains("readlist-save__input--invalid")).toBe(true);
	});
});
