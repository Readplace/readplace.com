import assert from "node:assert/strict";
import { saveableUrlErrorMessage } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";
import { withDesignFeature } from "./design/readlist-design-feature";
import { READLIST_PAGE_SIZE } from "./readlist-page-size";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;

const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

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
		.querySelector("[data-test-article-list] .readlist-article, [data-test-article-list] .readlist-design-card")
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
	const response = await agent.post(withDesignFeature("/queue/queues"));
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

describe("GET /queue without the design flag", () => {
	it("keeps rendering the existing page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get("/queue")).text);

		const main = doc.querySelector("main");
		assert(main, "the readlist page must render a <main>");
		expect(main.className).toBe("readlist");
		expect(doc.body.classList.contains("page-readlist-design")).toBe(false);
	});
});

describe("GET /queue?feature=design", () => {
	it("renders the design page in the account's appearance", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await loggedInUserId(harness);
		await harness.auth.setUserAppearance({ userId, appearance: "dark" });

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const main = doc.querySelector("main");
		assert(main, "the design page must render a <main>");
		expect(main.className).toBe("readlist-design");
		expect(main.hasAttribute("data-test-readlist-design")).toBe(true);
		expect(doc.body.classList.contains("page-readlist")).toBe(true);
		expect(doc.body.classList.contains("page-readlist-design")).toBe(true);
		expect(doc.body.classList.contains("theme-dark")).toBe(true);
	});
});

describe("every same-page link carries feature=design", () => {
	it("carries it on the rail, the tabs, the sort link, the counts trigger, the save form and the new-readlist form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent);
		await save(agent, "https://example.com/article");

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const railHrefs = Array.from(doc.querySelectorAll("[data-test-readlist]"), (el) =>
			el.getAttribute("href"),
		);
		expect(railHrefs.length).toBeGreaterThan(0);
		expect(railHrefs.every((href) => href?.includes("feature=design"))).toBe(true);

		const tabHrefs = Array.from(doc.querySelectorAll("[data-test-filter]"), (el) =>
			el.getAttribute("href"),
		);
		expect(tabHrefs.length).toBeGreaterThan(0);
		expect(tabHrefs.every((href) => href?.includes("feature=design"))).toBe(true);

		const sort = doc.querySelector("[data-test-sort]");
		assert(sort, "the sort link must be rendered");
		expect(sort.getAttribute("href")).toContain("feature=design");

		const counts = doc.getElementById("readlist-counts");
		assert(counts, "the counts trigger must be rendered");
		expect(counts.getAttribute("hx-get")).toContain("feature=design");

		const saveForm = doc.querySelector('[data-test-form="save-article"]');
		assert(saveForm, "the save form must be rendered");
		expect(saveForm.getAttribute("action")).toContain("feature=design");

		const newReadlist = doc.querySelector('[data-test-action="new-readlist"]');
		assert(newReadlist, "the new-readlist button must be rendered");
		const newReadlistForm = newReadlist.closest("form");
		assert(newReadlistForm, "the new-readlist button must sit inside a form");
		expect(newReadlistForm.getAttribute("action")).toContain("feature=design");
	});

	it("carries it on the card's status form action and its poll URL while pending", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/pending");

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const card = doc.querySelector("[data-test-article-list] [data-test-article]");
		assert(card, "the saved article must render as a design card");
		expect(card.getAttribute("data-card-status")).toBe("pending");
		expect(card.getAttribute("hx-get")).toContain("feature=design");

		const markRead = card.querySelector('[data-test-action="mark-read"]');
		assert(markRead, "the mark-read action must be rendered");
		const statusForm = markRead.closest("form");
		assert(statusForm, "mark-read must sit inside a form");
		expect(statusForm.getAttribute("action")).toContain("feature=design");
	});

	it("carries it on the pagination prev/next links and on the counts fragment's page links", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/page-");

		const doc = parse((await agent.get(withDesignFeature("/queue?page=2"))).text);
		const prev = doc.querySelector("[data-test-pagination-prev]");
		assert(prev, "the previous-page link must be rendered on page 2");
		expect(prev.getAttribute("href")).toContain("feature=design");

		const firstPageDoc = parse((await agent.get(withDesignFeature("/queue"))).text);
		const next = firstPageDoc.querySelector("[data-test-pagination-next]");
		assert(next, "the next-page link must be rendered on page 1");
		expect(next.getAttribute("href")).toContain("feature=design");

		const countsResponse = await agent.get(withDesignFeature("/queue/counts"));
		const countsDoc = parse(countsResponse.text);
		const pageLinks = Array.from(
			countsDoc.querySelectorAll("#readlist-design-pages a[data-test-pagination-page]"),
			(el) => el.getAttribute("href"),
		);
		expect(pageLinks.length).toBeGreaterThan(0);
		expect(pageLinks.every((href) => href?.includes("feature=design"))).toBe(true);
	});

	it("carries it in the action of every POST onboarding step form, while a GET step form carries only its own query", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse(
			(await agent.get(withDesignFeature("/queue")).set("User-Agent", CHROME_UA)).text,
		);

		const actions = Array.from(doc.querySelectorAll("[data-test-onboarding-action]"));
		expect(actions.length).toBeGreaterThan(0);
		const postForms = actions.flatMap((action) => {
			const form = action.closest("form");
			assert(form, "every onboarding action must sit inside a form");
			return form.getAttribute("method") === "POST" ? [form] : [];
		});
		expect(postForms.length).toBeGreaterThan(0);
		expect(postForms.every((form) => form.getAttribute("action")?.includes("feature=design"))).toBe(
			true,
		);

		const installAction = doc.querySelector('[data-test-onboarding-action="install"]');
		assert(installAction, "the install step's action must be rendered");
		const installForm = installAction.closest("form");
		assert(installForm, "the install step's GET form must be rendered");
		expect(installForm.getAttribute("action")).toBe("/install");
		const clientInput = installForm.querySelector('input[name="client"]');
		assert(clientInput, "the GET form must carry its own query as a hidden input");
		expect(clientInput.getAttribute("value")).toBe("chrome");
	});
});

