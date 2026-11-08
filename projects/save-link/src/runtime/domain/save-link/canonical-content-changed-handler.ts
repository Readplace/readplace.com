import assert from "node:assert";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import {
	isCanonicalCandidateRevoked,
	isSummarySettledForCanonical,
	type LoadArticle,
} from "@packages/domain/article-aggregate";
import { CanonicalContentChangedEvent, type GenerateSummaryCommand } from "@packages/infra-components";
import { type DispatchCommand, initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { FindArticleContent } from "./article-content.types";

export function initCanonicalContentChangedHandler(deps: {
	loadArticle: LoadArticle;
	findArticleContent: FindArticleContent;
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { loadArticle, findArticleContent, dispatchGenerateSummary, logger } = deps;

	return initSqsRecordHandler({
		definition: CanonicalContentChangedEvent,
		logger,
		failure: { message: "[CanonicalContentChanged] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const article = await loadArticle(detail.url);
			assert(article, `article row not found for url=${detail.url}`);
			if (isSummarySettledForCanonical(article)) {
				logger.info("[CanonicalContentChanged] nothing to regenerate", { url: detail.url, outcome: "summary-settled" });
				return;
			}

			const content = await findArticleContent(detail.url);
			const crawlEnded = article.crawl.kind === "failed" || article.crawl.kind === "unsupported";
			assert(content || (crawlEnded && !isCanonicalCandidateRevoked(article.contentSelection)), `canonical content not yet readable for url=${detail.url}`);

			await dispatchGenerateSummary({ url: detail.url });
			logger.info("[CanonicalContentChanged] re-primed summary", { url: detail.url });
		},
	});
}
