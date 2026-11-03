import assert from "node:assert/strict";
import { MediaProcessingFailedEvent, MediaUploadCommittedEvent } from "./events";

const uploadId = "0123456789abcdef0123456789abcdef";
const committedDetail = {
	uploadId,
	kind: "book",
	url: `https://uploads.readplace.invalid/${uploadId}`,
	userId: "user-1",
	saveAttemptId: "attempt-id-1",
	etag: "etag-1",
	attempt: 1,
};
const failedDetail = {
	uploadId,
	kind: "book",
	url: `https://uploads.readplace.invalid/${uploadId}`,
	saveAttemptId: "attempt-id-1",
	attempt: 1,
	reason: "unreadable",
	notice: "We could not read this file.",
};

function without<T extends object, K extends keyof T>(detail: T, field: K): Omit<T, K> {
	const { [field]: _removed, ...rest } = detail;
	return rest;
}

describe("MediaUploadCommittedEvent", () => {
	it("keeps every field of a committed detail", () => {
		assert.deepEqual(MediaUploadCommittedEvent.detailSchema.parse(committedDetail), committedDetail);
	});

	it("is published from the media source", () => {
		assert.equal(MediaUploadCommittedEvent.source, "hutch.media");
		assert.equal(MediaUploadCommittedEvent.detailType, "MediaUploadCommitted");
	});

	it.each(["uploadId", "saveAttemptId"] as const)("refuses a detail with no %s", (field) => {
		const result = MediaUploadCommittedEvent.detailSchema.safeParse(without(committedDetail, field));

		assert.equal(result.success, false);
	});
});

describe("MediaProcessingFailedEvent", () => {
	it("keeps every field of a failed detail", () => {
		assert.deepEqual(MediaProcessingFailedEvent.detailSchema.parse(failedDetail), failedDetail);
	});

	it("is published from the media source", () => {
		assert.equal(MediaProcessingFailedEvent.source, "hutch.media");
		assert.equal(MediaProcessingFailedEvent.detailType, "MediaProcessingFailed");
	});

	it.each(["uploadId", "saveAttemptId"] as const)("refuses a detail with no %s", (field) => {
		const result = MediaProcessingFailedEvent.detailSchema.safeParse(without(failedDetail, field));

		assert.equal(result.success, false);
	});

	it("refuses a reason outside the media failure reasons", () => {
		const result = MediaProcessingFailedEvent.detailSchema.safeParse({ ...failedDetail, reason: "something-else" });

		assert.equal(result.success, false);
	});
});
