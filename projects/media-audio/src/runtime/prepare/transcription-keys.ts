import assert from "node:assert";
import { MediaUploadCommittedEvent } from "@packages/infra-components";
import { type UploadId, UploadIdSchema } from "@packages/media-contracts";
import { z } from "zod";

export const ChargedCommittedDetailSchema =
	MediaUploadCommittedEvent.detailSchema.extend({
		chargedSeconds: z.number().int().positive(),
		chargedDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	});
export type ChargedCommittedDetail = z.infer<
	typeof ChargedCommittedDetailSchema
>;

export const JobRequestSchema = z.object({
	uploadId: z.string(),
	attempt: z.number().int().positive(),
	kind: z.string(),
	url: z.string(),
	userId: MediaUploadCommittedEvent.detailSchema.shape.userId,
	saveAttemptId: MediaUploadCommittedEvent.detailSchema.shape.saveAttemptId,
	fileName: z.string(),
	durationSeconds: z.number().int().positive(),
});
export type JobRequest = z.infer<typeof JobRequestSchema>;

type JobRef = { uploadId: string; attempt: number };

export function transcriptsKeyPrefix(uploadId: string): string {
	return `transcripts/${uploadId}/`;
}

export function transcriptionJobName(ref: JobRef): string {
	return `rp-${ref.uploadId}-${ref.attempt}`;
}

const JOB_NAME_PATTERN = /^rp-([0-9a-f]{32})-([1-9][0-9]*)$/;

export function parseTranscriptionJobName(
	jobName: string,
): { uploadId: UploadId; attempt: number } {
	const match = JOB_NAME_PATTERN.exec(jobName);
	assert(match, `Not a transcription job name: ${jobName}`);
	return { uploadId: UploadIdSchema.parse(match[1]), attempt: Number(match[2]) };
}

export function transcriptionInputKey(
	ref: JobRef & { extension: string },
): string {
	return `${transcriptsKeyPrefix(ref.uploadId)}${ref.attempt}.input.${ref.extension}`;
}

export function jobRequestKey(ref: JobRef): string {
	return `${transcriptsKeyPrefix(ref.uploadId)}${ref.attempt}.request.json`;
}

export function transcriptOutputKey(ref: JobRef): string {
	return `${transcriptsKeyPrefix(ref.uploadId)}${ref.attempt}.json`;
}

export function chargeOf(detail: ChargedCommittedDetail) {
	return {
		userId: detail.userId,
		uploadId: detail.uploadId,
		attempt: detail.attempt,
		seconds: detail.chargedSeconds,
		day: detail.chargedDay,
	};
}
