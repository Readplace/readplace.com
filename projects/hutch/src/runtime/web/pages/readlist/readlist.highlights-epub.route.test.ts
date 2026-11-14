import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { JSDOM } from "jsdom";
import { DOMParser } from "linkedom";
import request from "supertest";
import { CandidateIdSchema } from "@packages/article-state-types";
import { HighlightIdSchema, MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { UserIdSchema } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;
type Agent = Awaited<ReturnType<typeof loginAgent>>;

const ARTICLE_URL = "https://example.com/highlighted-post?utm_source=x";
const ARTICLE_ID = ReaderArticleHashId.from(ARTICLE_URL).value;
const ARTICLE_BODY = "<p>Opening line of the body.</p><p>A passage worth keeping for later.</p>";

async function signedInHarness() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in user must exist");
	return { harness, agent, userId: user.userId };
}

async function saveArticle(params: { harness: Harness; userId: string; url: string; body: string | undefined }) {
	await params.harness.articleStore.saveArticle({
		userId: UserIdSchema.parse(params.userId),
		url: params.url,
		metadata: { title: "Highlighted", siteName: "example.com", excerpt: "Blurb.", wordCount: 9 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "web" },
		savedAt: new Date("2026-09-30T01:02:03.000Z"),
		saveTrigger: "manual",
	});
	if (params.body === undefined) return;
	await params.harness.articleStore.writeContent({ url: params.url, content: params.body });
	await params.harness.articleCrawl.markCrawlReady({ url: params.url });
}

async function createHighlight(params: { agent: Agent; exact: string; occurrence: "first" | "last" }): Promise<string> {
	const page = new JSDOM((await params.agent.get(`/queue/${ARTICLE_ID}/view`)).text).window.document;
	const content = page.querySelector(".article-body__content");
	assert(content, "the reader must render its content");
	const text = normaliseText(collectTextChunks<Node>(content)).text;
	const start = params.occurrence === "first" ? text.indexOf(params.exact) : text.lastIndexOf(params.exact);
	assert(start >= 0, `the served text must hold "${params.exact}"`);
	const response = await params.agent
		.post(`/queue/${ARTICLE_ID}/highlights`)
		.type("form")
		.send({ exact: params.exact, start: String(start), end: String(start + params.exact.length), origin: "mouse" });
	assert.equal(response.status, 303);
	const match = /#highlight-(.+)$/.exec(response.headers.location);
	assert(match, "the create redirect must name the new highlight");
	return HighlightIdSchema.parse(match[1]);
}

function epubLink(html: string): string {
	const link = new JSDOM(html).window.document.querySelector('[data-test-download="epub"]');
	assert(link, "the reader must hold the EPUB link");
	const href = link.getAttribute("href");
	assert(href, "the EPUB link must carry an href");
	return href;
}

async function downloadChapter(agent: Agent, href: string) {
	const response = await agent.get(href).responseType("blob");
	const body: Buffer = response.body;
	const files = unzipSync(new Uint8Array(body));
	const chapter = new DOMParser().parseFromString(strFromU8(files["OEBPS/content.xhtml"]), "text/html");
	return { response, chapter };
}

function sectionEntries(chapter: ReturnType<DOMParser["parseFromString"]>): string[] {
	const headings = Array.from(chapter.querySelectorAll("h2"));
	const section = headings[headings.length - 1];
	assert(section, "the chapter must hold a heading");
	expect(section.textContent).toBe("Highlights");
	const entries: string[] = [];
	for (let next = section.nextElementSibling; next !== null && next.tagName === "BLOCKQUOTE"; next = next.nextElementSibling) {
		entries.push(next.textContent ?? "");
	}
	return entries;
}

