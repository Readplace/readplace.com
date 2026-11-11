import type { SaveAttemptId } from "@packages/domain/article";
import type { CrawlFailureReason, UserId } from "@packages/article-state-types";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { RecrawlContentExtractedEvent, TierContentExtractedEvent } from "@packages/infra-components";
import type { CandidateReference } from "../select-content/list-available-tier-sources";

export type PublishArchiveComparison = (ctx: {
	url: string;
	userId?: UserId;
	recrawl: boolean;
	saveAttemptId: SaveAttemptId;
	candidates: CandidateReference[];
	failureReason?: CrawlFailureReason;
}) => Promise<{ via: "deferred-to-event" }>;

export function initPublishArchiveComparison(deps: { publishEvent: PublishEvent; now: () => Date }): PublishArchiveComparison {
	const { publishEvent, now } = deps;
	return async (ctx) => {
		const detail = {
			url: ctx.url,
			userId: ctx.userId,
			saveAttemptId: ctx.saveAttemptId,
			candidates: ctx.candidates,
			liveAttempt: ctx.failureReason === undefined ? { outcome: "no-body" as const } : { outcome: "no-body" as const, failureReason: ctx.failureReason },
			extractedAt: now().toISOString(),
		};
		if (ctx.recrawl) await publishEvent(RecrawlContentExtractedEvent, detail);
		else await publishEvent(TierContentExtractedEvent, detail);
		return { via: "deferred-to-event" };
	};
}
