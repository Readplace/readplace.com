import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { initS3TranscriptFiles } from "./s3-transcript-files";

describe("initS3TranscriptFiles", () => {
	it("writes a local file under the content type it was given", async () => {
		const path = join(await mkdtemp(join(tmpdir(), "s3-transcript-files-")), "rendition.m4a");
		await writeFile(path, "ftypM4A");
		const client = new S3Client({ region: "ap-southeast-2" });
		const sent: unknown[] = [];
		jest.spyOn(client, "send").mockImplementation(async (command: unknown) => {
			assert.ok(command instanceof PutObjectCommand);
			sent.push(command.input);
		});
		const { putTranscriptFile } = initS3TranscriptFiles({ client, bucketName: "hutch-media-test" });

		await putTranscriptFile({ key: "objects/sha256/abc/1", path, contentType: "audio/mp4" });

		assert.deepEqual(sent, [
			{
				Bucket: "hutch-media-test",
				Key: "objects/sha256/abc/1",
				Body: Buffer.from("ftypM4A"),
				ContentType: "audio/mp4",
			},
		]);
	});
});
