import assert from "node:assert/strict";
import type { S3Client } from "@aws-sdk/client-s3";
import { initS3MediaObjects } from "./s3-media-objects";

describe("initS3MediaObjects", () => {
	it("deletes the object key from the media bucket", async () => {
		const sent: { name: string; input: unknown }[] = [];
		const send = async (command: { constructor: { name: string }; input: unknown }) => {
			sent.push({ name: command.constructor.name, input: command.input });
			return {};
		};
		const client: Pick<S3Client, "send"> = { send: send as unknown as S3Client["send"] };

		await initS3MediaObjects({ client, bucketName: "hutch-media-test" }).deleteObject({
			key: `objects/sha256/${"f".repeat(64)}/2`,
		});

		assert.deepEqual(sent, [
			{
				name: "DeleteObjectCommand",
				input: { Bucket: "hutch-media-test", Key: `objects/sha256/${"f".repeat(64)}/2` },
			},
		]);
	});
});
