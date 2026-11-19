import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { calculateReadTime } from "@packages/domain/article";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const VIDEO_URL = "https://www.youtube.com/watch?v=J3PGI4yqta4";
const VIEW_PATH = "/view/www.youtube.com/watch%3Fv=J3PGI4yqta4";

const STORED_BODY =
	'<div class="page" id="readability-page-1"><article>' +
	'<p class="reader-embed-facade"><a rel="noopener noreferrer" target="_blank" href="https://www.youtube.com/watch?v=J3PGI4yqta4"><img loading="lazy" alt="Watch on YouTube" src="https://i.ytimg.com/vi/J3PGI4yqta4/hqdefault.jpg"></a></p>' +
	'<p><a href="https://www.youtube.com/@ryansolid">Ryan Carniato</a> · Streamed live on Nov 6, 2026 · 7,667 views</p>' +
	"<p>What if we had a language for UI that AI couldn't get wrong?<br>It is still early days.</p>" +
	"<ul>" +
	'<li><a href="https://www.youtube.com/watch?v=J3PGI4yqta4&amp;t=1s">00:00:01</a> - Introduction: Solid 2 Rules and Invariants</li>' +
	'<li><a href="https://www.youtube.com/watch?v=J3PGI4yqta4&amp;t=220s">00:03:40</a> - From Runtime Diagnostics to Compiler Checks</li>' +
	"</ul></article></div>";

const useApp = useTestServer();

async function viewOfSavedVideo(): Promise<Document> {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	await fixture.articleStore.saveArticleGlobally({
		url: VIDEO_URL,
		metadata: { title: "ReactiveScript: Early Findings", siteName: "www.youtube.com", excerpt: "", wordCount: 411 },
		estimatedReadTime: calculateReadTime(411),
		savedAt: new Date("2026-11-18T00:00:00.000Z"),
	});
	await fixture.articleStore.writeContent({ url: VIDEO_URL, content: STORED_BODY });
	await fixture.articleCrawl.markCrawlReady({ url: VIDEO_URL });
	const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async () => {} } });

	const response = await request(harness.server).get(VIEW_PATH);

	expect(response.status).toBe(200);
	return new JSDOM(response.text).window.document;
}

describe("/view of a saved YouTube video", () => {
	it("shows no read time for a saved YouTube video", async () => {
		const doc = await viewOfSavedVideo();

		const readTime = doc.querySelector("[data-test-reader-read-time]");
		assert(readTime, "the read-time span must render so the OOB swap has a node to replace");
		expect(readTime.classList.contains("article-body__read-time--empty")).toBe(true);
		expect(readTime.textContent).toBe("");
	});

	it("renders a stored YouTube body's chapter links and line breaks", async () => {
		const doc = await viewOfSavedVideo();

		const content = doc.querySelector("[data-test-reader-content]");
		assert(content, "reader content must be rendered");
		expect([
			Array.from(content.querySelectorAll("ul li a"), (link) => link.getAttribute("href")),
			content.querySelectorAll("p br").length,
		]).toEqual([
			["https://www.youtube.com/watch?v=J3PGI4yqta4&t=1s", "https://www.youtube.com/watch?v=J3PGI4yqta4&t=220s"],
			1,
		]);
	});
});
