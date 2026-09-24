import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { calculateReadTime } from "@packages/domain/article";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const TWEET_ON_TWITTER = "https://twitter.com/jack/status/20";
const TWEET_ON_X = "https://x.com/jack/status/20";

const useApp = useTestServer();

async function harnessWith(rows: { url: string; title: string; purgedAt?: Date }[]) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	for (const row of rows) {
		await fixture.articleStore.saveArticleGlobally({
			url: row.url,
			metadata: { title: row.title, siteName: new URL(row.url).hostname, excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0),
			savedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		if (row.purgedAt) await fixture.articleStore.setPurgedAt({ url: row.url, at: row.purgedAt });
	}
	const stubbed: string[] = [];
	const anonymousSaves: string[] = [];
	const staleChecks: string[] = [];
	const harness = useApp({
		...fixture,
		articleStore: {
			...fixture.articleStore,
			saveArticleGlobally: async (params) => {
				stubbed.push(params.url);
				return fixture.articleStore.saveArticleGlobally(params);
			},
		},
		events: {
			...fixture.events,
			publishSaveAnonymousLink: async (params) => {
				anonymousSaves.push(params.url);
			},
			publishStaleCheckRequested: async (params) => {
				staleChecks.push(params.url);
			},
		},
	});
	return { harness, fixture, stubbed, anonymousSaves, staleChecks };
}

function titleOf(html: string): string | null | undefined {
	return new JSDOM(html).window.document.querySelector("[data-test-reader-title]")?.textContent;
}

describe("/view of a tweet saved under twitter.com, x.com, or neither", () => {
	it("serves a legacy twitter.com article from its own record", async () => {
		const { harness, stubbed, staleChecks } = await harnessWith([
			{ url: TWEET_ON_TWITTER, title: "Legacy tweet" },
			{ url: TWEET_ON_X, title: "New tweet" },
		]);

		const response = await request(harness.server).get("/view/twitter.com/jack/status/20");

		expect(response.status).toBe(200);
		expect(titleOf(response.text)).toBe("Legacy tweet");
		expect(stubbed).toEqual([]);
		expect(staleChecks).toEqual([TWEET_ON_TWITTER]);
	});

	it("serves the x.com article for a twitter.com link nobody saved under twitter.com", async () => {
		const { harness, stubbed, staleChecks } = await harnessWith([{ url: TWEET_ON_X, title: "New tweet" }]);

		const response = await request(harness.server).get("/view/twitter.com/jack/status/20");

		expect(response.status).toBe(200);
		expect(titleOf(response.text)).toBe("New tweet");
		expect(stubbed).toEqual([]);
		expect(staleChecks).toEqual([TWEET_ON_X]);
	});

	it("creates the article under x.com on a first visit to a twitter.com link", async () => {
		const { harness, fixture, stubbed, anonymousSaves } = await harnessWith([]);

		const response = await request(harness.server).get("/view/twitter.com/jack/status/20");

		expect(response.status).toBe(200);
		expect(stubbed).toEqual([TWEET_ON_X]);
		expect(anonymousSaves).toEqual([TWEET_ON_X]);
		expect(await fixture.articleStore.findArticleByUrl(TWEET_ON_TWITTER)).toBeNull();
	});

	it("keeps a tombstoned twitter.com article gone rather than showing its x.com twin", async () => {
		const { harness, stubbed } = await harnessWith([
			{ url: TWEET_ON_TWITTER, title: "Legacy tweet", purgedAt: new Date("2026-07-16T10:00:00.000Z") },
			{ url: TWEET_ON_X, title: "New tweet" },
		]);

		const page = await request(harness.server).get("/view/twitter.com/jack/status/20");
		const readerPoll = await request(harness.server).get(`/view/reader?url=${encodeURIComponent(TWEET_ON_TWITTER)}`);
		const summaryPoll = await request(harness.server).get(`/view/summary?url=${encodeURIComponent(TWEET_ON_TWITTER)}`);

		expect([page.status, readerPoll.status, summaryPoll.status]).toEqual([404, 404, 404]);
		expect(stubbed).toEqual([]);
	});

	it("polls the x.com article for a twitter.com link nobody saved under twitter.com", async () => {
		const { harness } = await harnessWith([{ url: TWEET_ON_X, title: "New tweet" }]);

		const readerPoll = await request(harness.server).get(`/view/reader?url=${encodeURIComponent(TWEET_ON_TWITTER)}`);
		const summaryPoll = await request(harness.server).get(`/view/summary?url=${encodeURIComponent(TWEET_ON_TWITTER)}`);

		expect([readerPoll.status, summaryPoll.status]).toEqual([200, 200]);
		expect(readerPoll.text).toContain(encodeURIComponent(TWEET_ON_X));
		expect(readerPoll.text).not.toContain(encodeURIComponent(TWEET_ON_TWITTER));
	});

	it("keeps an x.com link to its own record even when only a twitter.com one exists", async () => {
		const { harness, stubbed } = await harnessWith([{ url: TWEET_ON_TWITTER, title: "Legacy tweet" }]);

		const response = await request(harness.server).get("/view/x.com/jack/status/20");

		expect(response.status).toBe(200);
		expect(stubbed).toEqual([TWEET_ON_X]);
	});

	it("exports the x.com article's epub from a twitter.com link", async () => {
		const { harness, fixture } = await harnessWith([{ url: TWEET_ON_X, title: "New tweet" }]);
		await fixture.articleStore.writeContent({ url: TWEET_ON_X, content: "<p>just setting up my twttr</p>" });

		const response = await request(harness.server)
			.get("/view/twitter.com/jack/status/20?format=epub")
			.buffer(true)
			.parse((res, callback) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => callback(null, Buffer.concat(chunks)));
			});

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("application/epub+zip");
		assert(Buffer.isBuffer(response.body));
		expect(response.body.length).toBeGreaterThan(0);
	});
});
