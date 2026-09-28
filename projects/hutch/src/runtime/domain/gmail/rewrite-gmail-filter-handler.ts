import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	GMAIL_FILTER_REWRITE_FAILED_EVENT,
	type GmailFilterRewriteFailedLine,
	GmailFilterRewriteFailedEvent,
	GmailFilterRewrittenEvent,
	METERED_GMAIL_FILTER_REWRITE_REASONS,
	RewriteGmailFilterCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import type { RewriteGmailFilter } from "./rewrite-gmail-filter";

export function initRewriteGmailFilterHandler(deps: {
	rewriteGmailFilter: RewriteGmailFilter;
	publishEvent: PublishEvent;
	metricLog: HutchLogger.Typed<GmailFilterRewriteFailedLine>;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { rewriteGmailFilter, publishEvent, metricLog, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const parsed = RewriteGmailFilterCommand.detailSchema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[rewrite-gmail-filter] malformed command", {
						messageId: record.messageId,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const userId = UserIdSchema.parse(parsed.data.userId);

				const result = await rewriteGmailFilter({ userId });
				if (result.ok) {
					await publishEvent(GmailFilterRewrittenEvent, {
						userId,
						senderCount: result.senderCount,
					});
					logger.info("[rewrite-gmail-filter] filter reconciled", {
						userId,
						filterCount: result.filterCount,
						senderCount: result.senderCount,
						reason: parsed.data.reason,
					});
					continue;
				}
				if (result.reason === "unavailable") {
					logger.warn("[rewrite-gmail-filter] gmail unavailable, retrying", {
						userId,
						status: result.status,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				await publishEvent(GmailFilterRewriteFailedEvent, { userId, reason: result.reason });
				const meteredReason = METERED_GMAIL_FILTER_REWRITE_REASONS.find(
					(reason) => reason === result.reason,
				);
				if (meteredReason) {
					metricLog.error({
						level: "ERROR",
						message: "[rewrite-gmail-filter] filter not written",
						event: GMAIL_FILTER_REWRITE_FAILED_EVENT,
						reason: meteredReason,
						userId,
					});
				}
			} catch (error) {
				logger.error("[rewrite-gmail-filter] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
