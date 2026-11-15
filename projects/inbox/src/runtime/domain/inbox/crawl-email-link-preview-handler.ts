import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { CrawlEmailLinkPreview } from "@packages/infra-components";
import { type ChangeVisibility, initRetryingSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { EmailLinkOrdinalSchema, type InboxEmailLinkStore } from "@packages/domain/inbox";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import { toResolvedUrl } from "./to-resolved-url";

const RETRY_SCHEDULE_SECONDS = [60, 600] as const;

const MAX_RECEIVES = RETRY_SCHEDULE_SECONDS.length + 1;

const SETTLED = { kind: "settled" } as const;

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
	getLink: InboxEmailLinkStore["getLink"];
	changeVisibility: ChangeVisibility;
	random: () => number;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { crawlAndFinalize, setLinkOutcome, getLink, changeVisibility, random, logger } = deps;

	return initRetryingSqsRecordHandler({
		definition: CrawlEmailLinkPreview,
		logger,
		failure: { message: "[crawl-email-link-preview] record failed" },
		malformed: { policy: "retry", message: "[crawl-email-link-preview] malformed command" },
		changeVisibility,
		random,
		retryScheduleSeconds: RETRY_SCHEDULE_SECONDS,
		visibilityFailureMessage: "[crawl-email-link-preview] visibility change failed",
		handle: async (detail, { receiveCount }) => {
			const ordinal = EmailLinkOrdinalSchema.parse(detail.ordinal);
			const { userId, receivedAtMessageId, url } = detail;

			if (receiveCount > 1) {
				const link = await getLink({ userId, receivedAtMessageId, ordinal });
				if (link?.status !== "pending") {
					logger.info("[crawl-email-link-preview] redelivery skipped", {
						receivedAtMessageId,
						ordinal,
						receiveCount,
						linkStatus: link?.status ?? "absent",
					});
					return SETTLED;
				}
			}

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
				logger.info("[crawl-email-link-preview] crawled", { receivedAtMessageId, ordinal, receiveCount });
				return SETTLED;
			}
			if (result.status === "failed" && result.decision?.kind === "retryable" && receiveCount < MAX_RECEIVES) {
				logger.info("[crawl-email-link-preview] retry scheduled", {
					receivedAtMessageId,
					ordinal,
					receiveCount,
					scope: result.decision.scope,
				});
				return { kind: "retry-later" };
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
				receiveCount,
			});
			return SETTLED;
		},
	});
}