describe("Owner reader EPUB (GET /queue/:id/view?format=epub)", () => {
	it("links the reader's Download to the owner EPUB", async () => {
		const { harness, agent, userId } = await signedInHarness();
		await saveArticle({ harness, userId, url: ARTICLE_URL, body: ARTICLE_BODY });

		const href = epubLink((await agent.get(`/queue/${ARTICLE_ID}/view`)).text);

		expect(href.startsWith(`/queue/${ARTICLE_ID}/view?`)).toBe(true);
		const params = new URL(href, TEST_APP_ORIGIN).searchParams;
		expect({
			format: params.get("format"),
			utmSource: params.get("utm_source"),
			utmMedium: params.get("utm_medium"),
			utmContent: params.get("utm_content"),
		}).toEqual({
			format: "epub",
			utmSource: "reader",
			utmMedium: "internal",
			utmContent: "download-epub",
		});
	});

	it("downloads an EPUB that marks the passage and ends with its Highlights section", async () => {
		const { harness, agent, userId } = await signedInHarness();
		await saveArticle({ harness, userId, url: ARTICLE_URL, body: ARTICLE_BODY });
		const highlightId = await createHighlight({ agent, exact: "passage worth keeping", occurrence: "first" });
		const href = epubLink((await agent.get(`/queue/${ARTICLE_ID}/view`)).text);

		const { response, chapter } = await downloadChapter(agent, href);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("application/epub+zip");
		expect(response.headers["content-disposition"]).toBe('attachment; filename="highlighted.epub"');
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(chapter.querySelector(`mark[data-highlight-id="${highlightId}"]`)?.textContent).toBe("passage worth keeping");
		expect(sectionEntries(chapter)).toEqual(["passage worth keeping"]);
	});

	it("links a noted passage's reference to its note in the Highlights section and the note back to it", async () => {
		const { harness, agent, userId } = await signedInHarness();
		await saveArticle({ harness, userId, url: ARTICLE_URL, body: ARTICLE_BODY });
		const highlightId = await createHighlight({ agent, exact: "passage worth keeping", occurrence: "first" });
		const noted = await agent
			.post(`/queue/${ARTICLE_ID}/highlights/${highlightId}/note`)
			.type("form")
			.send({ note: "Worth a reread" });
		assert.equal(noted.status, 303);

		const { chapter } = await downloadChapter(agent, `/queue/${ARTICLE_ID}/view?format=epub`);

		const linksOf = (role: string) =>
			Array.from(chapter.querySelectorAll(`a[role="${role}"]`), (link) => {
				const href = link.getAttribute("href") ?? "";
				return [href, chapter.getElementById(href.slice(1))?.textContent];
			});
		expect(linksOf("doc-noteref")).toEqual([[`#endnote-highlight-${highlightId}`, "1 Worth a reread"]]);
		expect(linksOf("doc-backlink")).toEqual([[`#noteref-highlight-${highlightId}`, "1"]]);
	});

	it("marks the second of two identical passages when no canonical snapshot exists", async () => {
		const { harness, agent, userId } = await signedInHarness();
		await saveArticle({
			harness,
			userId,
			url: ARTICLE_URL,
			body: "<p>The same words again.</p><p>A middle line between them.</p><p>The same words again.</p>",
		});
		const highlightId = await createHighlight({ agent, exact: "same words again", occurrence: "last" });

		const { chapter } = await downloadChapter(agent, `/queue/${ARTICLE_ID}/view?format=epub`);

		const paragraphs = Array.from(chapter.querySelectorAll("p")).filter((p) => p.textContent === "The same words again.");
		expect(paragraphs.map((p) => p.querySelector(`mark[data-highlight-id="${highlightId}"]`) !== null)).toEqual([
			false,
			true,
		]);
		expect(sectionEntries(chapter)).toEqual(["same words again"]);
	});

	it("anchors against the canonical snapshot's body, listing a quote it lost as not found", async () => {
		const { harness, agent, userId } = await signedInHarness();
		await saveArticle({ harness, userId, url: ARTICLE_URL, body: ARTICLE_BODY });
		await createHighlight({ agent, exact: "passage worth keeping", occurrence: "first" });
		await harness.articleStore.replaceCanonicalContent({
			url: ARTICLE_URL,
			content: "<p>Opening line of the body.</p><p>A rewritten second paragraph.</p>",
			canonicalContentHash: "snapshot-hash",
			canonicalCandidateId: CandidateIdSchema.parse("snapshot-candidate"),
		});

		const { chapter } = await downloadChapter(agent, `/queue/${ARTICLE_ID}/view?format=epub`);

		expect(Array.from(chapter.querySelectorAll("p"), (p) => p.textContent)).toContain("A rewritten second paragraph.");
		expect(
			Array.from(chapter.querySelectorAll("mark[data-highlight-id]"), (mark) => mark.getAttribute("data-highlight-id")),
		).toEqual([]);
		expect(sectionEntries(chapter)).toEqual(["passage worth keeping (not found in the current version)"]);
	});

	it("answers a prefetch of the owner EPUB with 204", async () => {
		const { harness, agent, userId } = await signedInHarness();
		await saveArticle({ harness, userId, url: ARTICLE_URL, body: ARTICLE_BODY });

		const response = await agent
			.get(`/queue/${ARTICLE_ID}/view?format=epub`)
			.set("Sec-Purpose", "prefetch");

		expect(response.status).toBe(204);
	});

	it("leaves another reader's article id to the reader handler", async () => {
		const { harness, agent } = await signedInHarness();
		await saveArticle({ harness, userId: "someone-else-456", url: ARTICLE_URL, body: ARTICLE_BODY });

		const response = await agent.get(`/queue/${ARTICLE_ID}/view?format=epub`);

		expect(response.status).toBe(302);
		expect(response.headers.location).toBe(
			"/view/example.com/highlighted-post%3Futm_source=x?utm_source=read&utm_medium=share&utm_campaign=read-permalink",
		);
	});

	it("redirects a signed-out request to the public reader without the format", async () => {
		const { harness, userId } = await signedInHarness();
		await saveArticle({ harness, userId, url: ARTICLE_URL, body: ARTICLE_BODY });

		const response = await request(harness.server).get(`/queue/${ARTICLE_ID}/view?format=epub`);

		expect(response.status).toBe(302);
		expect(response.headers.location).toBe(
			"/view/example.com/highlighted-post%3Futm_source=x?utm_source=read&utm_medium=share&utm_campaign=read-permalink",
		);
		expect(new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.has("format")).toBe(false);
	});

	it("serves the reader page for a pending article", async () => {
		const { harness, agent, userId } = await signedInHarness();
		await saveArticle({ harness, userId, url: ARTICLE_URL, body: undefined });

		const response = await agent.get(`/queue/${ARTICLE_ID}/view?format=epub`);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
	});

	it("serves the reader page for an email issue", async () => {
		const { harness, agent, userId } = await signedInHarness();
		const issueUrl = `email://inbox/${encodeURIComponent(userId)}/${encodeURIComponent("2026-06-24T09:00:00.000Z#<issue-42@tldr.tech>")}`;
		await saveArticle({ harness, userId, url: issueUrl, body: "<p>Today's links, with commentary.</p>" });

		const response = await agent.get(
			`/queue/${ReaderArticleHashId.from(issueUrl).value}/view?format=epub`,
		);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
	});

	it("keeps the public EPUB link for the Android surface, on the page and in the poll", async () => {
		const { harness, agent, userId } = await signedInHarness();
		await saveArticle({ harness, userId, url: ARTICLE_URL, body: ARTICLE_BODY });

		const pageHref = epubLink((await agent.get(`/queue/${ARTICLE_ID}/view?platform=android`)).text);
		const pollHref = epubLink((await agent.get(`/queue/${ARTICLE_ID}/reader?poll=1&platform=android`)).text);

		expect([pageHref.startsWith("/view/"), pollHref.startsWith("/view/")]).toEqual([true, true]);
	});
});
