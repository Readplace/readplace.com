import assert from "node:assert/strict";
import { initReaderPipeline } from "./reader-pipeline";

const ARTICLE_HTML = `<!doctype html><html><head><title>Pipeline Test Title</title>
<meta property="og:site_name" content="Test Site"></head><body><article>
<h1>Pipeline Test Title</h1>
<p>This is a sufficiently long first paragraph of body content so that Mozilla
Readability treats the page as a real article worth extracting from the DOM.</p>
<p>A second paragraph adds enough words and text density for the readability
heuristics to lock on and return parsed content rather than a null result.</p>
<p>And a third paragraph to stay safely above the scoring threshold used by the
content extraction algorithm.</p>
</article></body></html>`;

const htmlResponse: typeof fetch = async () =>
	new Response(ARTICLE_HTML, {
		status: 200,
		headers: { "content-type": "text/html" },
	});

const errorResponse: typeof fetch = async () =>
	new Response("nope", { status: 500 });

describe("initReaderPipeline", () => {
	it("fetches and extracts an article into clean reader content", async () => {
		const pipeline = initReaderPipeline({
			fetch: htmlResponse,
			logError: () => undefined,
		});
		const result = await pipeline.loadArticle("https://example.com/post");
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.ok(result.article.title.length > 0);
			assert.ok(result.article.content.includes("paragraph"));
		}
	});

	it("reports failure when the origin is unreachable", async () => {
		const pipeline = initReaderPipeline({
			fetch: errorResponse,
			logError: () => undefined,
		});
		const result = await pipeline.loadArticle("https://example.com/post");
		assert.equal(result.ok, false);
	});
});
