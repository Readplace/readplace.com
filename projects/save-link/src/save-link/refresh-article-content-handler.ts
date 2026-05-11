import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DispatchCommand } from "@packages/hutch-infra-components/runtime";
import type { GenerateSummaryCommand } from "@packages/hutch-infra-components";
import { RefreshArticleContentCommand } from "./index";

export type RefreshArticleContent = (params: {
	url: string;
	metadata: {
		title: string;
		siteName: string;
		excerpt: string;
		wordCount: number;
		imageUrl?: string;
	};
	estimatedReadTime: number;
	etag?: string;
	lastModified?: string;
	contentFetchedAt: string;
}) => Promise<void>;

export function initRefreshArticleContentHandler(deps: {
	refreshArticleContent: RefreshArticleContent;
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { refreshArticleContent, dispatchGenerateSummary, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RefreshArticleContentCommand.detailSchema.parse(envelope.detail);

				logger.info("[RefreshArticleContent] processing", { url: detail.url });

				await refreshArticleContent(detail);

				// refreshArticleContent has already reset summaryStatus to pending and
				// cleared the cached summary text, so the worker won't short-circuit
				// on the cache-hit branch in summarizeArticle. Mirrors the
				// recrawl-content-extracted handler's unconditional dispatch.
				await dispatchGenerateSummary({ url: detail.url });

				logger.info("[RefreshArticleContent] completed", { url: detail.url });
			} catch (error) {
				logger.error("[RefreshArticleContent] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
