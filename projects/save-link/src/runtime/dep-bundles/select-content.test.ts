import { S3Client } from "@aws-sdk/client-s3";
import { noopLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initSelectContentDepBundle } from "./select-content";

describe("initSelectContentDepBundle", () => {
	it("returns a bundle with readTierSource, listAvailableTierSources, selectMostCompleteContent, writeCanonicalContent, and findContentSourceTier fields", () => {
		const bundle = initSelectContentDepBundle({
			s3Client: new S3Client({ region: "us-east-1" }),
			dynamoClient: createDynamoDocumentClient({ region: "us-east-1" }),
			contentBucketName: "content-bucket",
			articlesTable: "articles-table",
			createChatCompletion: async () => ({
				choices: [{ message: { content: '{"tier":"tier-0"}' } }],
			}),
			logger: noopLogger,
		});

		expect(typeof bundle.readTierSource).toBe("function");
		expect(typeof bundle.listAvailableTierSources).toBe("function");
		expect(typeof bundle.selectMostCompleteContent).toBe("function");
		expect(typeof bundle.writeCanonicalContent).toBe("function");
		expect(typeof bundle.findContentSourceTier).toBe("function");
	});
});
