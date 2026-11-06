import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { EnclosureSchema } from "@packages/media-contracts";
import { initS3PresignEnclosure } from "./s3-presign-enclosure";

describe("initS3PresignEnclosure", () => {
	it("signs a one-hour GET of the enclosure's object that answers with its media type", async () => {
		const enclosure = EnclosureSchema.parse({
			object: `objects/sha256/${"0123456789abcdef".repeat(4)}/1`,
			mediaType: "audio/mp4",
			durationSeconds: 2820,
		});
		const client = new S3Client({
			region: "ap-southeast-2",
			credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secretexample" },
		});
		const { presignEnclosure } = initS3PresignEnclosure({ client, bucketName: "hutch-media-test" });

		const signed = new URL(await presignEnclosure({ object: enclosure.object, mediaType: enclosure.mediaType }));

		assert.equal(signed.hostname, "hutch-media-test.s3.ap-southeast-2.amazonaws.com");
		assert.equal(signed.pathname, `/${enclosure.object}`);
		assert.equal(signed.searchParams.get("X-Amz-Expires"), "3600");
		assert.equal(signed.searchParams.get("response-content-type"), "audio/mp4");
	});
});
