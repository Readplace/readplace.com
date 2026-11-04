import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { CrawlEmailLinkPreview } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { EmailLinkOrdinalSchema, type InboxEmailLinkStore } from "@packages/domain/inbox";

const FAILURE_REASON = "preview-retries-exhausted";

const DeadLetteredPreview = CrawlEmailLinkPreview.detailSchema.extend({
	ordinal: EmailLinkOrdinalSchema,
});

/**
 * Consumes the `inbox-crawl-email-link-preview` dead-letter queue and turns a
 * `CrawlEmailLinkPreview` that exhausted its receives into the link's terminal
 * `failed` state, so the card settles on "No preview available" instead of
 * spinning for its whole poll budget and then reading as stalled.
 *
 * The write is conditional on the row still being `pending`, which is what makes
 * it safe to run behind a queue whose visibility timeout equals its worker
 * timeout: a slow-but-successful crawl can be redelivered while the first
 * invocation is still finishing, so the copy that lands here may be chasing a
 * link another copy already crawled. `already-terminal` is that race, not a
 * fault.
 *
 * A record whose envelope does not identify a link is ACKed, not retried: this
 * queue is the end of the line, so failing it would replay the same
 * unparseable message forever. It is logged at error level and left to the
 * queue's DLQ alarm.
 */
export function initCrawlEmailLinkPreviewDlqHandler(deps: {
	failPendingLink: InboxEmailLinkStore["failPendingLink"];
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { failPendingLink, logger } = deps;

	return initSqsRecordHandler({
		definition: { detailSchema: DeadLetteredPreview },
		logger,
		failure: { message: "[crawl-email-link-preview-dlq] record failed" },
		malformed: {
			policy: "acknowledge",
			report: ({ record }) =>
				logger.error("[crawl-email-link-preview-dlq] unidentifiable command", {
					messageId: record.messageId,
					receiveCount: record.receiveCount,
				}),
		},
		handle: async ({ userId, receivedAtMessageId, ordinal, url }, { receiveCount }) => {
			const outcome = await failPendingLink({
				userId,
				receivedAtMessageId,
				ordinal,
				failureReason: FAILURE_REASON,
			});
			if (outcome === "already-terminal") {
				logger.info("[crawl-email-link-preview-dlq] link already terminal", {
					receivedAtMessageId,
					ordinal,
					receiveCount,
				});
				return;
			}
			logger.error("[crawl-email-link-preview-dlq] preview gave up", {
				receivedAtMessageId,
				ordinal,
				url,
				receiveCount,
			});
		},
	});
}
