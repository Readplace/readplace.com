import assert from "node:assert/strict";
import { MediaFailureReasonSchema } from "@packages/media-contracts";
import {
	MediaInspectedEvent,
	MediaProcessingFailedEvent,
	MediaRejectedEvent,
	ChargedMediaUploadCommittedDetailSchema,
	MediaUploadCommittedEvent,
	MediaUploadStagedEvent,
	TranscribeJobStateChangedEvent,
} from "./events";

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
const stagedDetail = {
	uploadId,
	kind: "book",
	mediaType: "application/epub+zip",
	fileName: "left-hand-of-darkness.epub",
	size: 482113,
	etag: "etag-1",
	stagedAt: "2026-11-06T10:00:00.000Z",
};
const inspectedDetail = {
	uploadId,
	kind: "book",
	facts: {
		kind: "book",
		title: "The Left Hand of Darkness",
		authors: ["Ursula K. Le Guin"],
		sectionTitles: ["A Parade in Erhenrang", "The Place Inside the Blizzard"],
	},
};
const rejectedDetail = {
	uploadId,
	kind: "book",
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

	it("keeps the seconds and day charged for a metered upload", () => {
		const charged = { ...committedDetail, chargedSeconds: 600, chargedDay: "2026-11-09" };

		assert.deepEqual(MediaUploadCommittedEvent.detailSchema.parse(charged), charged);
		assert.deepEqual(ChargedMediaUploadCommittedDetailSchema.parse(charged), charged);
	});

	it("is not a charged upload without the day it was charged on", () => {
		const undated = { ...committedDetail, chargedSeconds: 600 };

		assert.equal(ChargedMediaUploadCommittedDetailSchema.safeParse(undated).success, false);
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

describe("MediaUploadStagedEvent", () => {
	it("keeps every field of a staged detail", () => {
		assert.deepEqual(MediaUploadStagedEvent.detailSchema.parse(stagedDetail), stagedDetail);
	});

	it("is published from the media source", () => {
		assert.equal(MediaUploadStagedEvent.source, "hutch.media");
		assert.equal(MediaUploadStagedEvent.detailType, "MediaUploadStaged");
	});

	it("refuses a detail with an empty etag", () => {
		const result = MediaUploadStagedEvent.detailSchema.safeParse({ ...stagedDetail, etag: "" });

		assert.equal(result.success, false);
	});

	it.each(["uploadId", "kind", "mediaType", "fileName", "size", "etag", "stagedAt"] as const)("refuses a detail with no %s", (field) => {
		const result = MediaUploadStagedEvent.detailSchema.safeParse(without(stagedDetail, field));

		assert.equal(result.success, false);
	});

	it("refuses a size of zero", () => {
		const result = MediaUploadStagedEvent.detailSchema.safeParse({ ...stagedDetail, size: 0 });

		assert.equal(result.success, false);
	});
});

describe("MediaInspectedEvent", () => {
	it("keeps a book's inspection facts", () => {
		assert.deepEqual(MediaInspectedEvent.detailSchema.parse(inspectedDetail), inspectedDetail);
	});

	it("is published from the media source", () => {
		assert.equal(MediaInspectedEvent.source, "hutch.media");
		assert.equal(MediaInspectedEvent.detailType, "MediaInspected");
	});

	it("refuses facts with no section titles", () => {
		const { sectionTitles: _removed, ...facts } = inspectedDetail.facts;
		const result = MediaInspectedEvent.detailSchema.safeParse({ ...inspectedDetail, facts });

		assert.equal(result.success, false);
	});
});

describe("MediaRejectedEvent", () => {
	it("keeps every field of a rejected detail", () => {
		assert.deepEqual(MediaRejectedEvent.detailSchema.parse(rejectedDetail), rejectedDetail);
	});

	it("is published from the media source", () => {
		assert.equal(MediaRejectedEvent.source, "hutch.media");
		assert.equal(MediaRejectedEvent.detailType, "MediaRejected");
	});

	it.each(MediaFailureReasonSchema.options)("keeps the %s reason", (reason) => {
		assert.equal(MediaRejectedEvent.detailSchema.parse({ ...rejectedDetail, reason }).reason, reason);
	});

	it("refuses a reason outside the failure reasons", () => {
		const result = MediaRejectedEvent.detailSchema.safeParse({ ...rejectedDetail, reason: "something-else" });

		assert.equal(result.success, false);
	});

	it("refuses a detail with an empty notice", () => {
		const result = MediaRejectedEvent.detailSchema.safeParse({ ...rejectedDetail, notice: "" });

		assert.equal(result.success, false);
	});
});

describe("TranscribeJobStateChangedEvent", () => {
	const completedDetail = { TranscriptionJobName: `rp-${uploadId}-1`, TranscriptionJobStatus: "COMPLETED" };

	it("is named for the rules that subscribe to it", () => {
		assert.equal(TranscribeJobStateChangedEvent.name, "transcribe-job-state-changed");
	});

	it("is published by Amazon Transcribe", () => {
		assert.equal(TranscribeJobStateChangedEvent.source, "aws.transcribe");
		assert.equal(TranscribeJobStateChangedEvent.detailType, "Transcribe Job State Change");
	});

	it("keeps the job name and status of a finished job", () => {
		assert.deepEqual(TranscribeJobStateChangedEvent.detailSchema.parse(completedDetail), completedDetail);
	});

	it("refuses a status other than completed or failed", () => {
		const result = TranscribeJobStateChangedEvent.detailSchema.safeParse({ ...completedDetail, TranscriptionJobStatus: "IN_PROGRESS" });

		assert.equal(result.success, false);
	});
});
