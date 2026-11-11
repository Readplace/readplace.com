import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import {
	TierContentExtractedEvent,
	TranscribeJobStateChangedEvent,
} from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type {
	RecordTranscriptOutcome,
	SettleTranscriptCharge,
} from "@packages/provider-contracts";
import {
	candidateProvenance,
	KIND_BY_TIER,
	type PutTierSource,
} from "@packages/tier-source";
import { z } from "zod";
import { audioTitle } from "../keep-audio/audio-body";
import type { WriteMinimalAudioBody } from "../minimal-body/write-minimal-audio-body";
import { transcriptOutputKey } from "../prepare/transcription-keys";
import type { FindReleasedTranscript } from "./find-released-transcript";
import { TranscribeOutputSchema, transcriptHtml } from "./transcript-html";

const TIER = "tier-0";

export const TranscribeJobEnvelopeSchema = z.object({
	time: z.string(),
	detail: TranscribeJobStateChangedEvent.detailSchema,
});

export function initRenderTranscriptHandler(deps: {
	findReleasedTranscript: FindReleasedTranscript;
	readTranscriptOutput: (params: { key: string }) => Promise<unknown>;
	putTierSource: PutTierSource;
	publishEvent: PublishEvent;
	writeMinimalAudioBody: WriteMinimalAudioBody;
	recordTranscriptOutcome: RecordTranscriptOutcome;
	settleTranscriptCharge: SettleTranscriptCharge;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const render = async (
		envelope: z.infer<typeof TranscribeJobEnvelopeSchema>,
	) => {
		const found = await deps.findReleasedTranscript({
			jobName: envelope.detail.TranscriptionJobName,
		});
		if (found.outcome === "released") return;
		const { job, url, request } = found;
		const minimalBody = {
			url,
			userId: request.userId,
			saveAttemptId: request.saveAttemptId,
			title: undefined,
			fileName: request.fileName,
			durationSeconds: request.durationSeconds,
			time: envelope.time,
		};
		if (envelope.detail.TranscriptionJobStatus === "FAILED") {
			await deps.recordTranscriptOutcome({
				url,
				transcript: "transcript-failed",
			});
			await deps.writeMinimalAudioBody(minimalBody);
			await deps.settleTranscriptCharge({ userId: request.userId, ...job });
			deps.logger.error("[render-transcript] transcription job failed", {
				uploadId: job.uploadId,
			});
			return;
		}
		const transcript = transcriptHtml(
			TranscribeOutputSchema.parse(
				await deps.readTranscriptOutput({ key: transcriptOutputKey(job) }),
			),
		);
		if (transcript.wordCount === 0) {
			await deps.recordTranscriptOutcome({ url, transcript: "no-speech" });
			await deps.writeMinimalAudioBody(minimalBody);
		} else {
			const metadata = candidateProvenance({
				metadata: {
					title: audioTitle({ title: undefined, fileName: request.fileName }),
					siteName: "Audio",
					excerpt: transcript.excerpt,
					wordCount: transcript.wordCount,
					estimatedReadTime: Math.ceil(request.durationSeconds / 60),
					authorUserId: request.userId,
				},
				html: transcript.html,
				evaluationHtml: transcript.html,
				attemptId: request.saveAttemptId,
				originalUrl: url,
				sourceUrl: url,
				kind: KIND_BY_TIER[TIER],
				fetchedAt: envelope.time,
			});
			await deps.putTierSource({
				url,
				tier: TIER,
				html: transcript.html,
				evaluationHtml: transcript.html,
				metadata,
			});
			await deps.publishEvent(TierContentExtractedEvent, {
				url,
				saveAttemptId: request.saveAttemptId,
				candidates: [{ id: metadata.id, tier: TIER }],
				userId: request.userId,
				extractedAt: envelope.time,
			});
		}
		await deps.settleTranscriptCharge({ userId: request.userId, ...job });
	};

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				await render(
					TranscribeJobEnvelopeSchema.parse(JSON.parse(record.body)),
				);
			} catch (error) {
				deps.logger.error("[render-transcript] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
