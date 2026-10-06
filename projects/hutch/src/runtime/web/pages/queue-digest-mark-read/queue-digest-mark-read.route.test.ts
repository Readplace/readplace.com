import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { initQueueDigestMarkReadToken } from "../../../domain/email/queue-digest-mark-read-token";
import { initQueueDigestUnsubscribeToken } from "../../../domain/email/queue-digest-unsubscribe-token";
import { QUEUE_DIGEST_MARK_READ_PATH } from "../../queue-digest-email";

const useApp = useTestServer();
const TEST_ANALYTICS_SALT = "test-analytics-salt";
const DIGEST_URLS = ["https://example.com/alpha", "https://example.com/beta"];
const OUTSIDE_THE_EMAIL_URL = "https://example.com/not-in-the-email";

type Harness = ReturnType<ReturnType<typeof useTestServer>>;

async function save(harness: Harness, input: { userId: UserId; url: string }) {
	await harness.articleStore.saveArticle({
		userId: input.userId,
		url: input.url,
		metadata: { title: input.url, siteName: "example.com", excerpt: "", wordCount: 400 },
		estimatedReadTime: MinutesSchema.parse(2),
		provenance: { kind: "web" },
		savedAt: new Date("2026-09-01T08:00:00.000Z"),
	});
}

async function digestReader(input: { email: string; urls: string[] }) {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	await harness.auth.createUser({ email: input.email, password: "password123" });
	const user = await harness.auth.findUserByEmail(input.email);
	assert(user, "the digest reader must exist once created");
	for (const url of [...input.urls, OUTSIDE_THE_EMAIL_URL]) {
		await save(harness, { userId: user.userId, url });
	}
	const articleIds = input.urls.map((url) => ReaderArticleHashId.from(url));
	const token = initQueueDigestMarkReadToken(TEST_ANALYTICS_SALT).sign({ userId: user.userId, articleIds });
	return { harness, userId: user.userId, articleIds, token };
}

function markReadUrl(query: Record<string, string>): string {
	return `${QUEUE_DIGEST_MARK_READ_PATH}?${new URLSearchParams(query).toString()}`;
}

async function statusesOf(harness: Harness, input: { userId: UserId; urls: string[] }) {
	return Promise.all(
		input.urls.map(async (url) => {
			const article = await harness.articleStore.findArticleById(ReaderArticleHashId.from(url), input.userId);
			return article === null ? "deleted" : article.status;
		}),
	);
}

function pageOf(html: string): Element {
	const page = new JSDOM(html).window.document.querySelector("[data-test-queue-digest-mark-read]");
	assert(page, "the mark-read page must render");
	return page;
}

function pageState(html: string): string | null {
	return pageOf(html).getAttribute("data-test-queue-digest-mark-read");
}

function copyOf(html: string): { title: string | undefined; body: string | undefined } {
	const page = pageOf(html);
	return { title: page.querySelector("h1")?.textContent?.trim(), body: page.querySelector("p")?.textContent?.trim() };
}

function actionLabelsOf(html: string): (string | undefined)[] {
	return Array.from(pageOf(html).querySelectorAll("button, a")).map((action) => action.textContent?.trim());
}

function confirmForm(html: string): HTMLFormElement {
	const form = new JSDOM(html).window.document.querySelector<HTMLFormElement>(
		"[data-test-queue-digest-mark-read] form",
	);
	assert(form, "the confirm page must offer a form to mark the articles as read");
	return form;
}

function readlistLink(html: string): URL {
	const form = pageOf(html).querySelector('[data-test-queue-digest-mark-read-action="readlist"]')?.closest("form");
	assert(form, "the page must offer a way to the readlist");
	expect(form.getAttribute("method")).toBe("GET");
	const url = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
	for (const field of Array.from(form.querySelectorAll("input[type=hidden]"))) {
		url.searchParams.set(field.getAttribute("name") ?? "", field.getAttribute("value") ?? "");
	}
	return url;
}

