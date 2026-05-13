import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initArticleCrawlDepBundle } from "./article-crawl";

describe("initArticleCrawlDepBundle", () => {
	it("returns a bundle with markCrawlStage and updateFetchTimestamp fields", () => {
		const bundle = initArticleCrawlDepBundle({
			dynamoClient: createDynamoDocumentClient({ region: "us-east-1" }),
			articlesTable: "articles-table",
		});

		expect(typeof bundle.markCrawlStage).toBe("function");
		expect(typeof bundle.updateFetchTimestamp).toBe("function");
	});
});
