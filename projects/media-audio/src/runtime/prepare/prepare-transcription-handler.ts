import assert from "node:assert";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import {
	MediaProcessingFailedEvent,
	MediaUploadCommittedEvent,
} from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { stagedObjectKey } from "@packages/media-contracts";
import type { UnrefAllForUpload } from "@packages/media-object-store";
import type {
	MarkTranscriptStarted,
	RefundUnstartedCharge,
} from "@packages/provider-contracts";
import { z } from "zod";
import { AUDIO_FAILURE_NOTICES } from "../keep-audio/audio-failure-notices";
import { type MediaAudioKind, MediaAudioKindSchema } from "../media-audio-kinds";
import type { WriteMinimalAudioBody } from "../minimal-body/write-minimal-audio-body";
import {
	transcriptionInputArgs,
	transcriptionInputExtension,
} from "./ffmpeg-args";
import { firstAudioCodec, type RunFfprobe } from "./run-ffprobe";
import {
	type ChargedCommittedDetail,
	ChargedCommittedDetailSchema,
	chargeOf,
	type JobRequest,
	jobRequestKey,
	transcriptionInputKey,
	transcriptionJobName,
	transcriptOutputKey,
	transcriptsKeyPrefix,
} from "./transcription-keys";

const CommittedEnvelope = z.object({
	time: z.string(),
	detail: MediaUploadCommittedEvent.detailSchema.passthrough(),
});

export type RunFfmpeg = (
	args: string[],
) => Promise<"written" | "staged-bytes-gone">;
export type PrepareStep = (params: {
	detail: ChargedCommittedDetail;
	inputUrl: string;
}) => Promise<"proceed" | "row-gone" | "staged-bytes-gone">;
export type TranscriptionStarted = {
	event: "transcription-started";
	uploadId: string;
	attempt: number;
	chargedSeconds: number;
};
export type StartTranscriptionJob = (params: {
	jobName: string;
	mediaFileKey: string;
	outputKey: string;
}) => Promise<void>;

export function initPrepareTranscriptionHandler(deps: {
	findArticleMedia: (params: {
		url: string;
	}) => Promise<{ media?: { fileName: string } } | undefined>;
	stagedInputUrl: (params: { key: string }) => Promise<string>;
	prepareSteps: Readonly<Record<MediaAudioKind, PrepareStep>>;
	unrefAll: UnrefAllForUpload;
	publishEvent: PublishEvent;
	runFfprobe: RunFfprobe;
	runFfmpeg: RunFfmpeg;
	putTranscriptFile: (params: { key: string; path: string }) => Promise<void>;
	removeTmpFile: (path: string) => Promise<void>;
	putJobRequest: (params: {
		key: string;
		request: JobRequest;
	}) => Promise<void>;
	deletePrefix: (prefix: string) => Promise<void>;
	refundUnstartedCharge: RefundUnstartedCharge;
	markTranscriptStarted: MarkTranscriptStarted;
	startTranscriptionJob: StartTranscriptionJob;
	writeMinimalAudioBody: WriteMinimalAudioBody;
	tmpDir: string;
	startedLog: Logger.Typed<TranscriptionStarted>;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const refundUnstarted = async (
		detail: ChargedCommittedDetail,
	): Promise<"refunded" | "closed"> => {
		const refund = await deps.refundUnstartedCharge(chargeOf(detail));
		assert(
			refund.outcome !== "started",
			`rp-${detail.uploadId}-${detail.attempt} was already started`,
		);
		return refund.outcome;
	};

	const stagedBytesGone = async (
		detail: ChargedCommittedDetail,
		item: { fileName: string },
		time: string,
	) => {
		if ((await refundUnstarted(detail)) === "closed") return;
		await deps.writeMinimalAudioBody({
			url: detail.url,
			userId: detail.userId,
			saveAttemptId: detail.saveAttemptId,
			title: undefined,
			fileName: item.fileName,
			durationSeconds: detail.chargedSeconds,
			time,
		});
	};

	const prepare = async (detail: ChargedCommittedDetail, time: string) => {
		const item = await deps.findArticleMedia({ url: detail.url });
		if (item === undefined) {
			await deps.unrefAll({ uploadId: detail.uploadId });
			await refundUnstarted(detail);
			await deps.deletePrefix(transcriptsKeyPrefix(detail.uploadId));
			return;
		}
		assert(item.media, `${detail.url} has no media`);

		const url = await deps.stagedInputUrl({
			key: stagedObjectKey(detail.uploadId),
		});
		const step = await deps.prepareSteps[
			MediaAudioKindSchema.parse(detail.kind)
		]({ detail, inputUrl: url });
		if (step === "row-gone") {
			await refundUnstarted(detail);
			return;
		}
		if (step === "staged-bytes-gone") {
			await refundUnstarted(detail);
			await deps.publishEvent(MediaProcessingFailedEvent, {
				uploadId: detail.uploadId,
				kind: detail.kind,
				url: detail.url,
				saveAttemptId: detail.saveAttemptId,
				attempt: detail.attempt,
				reason: "staged-bytes-gone",
				notice: AUDIO_FAILURE_NOTICES["staged-bytes-gone"],
			});
			return;
		}
		const probed = await deps.runFfprobe({ url, etag: detail.etag });
		if (probed.outcome === "staged-bytes-gone")
			return stagedBytesGone(detail, item.media, time);
		const codec = firstAudioCodec(probed.streams);
		assert(codec, `${detail.url} has no audio stream`);
		const extension = transcriptionInputExtension(codec);
		const outputPath = `${deps.tmpDir}/${detail.uploadId}-${detail.attempt}.input.${extension}`;
		const written = await deps.runFfmpeg(
			transcriptionInputArgs({
				url,
				etag: detail.etag,
				chargedSeconds: detail.chargedSeconds,
				codec,
				outputPath,
			}),
		);
		if (written === "staged-bytes-gone")
			return stagedBytesGone(detail, item.media, time);
		const mediaFileKey = transcriptionInputKey({
			uploadId: detail.uploadId,
			attempt: detail.attempt,
			extension,
		});
		await deps.putTranscriptFile({ key: mediaFileKey, path: outputPath });
		await deps.removeTmpFile(outputPath);

		await deps.putJobRequest({
			key: jobRequestKey(detail),
			request: {
				uploadId: detail.uploadId,
				attempt: detail.attempt,
				kind: detail.kind,
				url: detail.url,
				userId: detail.userId,
				saveAttemptId: detail.saveAttemptId,
				fileName: item.media.fileName,
				durationSeconds: detail.chargedSeconds,
			},
		});

		const started = await deps.markTranscriptStarted({
			userId: detail.userId,
			uploadId: detail.uploadId,
			attempt: detail.attempt,
		});
		if (started.outcome === "closed") return;

		await deps.startTranscriptionJob({
			jobName: transcriptionJobName(detail),
			mediaFileKey,
			outputKey: transcriptOutputKey(detail),
		});
		deps.startedLog.info({
			event: "transcription-started",
			uploadId: detail.uploadId,
			attempt: detail.attempt,
			chargedSeconds: detail.chargedSeconds,
		});
	};

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = CommittedEnvelope.parse(JSON.parse(record.body));
				const charged = ChargedCommittedDetailSchema.safeParse(envelope.detail);
				if (charged.success) await prepare(charged.data, envelope.time);
				else
					deps.logger.info("[prepare-transcription] upload not charged", {
						uploadId: envelope.detail.uploadId,
					});
			} catch (error) {
				deps.logger.error("[prepare-transcription] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
