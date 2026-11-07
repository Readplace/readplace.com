import {
	type MediaUploadCommittedDetail,
	TierContentExtractedEvent,
} from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import {
	candidateProvenance,
	KIND_BY_TIER,
	type PutTierSource,
} from "@packages/tier-source";
import { buildAudioBody } from "../keep-audio/audio-body";

const TIER = "tier-0";

export type WriteMinimalAudioBody = (params: {
	url: string;
	userId: MediaUploadCommittedDetail["userId"];
	saveAttemptId: MediaUploadCommittedDetail["saveAttemptId"];
	title: string | undefined;
	fileName: string;
	durationSeconds: number;
	notice?: string;
	time: string;
}) => Promise<void>;

export function initWriteMinimalAudioBody(deps: {
	putTierSource: PutTierSource;
	publishEvent: PublishEvent;
}): WriteMinimalAudioBody {
	return async (params) => {
		const minutes = Math.ceil(params.durationSeconds / 60);
		const body = buildAudioBody({
			title: params.title,
			fileName: params.fileName,
			minutes,
			notice: params.notice,
		});
		const metadata = candidateProvenance({
			metadata: {
				title: body.title,
				siteName: "Audio",
				excerpt: body.excerpt,
				wordCount: body.wordCount,
				estimatedReadTime: minutes,
				authorUserId: params.userId,
			},
			html: body.html,
			evaluationHtml: body.html,
			attemptId: params.saveAttemptId,
			originalUrl: params.url,
			sourceUrl: params.url,
			kind: KIND_BY_TIER[TIER],
			fetchedAt: params.time,
		});
		await deps.putTierSource({
			url: params.url,
			tier: TIER,
			html: body.html,
			evaluationHtml: body.html,
			metadata,
		});
		await deps.publishEvent(TierContentExtractedEvent, {
			url: params.url,
			saveAttemptId: params.saveAttemptId,
			candidates: [{ id: metadata.id, tier: TIER }],
			userId: params.userId,
			extractedAt: params.time,
		});
	};
}
