import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { Logger } from "@packages/logger";
import type { SettleTranscriptCharge } from "@packages/provider-contracts";
import type { WriteMinimalAudioBody } from "../minimal-body/write-minimal-audio-body";
import type { FindReleasedTranscript } from "./find-released-transcript";
import { TranscribeJobEnvelopeSchema } from "./render-completed";

export function initRenderTranscriptDlqHandler(deps: {
	findReleasedTranscript: FindReleasedTranscript;
	writeMinimalAudioBody: WriteMinimalAudioBody;
	settleTranscriptCharge: SettleTranscriptCharge;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const keepPlayable = async (body: string) => {
		const envelope = TranscribeJobEnvelopeSchema.parse(JSON.parse(body));
		const found = await deps.findReleasedTranscript({
			jobName: envelope.detail.TranscriptionJobName,
		});
		if (found.outcome === "released") return;
		const { job, url, request } = found;
		await deps.writeMinimalAudioBody({
			url,
			userId: request.userId,
			saveAttemptId: request.saveAttemptId,
			title: undefined,
			fileName: request.fileName,
			durationSeconds: request.durationSeconds,
			time: envelope.time,
		});
		await deps.settleTranscriptCharge({ userId: request.userId, ...job });
		deps.logger.error(
			"[render-transcript-dlq] transcript rendering exhausted",
			{
				uploadId: job.uploadId,
			},
		);
	};

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				await keepPlayable(record.body);
			} catch (error) {
				deps.logger.error("[render-transcript-dlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
