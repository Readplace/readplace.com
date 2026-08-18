import { S3Client } from "@aws-sdk/client-s3";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initArticleStoreDepBundle } from "./article-store";
import { initMediaDepBundle } from "./media";
import { initParserDepBundle } from "./parser";

function makeBundle() {
	const parser = initParserDepBundle({
		logError: () => {},
		logInfo: () => {},
		findAdoptedFetchUrl: async () => undefined,
		proxyUrl: undefined,
	});
	const articleStore = initArticleStoreDepBundle({
		s3Client: new S3Client({ region: "us-east-1" }),
		dynamoClient: createDynamoDocumentClient({ region: "us-east-1" }),
		contentBucketName: "content-bucket",
		articlesTable: "articles-table",
	});

	return initMediaDepBundle({
		parser,
		articleStore,
		logError: () => {},
		imagesCdnBaseUrl: "https://cdn.example",
	});
}

describe("initMediaDepBundle", () => {
	it("returns a bundle with downloadMedia and processContent fields", () => {
		const bundle = makeBundle();

		expect(typeof bundle.downloadMedia).toBe("function");
		expect(typeof bundle.processContent).toBe("function");
	});

	it("processContent rewrites in-article media URLs to their downloaded CDN equivalents", async () => {
		const bundle = makeBundle();

		const rewritten = await bundle.processContent({
			html: '<img src="https://origin.example/a.jpg">',
			media: [{ originalUrl: "https://origin.example/a.jpg", cdnUrl: "https://cdn.example/a.jpg" }],
		});

		expect(rewritten).toBe('<img src="https://cdn.example/a.jpg">');
	});
});
