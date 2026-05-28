import { S3Client } from "@aws-sdk/client-s3";
import { noopLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initArticleStoreDepBundle } from "./article-store";
import { initCrawlAndFinalizeDepBundle } from "./crawl-and-finalize";
import { initMediaDepBundle } from "./media";
import { initParserDepBundle } from "./parser";

describe("initCrawlAndFinalizeDepBundle", () => {
	it("returns a bundle with finalizeArticle and crawlAndFinalizeArticle fields", () => {
		const parser = initParserDepBundle({ logError: () => {} });
		const articleStore = initArticleStoreDepBundle({
			s3Client: new S3Client({ region: "us-east-1" }),
			dynamoClient: createDynamoDocumentClient({ region: "us-east-1" }),
			contentBucketName: "content-bucket",
			articlesTable: "articles-table",
		});
		const media = initMediaDepBundle({
			parser,
			articleStore,
			logger: noopLogger,
			imagesCdnBaseUrl: "https://cdn.example",
		});

		const bundle = initCrawlAndFinalizeDepBundle({
			parser,
			media,
			articleStore,
			imagesCdnBaseUrl: "https://cdn.example",
			logError: () => {},
		});

		expect(typeof bundle.finalizeArticle).toBe("function");
		expect(typeof bundle.crawlAndFinalizeArticle).toBe("function");
	});
});
