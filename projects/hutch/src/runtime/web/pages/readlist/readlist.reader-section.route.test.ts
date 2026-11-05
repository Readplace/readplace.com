import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "../../../test-app";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../../shared/article-body/reader-slot/section-pages";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;

const LONG_BODY = `<h2>Chapter 1</h2><p>One</p><h2>Chapter 2</h2><p>Two</p><h2>Chapter 3</h2><p>${"word ".repeat(Math.ceil(READER_SECTION_PAGE_THRESHOLD_BYTES / 5))}</p>`;
const SHORT_BODY = "<h2>Chapter 1</h2><p>One</p><h2>Chapter 2</h2><p>Two</p>";

async function ownerWith(input: { body: string; readlist?: string; pending?: boolean }) {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in user must exist");
	const url = "https://example.com/long-post";
	await saveFor({ harness, userId: user.userId, url, readlist: input.readlist });
	await harness.articleStore.writeContent({ url, content: input.body });
	if (input.pending === true) {
		await harness.articleCrawl.markCrawlPending({ url, measured: false, meteredLegs: "run" });
	} else {
		await harness.articleCrawl.markCrawlReady({ url });
	}
	return { agent, id: ReaderArticleHashId.from(url).value, markReady: () => harness.articleCrawl.markCrawlReady({ url }) };
}

async function saveFor(input: { harness: Harness; userId: UserId; url: string; readlist: string | undefined }) {
	const article = {
		userId: input.userId,
		url: input.url,
		metadata: { title: "Long Post", siteName: "example.com", excerpt: "Blurb.", wordCount: 3 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "web" as const },
		savedAt: new Date("2026-09-30T01:02:03.000Z"),
	};
	await input.harness.articleStore.saveArticle(article);
	if (input.readlist === undefined) return;
	const slug = ReadlistSlugSchema.parse(input.readlist);
	await input.harness.articleStore.createReadlistDefinition({
		userId: input.userId,
		slug,
		label: "Work",
		createdAt: new Date("2026-09-30T00:00:00.000Z"),
	});
	await input.harness.articleStore.saveReadlistArticle({ ...article, readlist: slug });
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function chapterHeadings(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-reader-content] h2"), (heading) => String(heading.textContent));
}

function nextLink(doc: Document): Element {
	const next = doc.querySelector("[data-test-section-next]");
	assert(next, "a page before the last must link to the next page");
	return next;
}

describe("Owner reader sections (GET /queue/:id/view?section=N)", () => {
	it("shows the requested chapter and the pager for a long body", async () => {
		const { agent, id } = await ownerWith({ body: LONG_BODY });

		const response = await agent.get(`/queue/${id}/view?section=2`);

		expect(response.status).toBe(200);
		const doc = parse(response.text);
		expect(chapterHeadings(doc)).toEqual(["Chapter 2"]);
		expect(doc.querySelector("[data-test-section-pager]")?.getAttribute("data-section-current")).toBe("2");
	});

	it("ignores ?section on a short body", async () => {
		const { agent, id } = await ownerWith({ body: SHORT_BODY });

		const doc = parse((await agent.get(`/queue/${id}/view?section=2`)).text);

		expect(chapterHeadings(doc)).toEqual(["Chapter 1", "Chapter 2"]);
		expect(doc.querySelector("[data-test-section-pager]")).toBeNull();
	});

	it("keeps the app platform on the app reader's next link, boosted into main", async () => {
		const { agent, id } = await ownerWith({ body: LONG_BODY });

		const doc = parse((await agent.get(`/queue/${id}/view?platform=ios`)).text);

		const next = nextLink(doc);
		const href = new URL(String(next.getAttribute("href")), TEST_APP_ORIGIN);
		expect(doc.querySelector(".header")).toBeNull();
		expect({
			platform: href.searchParams.get("platform"),
			section: href.searchParams.get("section"),
			boost: next.getAttribute("hx-boost"),
			target: next.getAttribute("hx-target"),
			select: next.getAttribute("hx-select"),
		}).toEqual({ platform: "ios", section: "2", boost: "true", target: "main", select: "main" });
	});

	it("keeps a non-default readlist on the next link and the table of contents, and that next link opens chapter 2", async () => {
		const { agent, id } = await ownerWith({ body: LONG_BODY, readlist: "work" });

		const doc = parse((await agent.get(`/queue/${id}/view?queue=work`)).text);
		const nextHref = String(nextLink(doc).getAttribute("href"));
		const crossPageRows = Array.from(doc.querySelectorAll('[data-test-toc-page]:not([data-test-toc-page="1"])'), (row) =>
			String(row.getAttribute("href")),
		);
		const followed = await agent.get(nextHref);

		expect(new URL(nextHref, TEST_APP_ORIGIN).searchParams.get("queue")).toBe("work");
		expect(crossPageRows).toHaveLength(2);
		expect(crossPageRows.every((href) => new URL(href, TEST_APP_ORIGIN).searchParams.get("queue") === "work")).toBe(true);
		expect(followed.status).toBe(200);
		expect(chapterHeadings(parse(followed.text))).toEqual(["Chapter 2"]);
	});

	it("renders the requested chapter in the reader poll", async () => {
		const { agent, id } = await ownerWith({ body: LONG_BODY });

		const response = await agent.get(`/queue/${id}/reader?poll=1&section=2`).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(chapterHeadings(parse(`<body>${response.text}</body>`))).toEqual(["Chapter 2"]);
	});

	it("keeps a non-default readlist on the reader poll URL, and the poll's next link once the body is ready", async () => {
		const { agent, id, markReady } = await ownerWith({ body: LONG_BODY, readlist: "work", pending: true });
		const pendingDoc = parse((await agent.get(`/queue/${id}/view?queue=work`)).text);
		const pollUrl = pendingDoc.querySelector("[data-test-reader-slot][hx-get]")?.getAttribute("hx-get");
		assert(pollUrl, "a pending reader must poll for its body");
		await markReady();

		const response = await agent.get(pollUrl).set(BROWSER_REQUEST_HEADERS);
		const nextHref = String(nextLink(parse(`<body>${response.text}</body>`)).getAttribute("href"));

		expect(new URL(pollUrl, TEST_APP_ORIGIN).searchParams.get("queue")).toBe("work");
		expect(new URL(nextHref, TEST_APP_ORIGIN).searchParams.get("queue")).toBe("work");
	});
});
