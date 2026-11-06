import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import assert from "node:assert";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import {
	RecrawlLinkInitiatedEvent,
	RecrawlContentExtractedEvent,
} from "@packages/infra-components";
import type { PrepareArticleIdentity } from "@packages/save-article";
import { ClassifiedCrawlError, logRecordFailure } from "./save-link-work";
import { initRunCrawlFromTier1, type RunCrawlFromTier1Deps } from "./run-crawl-from-tier1";

export function initRecrawlLinkInitiatedHandler(deps: RunCrawlFromTier1Deps & {
	prepareArticleIdentity: PrepareArticleIdentity;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;
	const logPrefix = "[RecrawlLinkInitiated]";

	const runCrawlFromTier1 = initRunCrawlFromTier1({ ...deps, logPrefix });

	return initSqsRecordHandler({
		definition: RecrawlLinkInitiatedEvent,
		logger,
		failure: { report: ({ record, error }) => logRecordFailure({ logger, logPrefix, record, error }) },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { saveAttemptId } = detail;

			logger.info("[RecrawlLinkInitiated] processing", { url: detail.url });
			const identity = await deps.prepareArticleIdentity(detail.url);
			assert(identity.status === "resolved", "recrawl original identity is unresolved");

			try {
				const extracted = await runCrawlFromTier1({ url: detail.url, saveAttemptId, recrawl: true, sourceOriginalUrl: identity.sourceOriginalUrl });
				if (extracted === undefined) return;

				await publishEvent(RecrawlContentExtractedEvent, {
					url: detail.url,
					saveAttemptId,
					...extracted,
					extractedAt: deps.now().toISOString(),
				});
				logger.info("[RecrawlLinkInitiated] emitted RecrawlContentExtractedEvent", {
					url: detail.url,
				});
			} catch (error) {
				if (!(error instanceof ClassifiedCrawlError)) throw error;
				logger.warn(`${logPrefix} crawl failed — terminalising in-process`, {
					url: detail.url,
					error: String(error),
				});
				await deps.transitionAndPersist(markCrawlExhausted, {
					url: detail.url,
					input: {
						reason: error.crawlFailureReason,
						receiveCount: record.receiveCount,
					},
				});
			}
		},
	});
}
