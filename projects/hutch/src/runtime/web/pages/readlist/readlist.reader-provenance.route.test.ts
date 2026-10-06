import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MinutesSchema } from "@packages/domain/article";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { NewsletterNameSchema } from "@packages/domain/newsletter-catalog";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
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

		const readlistDoc = new JSDOM((await agent.get("/queue")).text).window.document;
		const articleId = readlistDoc
			.querySelector("[data-test-article-list] .readlist-article")
			?.getAttribute("data-test-article");
		assert(articleId, "the saved article must appear in the readlist");
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

	describe("for a link saved from an email", () => {
		const AT = "2026-09-30T00:00:00.000Z";

		async function savedFromEmail(senderEmail: string): Promise<{
			agent: Awaited<ReturnType<typeof loginAgent>>;
			articleId: string;
		}> {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const catalog = initInMemoryNewsletterCatalog({
				version: 1,
				records: [
					{ from: ForwardableSenderSchema.parse("dan@tldr.tech"), name: NewsletterNameSchema.parse("TLDR"), status: "approved", evidence: [], createdAt: AT, updatedAt: AT },
				],
			});
			const harness = useApp({
				...fixture,
				newsletterCatalog: { ...fixture.newsletterCatalog, readNewsletterCatalog: catalog.readCatalog },
			});
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "the seeded login user must exist");
			const { saved } = await harness.articleStore.saveArticle({
				userId,
				url: "https://example.com/from-a-newsletter",
				metadata: { title: "From a newsletter", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(0),
				provenance: { kind: "email", senderEmail },
				savedAt: new Date(),
			});
			return { agent, articleId: saved.id.value };
		}

		function provenanceTag(html: string): string | undefined {
			return new JSDOM(html).window.document.querySelector("[data-test-reader-provenance]")?.textContent?.trim();
		}

		it("names the newsletter the catalog records for the sender, on the page and on each header a poll swaps in", async () => {
			const { agent, articleId } = await savedFromEmail("dan@tldr.tech");

			const [view, reader, summary] = await Promise.all([
				agent.get(`/queue/${articleId}/view`),
				agent.get(`/queue/${articleId}/reader?poll=1`),
				agent.get(`/queue/${articleId}/summary?poll=1`),
			]);

			expect([view, reader, summary].map((response) => provenanceTag(response.text))).toEqual(["via TLDR", "via TLDR", "via TLDR"]);
		});

		it("falls back to the sender address when the catalog does not know the sender", async () => {
			const { agent, articleId } = await savedFromEmail("stranger@example.com");

			const response = await agent.get(`/queue/${articleId}/view`);

			expect(provenanceTag(response.text)).toBe("via stranger@example.com");
		});
	});
});
