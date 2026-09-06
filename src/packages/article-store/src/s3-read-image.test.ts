import { type GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initS3ReadArticleImage } from "./s3-read-image";
import type { S3GetImageObject } from "./s3-read-image";

describe("initS3ReadArticleImage", () => {
	const url = "https://example.com/article";
	const filename = "abcdef0123456789.jpg";

	it("returns the object body bytes for an existing key", async () => {
		const send: S3GetImageObject = async () => ({
			Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
		});
		const provider = initS3ReadArticleImage({ send, bucketName: "my-bucket" });

		const bytes = await provider({ url, filename });

		expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("returns undefined when S3 throws NoSuchKey", async () => {
		const send: S3GetImageObject = async () => {
			throw new NoSuchKey({ message: "The specified key does not exist.", $metadata: {} });
		};
		const provider = initS3ReadArticleImage({ send, bucketName: "my-bucket" });

		expect(await provider({ url, filename })).toBeUndefined();
	});

	it("rethrows non-NoSuchKey errors", async () => {
		const send: S3GetImageObject = async () => {
			throw new Error("ThrottlingException");
		};
		const provider = initS3ReadArticleImage({ send, bucketName: "my-bucket" });

		await expect(provider({ url, filename })).rejects.toThrow("ThrottlingException");
	});

	it("forwards the bucket name and the article image S3 key", async () => {
		const calls: GetObjectCommand[] = [];
		const send: S3GetImageObject = async (cmd) => {
			calls.push(cmd);
			return { Body: { transformToByteArray: async () => new Uint8Array([0]) } };
		};
		const provider = initS3ReadArticleImage({ send, bucketName: "my-bucket" });

		await provider({ url, filename });

		expect(calls).toHaveLength(1);
		expect(calls[0].input.Bucket).toBe("my-bucket");
		expect(calls[0].input.Key).toBe(ArticleResourceUniqueId.parse(url).toS3ImageKey(filename));
	});
});
