import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { initDynamoDbPrivateItemMedia } from "@packages/article-store";
import { MediaProcessingFailedEvent, type MediaUploadCommittedDetail, MediaUploadCommittedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { stagedObjectKey } from "@packages/media-contracts";
import { ObjectSha256Schema, type RefObject, type UnrefAllForUpload } from "@packages/media-object-store";
import { z } from "zod";
import type { ProbeMedia } from "../probe/probe-media";
import type { CopyStagedTo, ReadStagedObject } from "../s3/s3-staged-object";
import type { WriteMinimalAudioBody } from "../minimal-body/write-minimal-audio-body";
import { AUDIO_FAILURE_NOTICES } from "./audio-failure-notices";

type PrivateItemMedia = ReturnType<typeof initDynamoDbPrivateItemMedia>;

const CommittedEnvelope = z.object({ time: z.string(), detail: MediaUploadCommittedEvent.detailSchema.extend({ chargedSeconds: z.number().int().positive().optional() }) });

export function initKeepAudioHandler(deps: {
	findArticleMedia: (params: { url: string }) => Promise<{ media?: { fileName: string } } | undefined>;
	readStagedObject: ReadStagedObject;
	copyStagedTo: CopyStagedTo;
	probeMedia: ProbeMedia;
	mediaObjects: { ref: RefObject; unrefAll: UnrefAllForUpload };
	setArticleEnclosure: PrivateItemMedia["setArticleEnclosure"];
	writeMinimalAudioBody: WriteMinimalAudioBody;
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const fail = async (detail: MediaUploadCommittedDetail, reason: "staged-bytes-gone" | "unreadable") => {
		await deps.publishEvent(MediaProcessingFailedEvent, {
			uploadId: detail.uploadId,
			kind: detail.kind,
			url: detail.url,
			saveAttemptId: detail.saveAttemptId,
			attempt: detail.attempt,
			reason,
			notice: AUDIO_FAILURE_NOTICES[reason],
		});
		deps.logger.info("[keep-audio] audio failed", { uploadId: detail.uploadId, reason });
	};

	const release = async (detail: MediaUploadCommittedDetail) => {
		await deps.mediaObjects.unrefAll({ uploadId: detail.uploadId });
		deps.logger.info("[keep-audio] item released while processing", { uploadId: detail.uploadId });
	};

	const keepAudio = async ({ detail, time }: z.infer<typeof CommittedEnvelope>) => {
		const item = await deps.findArticleMedia({ url: detail.url });
		if (item === undefined) return release(detail);
		assert(item.media, `${detail.url} has no media`);
		const stagedKey = stagedObjectKey(detail.uploadId);

		const staged = await deps.readStagedObject({ key: stagedKey, etag: detail.etag });
		if (staged === "staged-bytes-gone") return fail(detail, "staged-bytes-gone");
		const probed = await deps.probeMedia({ body: staged.body, size: staged.contentLength });
		if (probed === "unreadable") return fail(detail, "unreadable");

		const held = await deps.mediaObjects.ref({
			sha256: ObjectSha256Schema.parse(probed.sha256),
			uploadId: detail.uploadId,
			size: staged.contentLength,
			mediaType: probed.mediaType,
			putBytes: (targetKey) => deps.copyStagedTo({ stagedKey, etag: detail.etag, targetKey }),
		});
		const recorded = await deps.setArticleEnclosure({
			url: detail.url,
			enclosure: { object: held.key, mediaType: probed.mediaType, durationSeconds: probed.durationSeconds },
		});
		if (recorded === "not-found") return release(detail);

		if (detail.chargedSeconds !== undefined) {
			deps.logger.info("[keep-audio] audio kept for transcription", { uploadId: detail.uploadId, durationSeconds: probed.durationSeconds });
			return;
		}

		await deps.writeMinimalAudioBody({
			url: detail.url,
			userId: detail.userId,
			saveAttemptId: detail.saveAttemptId,
			title: probed.title,
			fileName: item.media.fileName,
			durationSeconds: probed.durationSeconds,
			time,
		});
		deps.logger.info("[keep-audio] audio kept", {
			uploadId: detail.uploadId,
			bytes: staged.contentLength,
			durationSeconds: probed.durationSeconds,
			mediaType: probed.mediaType,
		});
	};

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				await keepAudio(CommittedEnvelope.parse(JSON.parse(record.body)));
			} catch (error) {
				deps.logger.error("[keep-audio] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
