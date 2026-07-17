import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { CrawlEmailLinkPreview } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import { EmailLinkOrdinalSchema, type InboxEmailLinkStore } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
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
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { crawlAndFinalize, setLinkOutcome, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const parsed = CrawlEmailLinkPreview.detailSchema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[crawl-email-link-preview] malformed command", {
						messageId: record.messageId,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const userId = UserIdSchema.parse(parsed.data.userId);
				const ordinal = EmailLinkOrdinalSchema.parse(parsed.data.ordinal);
				const { receivedAtMessageId, url } = parsed.data;

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
					continue;
				}
				const failureReason =
					result.status === "not-modified" || result.status === "not-found"
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
			} catch (error) {
				logger.error("[crawl-email-link-preview] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
