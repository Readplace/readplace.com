import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import {
	type LoadArticle,
	type TransitionAndPersist,
	markCrawlExhausted,
	markSummaryPending,
} from "@packages/domain/article-aggregate";
import { ResolveArticleOnViewCommand, TierContentExtractedEvent } from "@packages/infra-components";
import { ClassifiedCrawlError, logRecordFailure } from "../save-link/save-link-work";
import type { RunCrawlFromTier1 } from "../save-link/run-crawl-from-tier1";

const logPrefix = "[ResolveOnView]";

export function initResolveArticleOnViewHandler(deps: {
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	runCrawlFromTier1: RunCrawlFromTier1;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { logger } = deps;

	return initSqsRecordHandler({
		definition: ResolveArticleOnViewCommand,
		logger,
		failure: { report: ({ record, error }) => logRecordFailure({ logger, logPrefix, record, error }) },
		malformed: { policy: "retry" },
		handle: async ({ url, saveAttemptId, axes, surface }, record) => {
			logger.info(`${logPrefix} dispatched`, { url, surface, axes });

			const article = await deps.loadArticle(url);
			const pendingAxis = axes === "summary" ? article?.summary.kind : article?.crawl.kind;
			if (pendingAxis !== "pending") {
				logger.info(`${logPrefix} row moved on — nothing to resolve`, { url, axes });
				return;
			}

			if (axes === "summary") {
				await deps.transitionAndPersist(markSummaryPending, { url, input: { now: deps.now().toISOString() } });
				return;
			}

			try {
				const extracted = await deps.runCrawlFromTier1({ url, saveAttemptId, recrawl: false, sourceOriginalUrl: undefined });
				if (extracted === undefined) return;
				await deps.publishEvent(TierContentExtractedEvent, {
					url,
					saveAttemptId,
					...extracted,
					extractedAt: deps.now().toISOString(),
				});
				logger.info(`${logPrefix} emitted TierContentExtractedEvent`, { url });
			} catch (error) {
				if (!(error instanceof ClassifiedCrawlError)) throw error;
				logger.warn(`${logPrefix} crawl failed — terminalising in-process`, { url, error: String(error) });
				const receiveCount = record.receiveCount;
				await deps.transitionAndPersist(markCrawlExhausted, {
					url,
					input: { reason: error.crawlFailureReason, receiveCount },
				});
			}
		},
	});
}
