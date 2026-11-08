import { Logger, noopLogger } from "@packages/logger";
import type { RecordTranscriptOutcome } from "@packages/provider-contracts";
import {
	type JobRequest,
	JobRequestSchema,
} from "../prepare/transcription-keys";
import {
	type FindArticleMedia,
	initFindReleasedTranscript,
} from "./find-released-transcript";

export const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
export const ITEM_URL = `https://uploads.readplace.invalid/${UPLOAD_ID}`;
export const JOB_NAME = `rp-${UPLOAD_ID}-2`;
export const EVENT_TIME = "2026-11-06T09:30:00Z";
export const SETTLE_REF = { userId: "user-1", uploadId: UPLOAD_ID, attempt: 2 };
export const SIDECAR: JobRequest = JobRequestSchema.parse({
	uploadId: UPLOAD_ID,
	attempt: 2,
	kind: "audio",
	url: ITEM_URL,
	userId: "user-1",
	saveAttemptId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
	fileName: "episode-12.mp3",
	durationSeconds: 400,
});

export type ArticleRow = "present" | "gone" | "tombstoned";

export function recordedReleaseCheck(overrides: {
	sidecar?: "gone";
	articleRow?: ArticleRow;
}) {
	const calls: [string, unknown][] = [];
	const record = <T>(name: string, arg: unknown, answer: T): T => {
		calls.push([name, arg]);
		return answer;
	};
	const articleRow = overrides.articleRow ?? "present";
	const findArticleMedia: FindArticleMedia = async (params) =>
		record(
			"findArticleMedia",
			params,
			articleRow === "present"
				? { media: { fileName: "episode-12.mp3" } }
				: articleRow === "tombstoned"
					? {}
					: undefined,
		);
	const recordTranscriptOutcome: RecordTranscriptOutcome = async (params) =>
		record("recordTranscriptOutcome", params, "recorded" as const);
	const settleTranscriptCharge = async (params: unknown) =>
		record("settle", params, { outcome: "done" as const });
	const findReleasedTranscript = initFindReleasedTranscript({
		readJobRequest: async (params) =>
			record(
				"readJobRequest",
				params,
				overrides.sidecar === "gone" ? undefined : SIDECAR,
			),
		findArticleMedia,
		settleTranscriptCharge,
		deletePrefix: async (prefix) => record("deletePrefix", prefix, undefined),
	});
	return {
		calls,
		record,
		findReleasedTranscript,
		recordTranscriptOutcome,
		settleTranscriptCharge,
		logger: Logger.from(noopLogger),
	};
}

export function jobEventBody(status: "COMPLETED" | "FAILED"): string {
	return JSON.stringify({
		time: EVENT_TIME,
		detail: {
			TranscriptionJobName: JOB_NAME,
			TranscriptionJobStatus: status,
		},
	});
}
