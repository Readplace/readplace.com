import assert from "node:assert/strict";
import { UploadIdSchema } from "@packages/media-contracts";
import { initInMemoryMediaPending } from "@packages/test-fixtures/providers/media-upload-session";
import { initReadPendingTimedDuration } from "./read-pending-timed-duration";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");

describe("initReadPendingTimedDuration", () => {
	it("reads the facts of the whole pending original", async () => {
		const pending = initInMemoryMediaPending({ uploadBaseUrl: "https://s3.test/bucket" });
		pending.receivePendingOriginal({ uploadId, bytes: new Uint8Array(8192).fill(7) });
		const head = await pending.headMediaPendingOriginal({ uploadId });
		assert(head, "the original has arrived");
		const parsedLengths: number[] = [];
		const readTimedDuration = initReadPendingTimedDuration({
			...pending,
			parseTimedMetadata: async (bytes) => {
				parsedLengths.push(bytes.length);
				return { format: { duration: 42, hasAudio: true, hasVideo: false } };
			},
		});

		assert.deepEqual(await readTimedDuration({ uploadId, etag: head.etag }), {
			durationSeconds: 42,
			hasAudio: true,
			hasVideo: false,
		});
		assert.deepEqual(parsedLengths, [8192]);
	});

	it("refuses to read an original that has not arrived", async () => {
		const readTimedDuration = initReadPendingTimedDuration({
			...initInMemoryMediaPending({ uploadBaseUrl: "https://s3.test/bucket" }),
			parseTimedMetadata: async () => ({ format: { duration: 42 } }),
		});

		await assert.rejects(readTimedDuration({ uploadId, etag: '"etag"' }), /no pending original/);
	});
});
