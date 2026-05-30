import type { PublishStaleCheckRequested } from "@packages/test-fixtures/providers/events";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("Queue freshness integration", () => {
	it("publishes UpdateFetchTimestamp on first save, then delegates a re-save to the stale-check Lambda with no inline crawl", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const timestampPublished: Parameters<PublishUpdateFetchTimestamp>[0][] = [];
		const staleChecksRequested: Parameters<PublishStaleCheckRequested>[0][] = [];
		let inlineCrawls = 0;

		const harness = useApp({
			...fixture,
			parser: {
				parseArticle: fixture.parser.parseArticle,
				crawlArticle: async (params) => {
					inlineCrawls += 1;
					return fixture.parser.crawlArticle(params);
				},
			},
			events: {
				...fixture.events,
				publishUpdateFetchTimestamp: async (p) => { timestampPublished.push(p); },
				publishStaleCheckRequested: async (p) => { staleChecksRequested.push(p); },
			},
		});
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(timestampPublished).toHaveLength(1);
		expect(timestampPublished[0]).toEqual({
			url: "https://example.com/article",
			contentFetchedAt: expect.any(String),
		});
		expect(staleChecksRequested).toHaveLength(0);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(staleChecksRequested).toEqual([{ url: "https://example.com/article" }]);
		expect(timestampPublished).toHaveLength(1);
		expect(inlineCrawls).toBe(0);
	});
});
