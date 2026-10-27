import { hasEnoughSavesForNextRead } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
	RelatedTargetArticle,
} from "@packages/provider-contracts/related-articles";
import { RelatedArticlesComputedEvent } from "./index";
import type { GatherRelatedCandidatePools } from "./related-articles-candidates";
import type { SelectRelatedArticles } from "./related-articles-selector";

type NextReadTrigger = "content-changed";

export class MetadataNotReadyError extends Error {
	readonly url: string;
	readonly crawlStatus: RelatedTargetArticle["crawlStatus"];
	constructor(params: { url: string; crawlStatus: RelatedTargetArticle["crawlStatus"] }) {
		super(`[ComputeRelatedArticles] article metadata not ready for ${params.url}`);
		this.url = params.url;
		this.crawlStatus = params.crawlStatus;
	}
}

interface NextReadSave {
	userId: UserId;
	url: string;
	receiveCount: number;
	trigger?: NextReadTrigger;
}

interface NextReadSkipDetails {
	crawlStatus: RelatedTargetArticle["crawlStatus"];
	bestScore?: number;
	candidateCount?: number;
	hasSummary?: boolean;
}

type SkipNextRead = (params: {
	save: NextReadSave;
	reason: string;
	details?: NextReadSkipDetails;
}) => Promise<void>;

type ComputeNextRead = (params: {
	save: NextReadSave;
	target: RelatedTargetArticle;
}) => Promise<void>;

const triggerOf = (save: NextReadSave): { trigger?: NextReadTrigger } =>
	save.trigger ? { trigger: save.trigger } : {};

export function initNextReadComputation(deps: {
	gatherRelatedCandidatePools: GatherRelatedCandidatePools;
	selectRelatedArticles: SelectRelatedArticles;
	markRelatedArticlesReady: MarkRelatedArticlesReady;
	markRelatedArticlesSkipped: MarkRelatedArticlesSkipped;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
}): { skipNextRead: SkipNextRead; computeNextRead: ComputeNextRead } {
	const {
		gatherRelatedCandidatePools,
		selectRelatedArticles,
		markRelatedArticlesReady,
		markRelatedArticlesSkipped,
		publishEvent,
		now,
		logger,
	} = deps;

	const skipNextRead: SkipNextRead = async ({ save, reason, details }) => {
		const outcome = await markRelatedArticlesSkipped({
			userId: save.userId,
			url: save.url,
			at: now(),
		});
		if (outcome === "superseded") {
			logger.info("[ComputeRelatedArticles] superseded", { url: save.url, ...triggerOf(save) });
			return;
		}
		await publishEvent(RelatedArticlesComputedEvent, {
			url: save.url,
			userId: save.userId,
			outcome: "skipped",
			relatedCount: 0,
			inputTokens: 0,
			outputTokens: 0,
		});
		logger.info("[ComputeRelatedArticles] skipped", {
			url: save.url,
			reason,
			receiveCount: save.receiveCount,
			...details,
			...triggerOf(save),
		});
	};

	const computeNextRead: ComputeNextRead = async ({ save, target }) => {
		const { crawlStatus } = target;
		const pools = await gatherRelatedCandidatePools({
			userId: save.userId,
			excludeUrl: save.url,
		});
		const candidateCount =
			pools.unreadCandidates.length + pools.readCandidates.length;
		if (!hasEnoughSavesForNextRead(candidateCount)) {
			if (pools.awaitingCrawl > 0) throw new MetadataNotReadyError({ url: save.url, crawlStatus });
			await skipNextRead({ save, reason: "not enough saves to compare against", details: { crawlStatus } });
			return;
		}

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: pools.unreadCandidates,
			readCandidates: pools.readCandidates,
		});
		if (result.kind === "shared-boilerplate") {
			await skipNextRead({
				save,
				reason: "the saved text is a block page shared across sites",
				details: { crawlStatus },
			});
			return;
		}
		if (result.kind === "no-shared-words") {
			await skipNextRead({
				save,
				reason: "no earlier save shares the saved article's words",
				details: {
					crawlStatus,
					bestScore: result.bestScore,
					candidateCount: result.candidateCount,
					hasSummary: target.hasSummary,
				},
			});
			return;
		}
		if (result.kind !== "ready") {
			throw new Error(
				`[ComputeRelatedArticles] ${result.kind satisfies "no-text-block"} for ${save.url}`,
			);
		}

		const outcome = await markRelatedArticlesReady({
			userId: save.userId,
			url: save.url,
			relatedArticles: result.related,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			at: now(),
		});
		if (outcome === "superseded") {
			logger.info("[ComputeRelatedArticles] superseded", { url: save.url, ...triggerOf(save) });
			return;
		}
		await publishEvent(RelatedArticlesComputedEvent, {
			url: save.url,
			userId: save.userId,
			outcome: "ready",
			relatedCount: result.related.length,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
		});
		logger.info("[ComputeRelatedArticles] completed", {
			sampleCount: result.samples.length,
			samples: result.samples,
			agreement: result.agreement,
			url: save.url,
			relatedCount: result.related.length,
			droppedNoSharedWord: result.droppedNoSharedWord,
			droppedReasonNotAboutPick: result.droppedReasonNotAboutPick,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			cacheHitInputTokens: result.cacheHitInputTokens ?? "unknown",
			cacheMissInputTokens: result.cacheMissInputTokens ?? "unknown",
			...triggerOf(save),
		});
	};

	return { skipNextRead, computeNextRead };
}
