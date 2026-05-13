import type { HutchLogger } from "@packages/hutch-logger";
import { RefreshContentExtractedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import { RefreshArticleContentCommand } from "./index";

/**
 * Refresh now goes through the same shape as the initial save → recrawl:
 *
 *   1. Write the freshly-fetched HTML as a tier-1 source.
 *   2. Publish RefreshContentExtractedEvent.
 *   3. refresh-content-extracted-handler runs the selector over all
 *      available tier sources (tier-0 from the extension if present, plus
 *      the just-written tier-1), picks the winner, and calls refreshContent.
 *
 * The selector step lets the row keep a tier-0 win instead of silently
 * flipping to tier-1 just because refresh always fetches server-side.
 */
export function initRefreshArticleContentHandler(deps: {
	putTierSource: PutTierSource;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { putTierSource, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RefreshArticleContentCommand.detailSchema.parse(envelope.detail);

				logger.info("[RefreshArticleContent] processing", { url: detail.url });

				await putTierSource({
					url: detail.url,
					tier: "tier-1",
					html: detail.html,
					metadata: {
						title: detail.metadata.title,
						siteName: detail.metadata.siteName,
						excerpt: detail.metadata.excerpt,
						wordCount: detail.metadata.wordCount,
						imageUrl: detail.metadata.imageUrl,
						estimatedReadTime: detail.estimatedReadTime,
					},
				});

				await publishEvent({
					source: RefreshContentExtractedEvent.source,
					detailType: RefreshContentExtractedEvent.detailType,
					detail: JSON.stringify({
						url: detail.url,
						etag: detail.etag,
						lastModified: detail.lastModified,
						contentFetchedAt: detail.contentFetchedAt,
					}),
				});

				logger.info("[RefreshArticleContent] tier-1 source written + event published", {
					url: detail.url,
				});
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
