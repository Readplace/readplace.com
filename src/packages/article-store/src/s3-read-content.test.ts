import { type GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initS3ReadContent } from "./s3-read-content";
import type { S3GetObject } from "./s3-read-content";

describe("initS3ReadContent", () => {
	const articleId = ArticleResourceUniqueId.parse("https://example.com/article");

	it("returns the object body for an existing key", async () => {
		const send: S3GetObject = async () => ({
			Body: { transformToString: async () => "hello world" },
		});
		const provider = initS3ReadContent({ send, bucketName: "my-bucket" });

		const content = await provider(articleId);

		expect(content).toBe("hello world");
	});

	it("returns undefined when S3 throws NoSuchKey", async () => {
		// S3 GetObject throws NoSuchKey when the key isn't there. That is the *expected*
		// outcome for any URL that hasn't been crawled yet — the read-article-content
		// provider chain depends on us returning undefined for that case so it can fall
		// through to the next store (and ultimately to an on-demand crawl) without
		// surfacing a fake error in CloudWatch. Real S3 failures (throttling, network,
		// IAM) keep throwing.
		const send: S3GetObject = async () => {
			throw new NoSuchKey({ message: "The specified key does not exist.", $metadata: {} });
		};
		const provider = initS3ReadContent({ send, bucketName: "my-bucket" });

		const content = await provider(articleId);

		expect(content).toBeUndefined();
	});

	it("rethrows non-NoSuchKey errors so the chain logs them", async () => {
		const send: S3GetObject = async () => {
			throw new Error("ThrottlingException");
		};
		const provider = initS3ReadContent({ send, bucketName: "my-bucket" });

		await expect(provider(articleId)).rejects.toThrow("ThrottlingException");
	});

	it("forwards the bucket name and S3 key", async () => {
		const calls: GetObjectCommand[] = [];
		const send: S3GetObject = async (cmd) => {
			calls.push(cmd);
			return { Body: { transformToString: async () => "ignored" } };
		};
		const provider = initS3ReadContent({ send, bucketName: "my-bucket" });

		await provider(articleId);

		expect(calls).toHaveLength(1);
		expect(calls[0].input.Bucket).toBe("my-bucket");
		expect(calls[0].input.Key).toBe(articleId.toS3ContentKey());
	});
});
