import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

function metaRow(html: string): string[] {
	const meta = new JSDOM(html).window.document.querySelector(".article-body__meta");
	assert(meta, "meta row must render");
	return Array.from(meta.querySelectorAll("span")).map((span) => span.textContent?.trim() ?? "");
}

describe("Reader save-provenance tag", () => {
	async function saveFromTheSaveBar(): Promise<{
		agent: Awaited<ReturnType<typeof loginAgent>>;
		articleId: string;
	}> {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/provenance-post" });

		const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
		const articleId = queueDoc
			.querySelector("[data-test-article-list] .queue-article")
			?.getAttribute("data-test-article");
		assert(articleId, "the saved article must appear in the queue");
		return { agent, articleId };
	}

	it("tags an article saved from the web app's own save bar", async () => {
		const { agent, articleId } = await saveFromTheSaveBar();

		const response = await agent.get(`/queue/${articleId}/view`);

		expect(response.status).toBe(200);
		expect(metaRow(response.text)).toEqual(["example.com", "1 min read", "via Web"]);
	});

	it("keeps the tag on the header a reader poll swaps in, so the crawl settling does not drop it", async () => {
		const { agent, articleId } = await saveFromTheSaveBar();

		const response = await agent.get(`/queue/${articleId}/reader?poll=1`);

		expect(response.status).toBe(200);
		const header = new JSDOM(response.text).window.document.querySelector("#article-header");
		assert(header, "the poll response must carry the header as an OOB swap");
		expect(header.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(
			header.querySelector("[data-test-reader-provenance]")?.textContent?.trim(),
		).toBe("via Web");
	});
});
