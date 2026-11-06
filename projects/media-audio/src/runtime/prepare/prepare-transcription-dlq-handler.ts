import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { MediaUploadCommittedEvent } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { RefundTranscriptCharge } from "@packages/provider-contracts";
import { z } from "zod";
import type { WriteMinimalAudioBody } from "../minimal-body/write-minimal-audio-body";
import {
	type ChargedCommittedDetail,
	ChargedCommittedDetailSchema,
	chargeOf,
	type JobRequest,
	jobRequestKey,
	transcriptionJobName,
	transcriptsKeyPrefix,
} from "./transcription-keys";

const CommittedEnvelope = z.object({
	time: z.string(),
	detail: MediaUploadCommittedEvent.detailSchema.passthrough(),
});

export function initPrepareTranscriptionDlqHandler(deps: {
	getTranscriptionJob: (params: {
		jobName: string;
	}) => Promise<"found" | "not-found">;
	findArticleMedia: (params: {
		url: string;
	}) => Promise<{ media?: { fileName: string } } | undefined>;
	refundTranscriptCharge: RefundTranscriptCharge;
	readJobRequest: (params: { key: string }) => Promise<JobRequest | undefined>;
	deletePrefix: (prefix: string) => Promise<void>;
	writeMinimalAudioBody: WriteMinimalAudioBody;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const settleExhausted = async (
		detail: ChargedCommittedDetail,
		time: string,
	) => {
		if (
			(await deps.getTranscriptionJob({
				jobName: transcriptionJobName(detail),
			})) === "found"
		)
			return;
		const item = await deps.findArticleMedia({ url: detail.url });
		await deps.refundTranscriptCharge(chargeOf(detail));
		if (item?.media === undefined) {
			await deps.deletePrefix(transcriptsKeyPrefix(detail.uploadId));
			return;
		}
		const request = await deps.readJobRequest({ key: jobRequestKey(detail) });
		await deps.writeMinimalAudioBody({
			url: detail.url,
			userId: detail.userId,
			saveAttemptId: detail.saveAttemptId,
			title: undefined,
			fileName: request?.fileName ?? item.media.fileName,
			durationSeconds: request?.durationSeconds ?? detail.chargedSeconds,
			time,
		});
		deps.logger.error(
			"[prepare-transcription-dlq] transcription preparation exhausted",
			{ uploadId: detail.uploadId },
		);
	};

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = CommittedEnvelope.parse(JSON.parse(record.body));
				const charged = ChargedCommittedDetailSchema.safeParse(envelope.detail);
				if (charged.success) await settleExhausted(charged.data, envelope.time);
			} catch (error) {
				deps.logger.error("[prepare-transcription-dlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
