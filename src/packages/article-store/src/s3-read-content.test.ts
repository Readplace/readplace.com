import { type GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initS3ReadContent } from "./s3-read-content";
import type { S3GetObject } from "./s3-read-content";

describe("initS3ReadContent", () => {
	const articleId = ArticleResourceUniqueId.parse("https://example.com/article");
	it("does not read S3 when provenance has withheld the content", async () => {
		const send: S3GetObject = async () => { throw new Error("withheld content must not be read"); };
		const provider = initS3ReadContent({ send, readContentLocation: async () => undefined });
		expect(await provider(articleId)).toBeUndefined();
	});
	it("uses the committed pointer's bucket and object", async () => {
		let request: GetObjectCommand | undefined;
		const send: S3GetObject = async (cmd) => { request = cmd; return { Body: { transformToString: async () => "committed" } }; };
		const provider = initS3ReadContent({ send, readContentLocation: async () => ({ bucket: "committed-bucket", key: "immutable.html" }) });
		expect(await provider(articleId)).toBe("committed");
		expect(request?.input).toEqual({ Bucket: "committed-bucket", Key: "immutable.html" });
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
		const provider = initS3ReadContent({ send, readContentLocation: async (id) => ({ bucket: "my-bucket", key: id.toS3ContentKey() }) });

		const content = await provider(articleId);

		expect(content).toBeUndefined();
	});

	it("rethrows non-NoSuchKey errors so the chain logs them", async () => {
		const send: S3GetObject = async () => {
			throw new Error("ThrottlingException");
		};
		const provider = initS3ReadContent({ send, readContentLocation: async (id) => ({ bucket: "my-bucket", key: id.toS3ContentKey() }) });

		await expect(provider(articleId)).rejects.toThrow("ThrottlingException");
	});
});
