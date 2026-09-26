import request from "supertest";
import { MinutesSchema } from "@packages/domain/article";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const TWEET_ON_TWITTER = "https://twitter.com/jack/status/20";
const TWEET_ON_X = "https://x.com/jack/status/20";

const useApp = useTestServer();

async function harnessWith(storedUrls: string[]) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	for (const url of storedUrls) {
		await fixture.articleStore.saveArticleGlobally({
			url,
			metadata: { title: url, siteName: new URL(url).hostname, excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(1),
			savedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
	}
	const recrawled: string[] = [];
	const harness = useApp({
		...fixture,
		events: {
			...fixture.events,
			publishRecrawlLinkInitiated: async (params) => {
				recrawled.push(params.url);
			},
		},
	});
	const serviceToken = fixture.admin.recrawlServiceToken;
	return {
		recrawled,
		trigger: (url: string) =>
			request(harness.server)
				.post(`/admin/recrawl?url=${encodeURIComponent(url)}`)
				.set("x-service-token", serviceToken)
				.redirects(0),
		show: (url: string) =>
			request(harness.server).get(`/admin/recrawl?url=${encodeURIComponent(url)}`).set("x-service-token", serviceToken),
		pollReader: (url: string) =>
			request(harness.server)
				.get(`/admin/recrawl/reader?url=${encodeURIComponent(url)}&poll=1`)
				.set("x-service-token", serviceToken),
		pollSummary: (url: string) =>
			request(harness.server)
				.get(`/admin/recrawl/summary?url=${encodeURIComponent(url)}&poll=1`)
				.set("x-service-token", serviceToken),
	};
}

describe("admin recrawl of a tweet by its twitter.com link", () => {
	it("recrawls the x.com article when no twitter.com article exists", async () => {
		const { trigger, recrawled } = await harnessWith([TWEET_ON_X]);

		const response = await trigger(TWEET_ON_TWITTER);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/admin/recrawl?url=${encodeURIComponent(TWEET_ON_X)}&started=1`);
		expect(recrawled).toEqual([TWEET_ON_X]);
	});

	it("recrawls a legacy twitter.com article under its own identity", async () => {
		const { trigger, recrawled } = await harnessWith([TWEET_ON_TWITTER, TWEET_ON_X]);

		await trigger(TWEET_ON_TWITTER);

		expect(recrawled).toEqual([TWEET_ON_TWITTER]);
	});

	it("still refuses a tweet stored under neither host", async () => {
		const { trigger, show, recrawled } = await harnessWith([]);

		expect((await trigger(TWEET_ON_TWITTER)).status).toBe(404);
		expect((await show(TWEET_ON_TWITTER)).status).toBe(404);
		expect(recrawled).toEqual([]);
	});

	it("shows the x.com article's recrawl page for its twitter.com link", async () => {
		const { show } = await harnessWith([TWEET_ON_X]);

		const response = await show(TWEET_ON_TWITTER);

		expect(response.status).toBe(200);
		expect(response.text).toContain(`"/admin/recrawl?url=${encodeURIComponent(TWEET_ON_X)}"`);
		expect(response.text).not.toContain(encodeURIComponent(TWEET_ON_TWITTER));
	});

	it("polls the x.com article for the twitter.com link the canary watches", async () => {
		const { pollReader, pollSummary } = await harnessWith([TWEET_ON_X]);

		const reader = await pollReader(TWEET_ON_TWITTER);
		const summary = await pollSummary(TWEET_ON_TWITTER);

		expect([reader.status, summary.status]).toEqual([200, 200]);
		expect(reader.text).toContain(encodeURIComponent(TWEET_ON_X));
		expect(reader.text).not.toContain(encodeURIComponent(TWEET_ON_TWITTER));
	});

	it("keeps polling a legacy twitter.com article under its own identity", async () => {
		const { pollReader } = await harnessWith([TWEET_ON_TWITTER, TWEET_ON_X]);

		const reader = await pollReader(TWEET_ON_TWITTER);

		expect(reader.text).toContain(encodeURIComponent(TWEET_ON_TWITTER));
	});
});
