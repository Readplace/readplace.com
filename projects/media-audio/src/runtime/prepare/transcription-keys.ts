import { MediaUploadCommittedEvent } from "@packages/infra-components";
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
	userId: z.string(),
	saveAttemptId: z.string(),
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