describe("GET /email/queue-digest/mark-read", () => {
	it("asks the reader to confirm, naming how many articles from the email it marks, with one form that posts back with the same token", async () => {
		const { harness, token } = await digestReader({ email: "confirm-page@example.com", urls: DIGEST_URLS });

		const response = await request(harness.server).get(markReadUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(pageState(response.text)).toBe("confirm");
		expect(copyOf(response.text)).toEqual({
			title: "Mark these articles as read?",
			body: "This marks the 2 articles from your “Waiting in your readlist” email as read. They stay saved in your readlist.",
		});
		expect(actionLabelsOf(response.text)).toEqual(["Mark all as read"]);
		const form = confirmForm(response.text);
		expect(form.getAttribute("method")).toBe("POST");
		const action = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(action.pathname).toBe(QUEUE_DIGEST_MARK_READ_PATH);
		expect(Object.fromEntries(action.searchParams)).toEqual({
			t: token,
			utm_source: "queue-digest-mark-read",
			utm_medium: "internal",
			utm_content: "confirm",
		});
	});

	it("names a single article in the singular", async () => {
		const { harness, token } = await digestReader({ email: "confirm-one@example.com", urls: DIGEST_URLS.slice(0, 1) });

		const response = await request(harness.server).get(markReadUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(copyOf(response.text)).toEqual({
			title: "Mark this article as read?",
			body: "This marks the 1 article from your “Waiting in your readlist” email as read. It stays saved in your readlist.",
		});
	});

	it("never marks anything on its own, since mail scanners open every link", async () => {
		const { harness, userId, token } = await digestReader({ email: "confirm-no-write@example.com", urls: DIGEST_URLS });

		const response = await request(harness.server).get(markReadUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(await statusesOf(harness, { userId, urls: DIGEST_URLS })).toEqual(["unread", "unread"]);
	});

	it("opens the same confirmation from the email button, which carries the digest campaign", async () => {
		const { harness, token } = await digestReader({ email: "email-button@example.com", urls: DIGEST_URLS });

		const response = await request(harness.server)
			.get(
				markReadUrl({
					t: token,
					utm_source: "queue-digest",
					utm_medium: "email",
					utm_campaign: "regular",
					utm_content: "mark-all-read",
					utm_term: "msg-regular-1",
				}),
			)
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(pageState(response.text)).toBe("confirm");
	});

	it("keeps the page out of search results", async () => {
		const { harness, token } = await digestReader({ email: "noindex@example.com", urls: DIGEST_URLS });

		const response = await request(harness.server).get(markReadUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(response.headers["x-robots-tag"]).toBe("noindex");
	});

	it.each([
		["a tampered signature", (token: string) => ({ t: `${token}0` })],
		[
			"the reader's unsubscribe token",
			(_token: string, userId: UserId) => ({ t: initQueueDigestUnsubscribeToken(TEST_ANALYTICS_SALT).sign(userId) }),
		],
		["no token at all", () => ({})],
	])("refuses %s with a 400 that points the reader to their readlist", async (_name, queryFor) => {
		const { harness, userId, token } = await digestReader({ email: "bad-token-get@example.com", urls: DIGEST_URLS });

		const response = await request(harness.server)
			.get(markReadUrl(queryFor(token, userId)))
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(400);
		expect(pageState(response.text)).toBe("invalid");
		expect(copyOf(response.text)).toEqual({
			title: "Couldn't read this mark-as-read link",
			body: "The link is incomplete or has been changed, so no articles were marked as read. You can mark them as read from your readlist.",
		});
		expect(actionLabelsOf(response.text)).toEqual(["Go to your readlist"]);
		expect(readlistLink(response.text).pathname).toBe("/queue");
	});

	it.each([
		[DIGEST_URLS, "The 2 articles from your “Waiting in your readlist” email are marked as read."],
		[DIGEST_URLS.slice(0, 1), "The 1 article from your “Waiting in your readlist” email is marked as read."],
	])("confirms the articles are marked once the reader comes back from the form, with a way to their readlist", async (urls, body) => {
		const { harness, token } = await digestReader({ email: "done-page@example.com", urls });

		const response = await request(harness.server)
			.get(markReadUrl({ t: token, done: "1" }))
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(pageState(response.text)).toBe("done");
		expect(copyOf(response.text)).toEqual({ title: "Marked as read", body });
		expect(actionLabelsOf(response.text)).toEqual(["Go to your readlist"]);
		const readlist = readlistLink(response.text);
		expect(readlist.pathname).toBe("/queue");
		expect(Object.fromEntries(readlist.searchParams)).toEqual({
			utm_source: "queue-digest-mark-read",
			utm_medium: "internal",
			utm_content: "go-to-readlist",
		});
	});
});

describe("POST /email/queue-digest/mark-read", () => {
	it("marks exactly the email's articles read and sends the reader to the confirmation, so a refresh does not post again", async () => {
		const { harness, userId, token } = await digestReader({ email: "page-post@example.com", urls: DIGEST_URLS });
		const page = await request(harness.server).get(markReadUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		const response = await request(harness.server)
			.post(confirmForm(page.text).getAttribute("action") ?? "")
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(markReadUrl({ t: token, done: "1" }));
		expect(await statusesOf(harness, { userId, urls: [...DIGEST_URLS, OUTSIDE_THE_EMAIL_URL] })).toEqual([
			"read",
			"read",
			"unread",
		]);
	});

	it("skips an article the reader already deleted and still marks the rest", async () => {
		const { harness, userId, articleIds, token } = await digestReader({
			email: "deleted-article@example.com",
			urls: DIGEST_URLS,
		});
		const [deleted] = articleIds;
		assert(deleted, "the digest lists at least one article");
		await harness.articleStore.deleteArticle(deleted, userId);

		const response = await request(harness.server).post(markReadUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(303);
		expect(await statusesOf(harness, { userId, urls: DIGEST_URLS })).toEqual(["deleted", "read"]);
	});

	it("marks an article the reader moved out of All in the readlist that still holds it", async () => {
		const { harness, userId, articleIds, token } = await digestReader({ email: "moved-article@example.com", urls: DIGEST_URLS });
		const [moved] = articleIds;
		assert(moved, "the digest lists at least one article");
		const longReads = ReadlistSlugSchema.parse("long-reads");
		await harness.articleStore.createReadlistDefinition({ userId, slug: ReadlistSlugSchema.parse("work"), label: "Work", createdAt: new Date("2026-09-01T08:00:00.000Z") });
		await harness.articleStore.createReadlistDefinition({ userId, slug: longReads, label: "Long reads", createdAt: new Date("2026-09-02T08:00:00.000Z") });
		await harness.articleStore.saveReadlistArticle({
			readlist: longReads,
			userId,
			url: "https://example.com/alpha",
			metadata: { title: "https://example.com/alpha", siteName: "example.com", excerpt: "", wordCount: 400 },
			estimatedReadTime: MinutesSchema.parse(2),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-02T08:00:00.000Z"),
		});
		await harness.articleStore.deleteArticle(moved, userId);

		const response = await request(harness.server).post(markReadUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(303);
		expect((await harness.articleStore.findReadlistArticleById({ id: moved, userId, readlist: longReads }))?.status).toBe("read");
		expect(await statusesOf(harness, { userId, urls: DIGEST_URLS })).toEqual(["deleted", "read"]);
	});

	it.each([
		["a tampered signature", (token: string) => ({ t: `${token}0` })],
		["no token at all", () => ({})],
	])("refuses %s with a 400 and marks nothing", async (_name, queryFor) => {
		const { harness, userId, token } = await digestReader({ email: "bad-token-post@example.com", urls: DIGEST_URLS });

		const response = await request(harness.server).post(markReadUrl(queryFor(token))).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(400);
		expect(pageState(response.text)).toBe("invalid");
		expect(await statusesOf(harness, { userId, urls: DIGEST_URLS })).toEqual(["unread", "unread"]);
	});
});
