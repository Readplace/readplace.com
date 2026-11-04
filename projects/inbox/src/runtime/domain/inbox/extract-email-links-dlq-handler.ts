import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import type { InboxEmailLinkStore } from "@packages/domain/inbox";
import { EmailReceivedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";

/**
 * Turns a dead-lettered extraction into the barrier that says it gave up, so the
 * Articles panel stops polling and tells the reader the scan failed.
 *
 * Writing an ordinary barrier here would be worse than writing nothing: with no
 * link rows behind it the panel reads meta-present-with-zero-rows as the terminal
 * "No links found in this email." — a claim about an email nobody managed to
 * read. The marker keeps the barrier's terminality and swaps the message.
 *
 * The write is conditional on no barrier existing. Delivery is at-least-once, so
 * one attempt can succeed while a duplicate exhausts its receives; overwriting
 * that success would paint a permanent failure over a real card set. Losing the
 * race the other way is self-healing — the successful run's unconditional barrier
 * lands moments later and replaces this one.
 */
export function initExtractEmailLinksDlqHandler(deps: {
	markLinksExtractionFailed: InboxEmailLinkStore["markLinksExtractionFailed"];
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { markLinksExtractionFailed, logger } = deps;

	return initSqsRecordHandler({
		definition: EmailReceivedEvent,
		logger,
		failure: { message: "[ExtractEmailLinksDlq] record failed" },
		malformed: { policy: "retry" },
		handle: async ({ userId, receivedAtMessageId }, { receiveCount }) => {
			const outcome = await markLinksExtractionFailed({ userId, receivedAtMessageId });

			logger.info("[ExtractEmailLinksDlq] extraction gave up", {
				receivedAtMessageId,
				receiveCount,
				outcome,
			});
		},
	});
}
