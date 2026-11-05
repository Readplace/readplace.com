import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";

const useApp = useTestServer();

const fixedNow = new Date("2026-11-05T10:03:20.000Z");

function secondsBeforeNow(seconds: number): string {
	return new Date(fixedNow.getTime() - seconds * 1000).toISOString();
}

const pendingCrawlByPath: Record<string, ArticleCrawl> = {
	"/just-saved": { status: "pending", startedAt: secondsBeforeNow(2), stage: "crawl-fetching" },
	"/fetching": { status: "pending", startedAt: secondsBeforeNow(40), stage: "crawl-fetching" },
	"/uploaded": { status: "pending", startedAt: secondsBeforeNow(40), stage: "crawl-content-uploaded" },
	"/overdue": { status: "pending", startedAt: secondsBeforeNow(200), stage: "crawl-fetching" },
};

describe("Readlist pending card crawl estimate", () => {
	it("shows each pending card the seconds left from its crawl start and stage", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const crawlFor = (url: string) => pendingCrawlByPath[new URL(url).pathname];
		const harness = useApp({
			...fixture,
			articleCrawl: {
				...fixture.articleCrawl,
				findArticleCrawlStatus: async (url: string) => crawlFor(url),
			},
			shared: { ...fixture.shared, now: () => fixedNow },
		});
		const agent = await loginAgent(harness.server, harness.auth);
		for (const path of Object.keys(pendingCrawlByPath)) {
			await agent.post("/queue/save").type("form").send({ url: `https://example.com${path}` });
		}

		const response = await agent.get("/queue");

		const document = new JSDOM(response.text).window.document;
		const estimates = Object.fromEntries(
			Array.from(document.querySelectorAll("[data-test-article-list] .readlist-article")).map((card) => {
				const url = card.querySelector("[data-test-article-url]")?.getAttribute("href");
				const estimate = card.querySelector("[data-test-crawl-estimate]");
				assert(estimate, "a pending card must render its crawl estimate");
				const kind = ["quiet", "counting", "almost-there", "hidden"].find((state) =>
					estimate.classList.contains(`crawl-estimate--${state}`),
				);
				return [url, { kind, remaining: estimate.getAttribute("data-remaining-seconds") }];
			}),
		);
		expect(estimates).toEqual({
			"https://example.com/just-saved": { kind: "quiet", remaining: "148" },
			"https://example.com/fetching": { kind: "counting", remaining: "120" },
			"https://example.com/uploaded": { kind: "counting", remaining: "16" },
			"https://example.com/overdue": { kind: "almost-there", remaining: "0" },
		});
	});
});
