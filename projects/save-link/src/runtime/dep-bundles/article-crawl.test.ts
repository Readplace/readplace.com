import { noopLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initArticleCrawlDepBundle } from "./article-crawl";

describe("initArticleCrawlDepBundle", () => {
	it("returns a bundle with markCrawlStage, markCrawlProgress, markCrawlPartial and updateFetchTimestamp fields", () => {
		const bundle = initArticleCrawlDepBundle({
			dynamoClient: createDynamoDocumentClient({ region: "us-east-1" }),
			articlesTable: "articles-table",
			logger: noopLogger,
		});

		expect(typeof bundle.markCrawlStage).toBe("function");
		expect(typeof bundle.markCrawlProgress).toBe("function");
		expect(typeof bundle.markCrawlPartial).toBe("function");
		expect(typeof bundle.updateFetchTimestamp).toBe("function");
	});
});