describe("redirects keep the design flag", () => {
	it("POST /queue/save?feature=design with a valid URL keeps it before the fragment", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post(withDesignFeature("/queue/save"))
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?feature=design#latest-saved");
	});

	it("POST /queue/save?feature=design with an invalid URL carries both the error code and the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post(withDesignFeature("/queue/save"))
			.type("form")
			.send({ url: "not-a-url" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?error_code=malformed_url&feature=design");
	});

	it("POST /queue/queues?feature=design lands the reader on the new readlist with the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(withDesignFeature("/queue/queues"));

		expect(response.status).toBe(303);
		const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(slug, "creating a readlist must land the reader on it");
		expect(response.headers.location).toBe(`/queue?queue=${slug}&feature=design`);
	});

	it("POST /queue/:id/status?feature=design (non-htmx) carries the flag on the flash redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");
		const id = await firstArticleId(agent);

		const response = await agent
			.post(withDesignFeature(`/queue/${id}/status`))
			.type("form")
			.send({ status: "read" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/queue?status_changed=read&status_article=${id}&feature=design`,
		);
	});

	it("POST /queue/:id/delete?feature=design carries the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");
		const id = await firstArticleId(agent);

		const response = await agent.post(withDesignFeature(`/queue/${id}/delete`));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?feature=design");
	});

	it("POST /queue/queues/:slug/delete?feature=design carries the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent.post(withDesignFeature(`/queue/queues/${slug}/delete`));

		expect(response.status).toBe(303);
		expect(response.headers.location).toContain("feature=design");
	});

	it("POST /queue/dismiss-onboarding?feature=design and POST /queue/onboarding/email/done?feature=design carry the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const dismiss = await agent.post(withDesignFeature("/queue/dismiss-onboarding"));
		expect(dismiss.status).toBe(303);
		expect(dismiss.headers.location).toContain("feature=design");

		const emailDone = await agent.post(withDesignFeature("/queue/onboarding/email/done"));
		expect(emailDone.status).toBe(303);
		expect(emailDone.headers.location).toContain("feature=design");
	});

	it("the same POST without the flag redirects without it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue#latest-saved");
	});
});

describe("GET /queue/counts", () => {
	it("answers the design fragment when feature=design is set", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/a");
		await save(agent, "https://example.com/b");

		const doc = parse((await agent.get(withDesignFeature("/queue/counts"))).text);

		const count = doc.getElementById("readlist-design-count");
		assert(count, "the design count span must be rendered");
		expect(count.textContent).toBe("2 Saved Articles");

		const info = doc.getElementById("readlist-pagination-info");
		assert(info, "the design pagination-info span must be rendered");
		expect(info.textContent).toBe("Showing 2 of 2");

		const pages = doc.getElementById("readlist-design-pages");
		assert(pages, "the design pages list must be rendered");
		expect(pages.querySelectorAll("[data-test-pagination-page]").length).toBeGreaterThan(0);
	});

	it("answers the old fragment unchanged without the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveMany(agent, READLIST_PAGE_SIZE + 1, "https://example.com/old-");

		const doc = parse((await agent.get("/queue/counts")).text);

		const info = doc.querySelector("[data-test-pagination-info]");
		assert(info, "the counts fragment must carry the pagination info across pages");
		expect(info.textContent).toBe("Page 1 of 2");
	});
});

describe("GET /queue/:id/card", () => {
	it("answers a design card with the flag, and the plain card without it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");
		const id = await firstArticleId(agent);

		const designDoc = parse((await agent.get(withDesignFeature(`/queue/${id}/card`))).text);
		const designCard = designDoc.querySelector("[data-test-article]");
		assert(designCard, "the design card must be rendered");
		expect(designCard.classList.contains("readlist-design-card")).toBe(true);
		expect(designCard.getAttribute("data-test-article")).toBe(id);

		const plainDoc = parse((await agent.get(`/queue/${id}/card`)).text);
		const plainCard = plainDoc.querySelector(".readlist-article");
		assert(plainCard, "the plain card must be rendered");
		expect(plainCard.getAttribute("data-test-article")).toBe(id);
	});
});

describe("htmx card status swap under the flag", () => {
	it("returns a mutation fragment whose counts trigger and toast Undo carry feature=design", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await saveMany(agent, 2, "https://example.com/card-swap-");
		const id = await firstArticleId(agent);

		const response = await agent
			.post(withDesignFeature(`/queue/${id}/status?swap=card`))
			.set("HX-Request", "true")
			.type("form")
			.send({ status: "read" });

		expect(response.status).toBe(200);
		const doc = parse(response.text);

		const counts = doc.getElementById("readlist-counts");
		assert(counts, "the out-of-band counts trigger must be rendered");
		expect(counts.getAttribute("hx-get")).toContain("feature=design");

		const undoForm = doc.querySelector("[data-test-toast-action]")?.closest("form");
		assert(undoForm, "the toast's Undo action must be rendered");
		expect(undoForm.getAttribute("action")).toContain("feature=design");
	});
});

describe("the alert box", () => {
	it("shows visible with the reached-limit title when queue_error=limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get(`${withDesignFeature("/queue")}&queue_error=limit`)).text);

		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert box must always be rendered");
		expect(alert.classList.contains("readlist-design__alert--visible")).toBe(true);
		const title = doc.querySelector("[data-test-readlist-error-title]");
		assert(title, "the alert title must be rendered");
		expect(title.textContent).toBe("Readlist limit reached");
	});

	it("stays hidden without queue_error", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert box must always be rendered");
		expect(alert.classList.contains("readlist-design__alert--hidden")).toBe(true);
	});
});

describe("empty states", () => {
	it("welcomes a fresh user with the install action", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the empty state must be rendered for a fresh user");
		const title = empty.querySelector(".readlist-design-empty__title");
		assert(title, "the empty state title must be rendered");
		expect(title.textContent).toBe("Nothing saved yet");
		const install = doc.querySelector('[data-test-empty-action="install"]');
		assert(install, "the install empty action must be rendered");
	});

	it("tells a caught-up reader so with no empty action", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");
		const id = await firstArticleId(agent);
		await agent.post(`/queue/${id}/status`).type("form").send({ status: "read" });

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the caught-up empty state must be rendered");
		const title = empty.querySelector(".readlist-design-empty__title");
		assert(title, "the empty state title must be rendered");
		expect(title.textContent).toBe("You're all caught up");
		expect(empty.querySelectorAll("[data-test-empty-action]").length).toBe(0);
	});

	it("offers a view-unread action, carrying the flag, on the Read tab of a reader with only unread saves", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await save(agent, "https://example.com/article");

		const doc = parse((await agent.get(`${withDesignFeature("/queue")}&tab=done`)).text);

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the no-finished-articles empty state must be rendered");
		const title = empty.querySelector(".readlist-design-empty__title");
		assert(title, "the empty state title must be rendered");
		expect(title.textContent).toBe("No finished articles yet");
		const viewUnread = doc.querySelector('[data-test-empty-action="view-unread"]');
		assert(viewUnread, "the view-unread action must be rendered");
		expect(viewUnread.getAttribute("href")).toContain("feature=design");
	});

	it("points a new custom readlist's empty state at the default readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const doc = parse((await agent.get(withDesignFeature(`/queue?queue=${slug}`))).text);

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the custom-readlist empty state must be rendered");
		const title = empty.querySelector(".readlist-design-empty__title");
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

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "the subscription card must always be rendered");
		expect(banner.classList.contains("readlist-design-subscription--trial-countdown")).toBe(true);
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

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "the subscription card must always be rendered");
		expect(banner.classList.contains("readlist-design-subscription--cancellation-scheduled")).toBe(
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

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "the subscription card must always be rendered");
		expect(banner.classList.contains("readlist-design-subscription--inactive")).toBe(true);
		const input = doc.querySelector('[data-test-form="save-article"] input[name="url"]');
		assert(input, "the save input must always be rendered");
		expect(input.hasAttribute("disabled")).toBe(true);
	});

	it("shows the none state for a founding member with no subscription row", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "the subscription card must always be rendered");
		expect(banner.classList.contains("readlist-design-subscription--none")).toBe(true);
	});
});

describe("custom readlist chrome", () => {
	it("offers rename and delete from the rail menu, each with its own confirm popover", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await createReadlist(agent);

		const doc = parse((await agent.get(withDesignFeature("/queue"))).text);

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

	it("renames from the modal without JavaScript: an HTML form post lands back on the renamed readlist under the flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(withDesignFeature(`/queue/queues/${slug}/rename`))
			.set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
			.type("form")
			.send({ label: "Ideas & Inspiration" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue?queue=${slug}&feature=design`);
		const doc = parse((await agent.get(response.headers.location)).text);
		expect(doc.querySelector(`[data-test-readlist="${slug}"]`)?.textContent?.trim()).toBe("Ideas & Inspiration");
	});

	it("explains a refused no-JavaScript rename in the alert box instead of answering JSON", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(withDesignFeature(`/queue/queues/${slug}/rename`))
			.set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
			.type("form")
			.send({ label: "" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue?queue=${slug}&queue_error=rename_invalid-name&feature=design`);
		const doc = parse((await agent.get(response.headers.location)).text);
		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert box must be rendered");
		expect(alert.classList.contains("readlist-design__alert--visible")).toBe(true);
		expect(alert.querySelector("[data-test-readlist-error-title]")?.textContent).toBe("Couldn't rename the readlist");
	});

	it("keeps answering JSON to the in-page rename client, which asks for it explicitly", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const slug = await createReadlist(agent);

		const response = await agent
			.post(withDesignFeature(`/queue/queues/${slug}/rename`))
			.set("Accept", "application/json")
			.type("form")
			.send({ label: "Finance" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ slug, label: "Finance" });
	});
});

describe("save error under the flag", () => {
	it("renders the save error and marks the input invalid", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = parse(
			(await agent.get(`${withDesignFeature("/queue")}&error_code=malformed_url`)).text,
		);

		const error = doc.querySelector("[data-test-save-error]");
		assert(error, "the save error must be rendered");
		expect(error.textContent).toBe(saveableUrlErrorMessage("malformed_url"));

		const input = doc.querySelector('[data-test-form="save-article"] input[name="url"]');
		assert(input, "the save input must always be rendered");
		expect(input.classList.contains("readlist-design-save__input--invalid")).toBe(true);
	});
});
