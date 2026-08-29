import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GmailConnectionStore } from "@packages/domain/gmail";
import {
	GMAIL_CONNECTIONS_COUNT_EVENT,
	type GmailConnectionsCountLine,
} from "../observability/events";

export interface CountGmailConnectionsDeps {
	countConnected: GmailConnectionStore["countConnected"];
	metricLog: HutchLogger.Typed<GmailConnectionsCountLine>;
	logger: HutchLogger;
}

export function initCountGmailConnectionsHandler(
	deps: CountGmailConnectionsDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const { countConnected, metricLog, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const count = await countConnected();
				metricLog.info({ event: GMAIL_CONNECTIONS_COUNT_EVENT, count });
				logger.info("[CountGmailConnections] emitted connection gauge", { count });
			} catch (error) {
				logger.error("[CountGmailConnections] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
