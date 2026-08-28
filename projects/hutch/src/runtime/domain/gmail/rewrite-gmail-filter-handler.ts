import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	GmailFilterRewriteFailedEvent,
	GmailFilterRewrittenEvent,
	RewriteGmailFilterCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import type { RewriteGmailFilter } from "./rewrite-gmail-filter";

export function initRewriteGmailFilterHandler(deps: {
	rewriteGmailFilter: RewriteGmailFilter;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { rewriteGmailFilter, publishEvent, logger } = deps;

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
						filterId: result.filterId,
						senderCount: result.senderCount,
					});
					logger.info("[rewrite-gmail-filter] filter reconciled", {
						userId,
						filterId: result.filterId,
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
				logger.error("[rewrite-gmail-filter] filter not written", {
					userId,
					reason: result.reason,
				});
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
