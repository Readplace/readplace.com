import { S3Client } from "@aws-sdk/client-s3";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initArticleStoreDepBundle } from "./article-store";

describe("initArticleStoreDepBundle", () => {
	it("returns a bundle with putTierSource, putImageObject, checkTier0SourceExists, readArticleCrawlState, and readTierSnapshot fields", () => {
		const bundle = initArticleStoreDepBundle({
			s3Client: new S3Client({ region: "us-east-1" }),
			dynamoClient: createDynamoDocumentClient({ region: "us-east-1" }),
			contentBucketName: "content-bucket",
			articlesTable: "articles-table",
		});

		expect(typeof bundle.putTierSource).toBe("function");
		expect(typeof bundle.putImageObject).toBe("function");
		expect(typeof bundle.checkTier0SourceExists).toBe("function");
		expect(typeof bundle.readArticleCrawlState).toBe("function");
		expect(typeof bundle.readTierSnapshot).toBe("function");
	});
});
