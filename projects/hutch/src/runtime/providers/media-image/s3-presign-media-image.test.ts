import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { MediaImageFileSchema, UploadIdSchema } from "@packages/media-contracts";
import { initS3PresignMediaImage } from "./s3-presign-media-image";

describe("initS3PresignMediaImage", () => {
	const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
	const client = new S3Client({
		region: "ap-southeast-2",
		credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secretexample" },
	});
	const { presignMediaImage } = initS3PresignMediaImage({ client, bucketName: "hutch-media-test" });

	it("signs a one-hour GET of the upload's image key in the given bucket", async () => {
		const file = MediaImageFileSchema.parse(`${"ab".repeat(32)}.png`);

		const signed = new URL(await presignMediaImage({ uploadId, file }));

		assert.equal(signed.hostname, "hutch-media-test.s3.ap-southeast-2.amazonaws.com");
		assert.equal(signed.pathname, `/images/${uploadId}/${file}`);
		assert.equal(signed.searchParams.get("X-Amz-Expires"), "3600");
		assert.equal(signed.searchParams.get("response-content-disposition"), null);
	});

	it("signs an SVG image as an attachment so opening the link directly downloads it", async () => {
		const file = MediaImageFileSchema.parse(`${"ab".repeat(32)}.svg`);

		const signed = new URL(await presignMediaImage({ uploadId, file }));

		assert.equal(signed.pathname, `/images/${uploadId}/${file}`);
		assert.equal(signed.searchParams.get("response-content-disposition"), "attachment");
	});
});
