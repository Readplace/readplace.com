import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { CrawlEmailLinkPreview } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { EmailLinkOrdinalSchema, type InboxEmailLinkStore } from "@packages/domain/inbox";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import { toResolvedUrl } from "./to-resolved-url";

/**
 * Consumes one `CrawlEmailLinkPreview` per message and crawls a preview of the
 * single URL WITHOUT saving it to the reading queue: it keeps only the metadata
 * and discards the article body, so nothing lands in the articles / user-articles
 * tables. A dead/blocked/paywalled link is an expected `failed` preview (the SQS
 * record is ACKed); only a genuine store-write fault or a malformed envelope
 * fails the record to its DLQ. The SSRF guard is inherited from
 * `crawlAndFinalize`, which fails closed on localhost/metadata/private-range URLs
 * before any network call.
 */
export function initCrawlEmailLinkPreviewHandler(deps: {
	crawlAndFinalize: CrawlAndFinalizeArticle;
	setLinkOutcome: InboxEmailLinkStore["setLinkOutcome"];
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { crawlAndFinalize, setLinkOutcome, logger } = deps;

	return initSqsRecordHandler({
		definition: CrawlEmailLinkPreview,
		logger,
		failure: { message: "[crawl-email-link-preview] record failed" },
		malformed: { policy: "retry", message: "[crawl-email-link-preview] malformed command" },
		handle: async (detail) => {
			const ordinal = EmailLinkOrdinalSchema.parse(detail.ordinal);
			const { userId, receivedAtMessageId, url } = detail;

			const result = await crawlAndFinalize({ url });
			if (result.status === "fetched") {
				const { metadata } = result.article;
				await setLinkOutcome({
					userId,
					receivedAtMessageId,
					ordinal,
					outcome: {
						status: "crawled",
						title: metadata.title,
						excerpt: metadata.excerpt,
						siteName: metadata.siteName,
						imageUrl: metadata.imageUrl,
						resolvedUrl: toResolvedUrl({ url, finalUrl: result.finalUrl }),
					},
				});
				logger.info("[crawl-email-link-preview] crawled", { receivedAtMessageId, ordinal });
				return;
			}
			const failureReason =
				result.status === "not-modified" ||
				result.status === "not-found" ||
				result.status === "blocked"
					? result.status
					: result.reason;
			await setLinkOutcome({
				userId,
				receivedAtMessageId,
				ordinal,
				outcome: { status: "failed", failureReason },
			});
			logger.info("[crawl-email-link-preview] preview unavailable", {
				receivedAtMessageId,
				ordinal,
				failureReason,
			});
		},
	});
}
