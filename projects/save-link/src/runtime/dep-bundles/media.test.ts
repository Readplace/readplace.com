import { S3Client } from "@aws-sdk/client-s3";
import { noopLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initArticleStoreDepBundle } from "./article-store";
import { initMediaDepBundle } from "./media";
import { initParserDepBundle } from "./parser";

describe("initMediaDepBundle", () => {
	it("returns a bundle with downloadMedia and processContent fields", () => {
		const parser = initParserDepBundle({
			logError: () => {},
		});
		const articleStore = initArticleStoreDepBundle({
			s3Client: new S3Client({ region: "us-east-1" }),
			dynamoClient: createDynamoDocumentClient({ region: "us-east-1" }),
			contentBucketName: "content-bucket",
			articlesTable: "articles-table",
		});

		const bundle = initMediaDepBundle({
			parser,
			articleStore,
			logger: noopLogger,
			imagesCdnBaseUrl: "https://cdn.example",
		});

		expect(typeof bundle.downloadMedia).toBe("function");
		expect(typeof bundle.processContent).toBe("function");
	});
});
