import assert from "node:assert/strict";
import type { PutObjectCommand } from "@aws-sdk/client-s3";
import { MediaImageFileSchema, UploadIdSchema } from "@packages/media-contracts";
import { initPutBookImage } from "./put-book-image";

describe("initPutBookImage", () => {
	it("puts the image under its upload's images prefix with its media type", async () => {
		const sent: PutObjectCommand[] = [];
		const putBookImage = initPutBookImage({
			client: {
				send: async (command) => {
					sent.push(command);
					return {};
				},
			},
			bucketName: "media",
		});
		const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
		const file = MediaImageFileSchema.parse(`${"a".repeat(64)}.png`);
		const bytes = new Uint8Array([1, 2, 3]);

		await putBookImage({ uploadId, file, bytes, contentType: "image/png" });

		assert.deepEqual(
			sent.map((command) => command.input),
			[{ Bucket: "media", Key: `images/${uploadId}/${file}`, Body: bytes, ContentType: "image/png" }],
		);
	});
});
