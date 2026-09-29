import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { EmailLinksFilterFailedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";

const REASON = "decision-retries-exhausted";

const DeadLetteredTriage = z.object({
	userId: z.string(),
	receivedAtMessageId: z.string(),
	readlist: z.string(),
});

export function initFilterEmailLinksDlqHandler(deps: {
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const triage = DeadLetteredTriage.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);

				logger.info("[FilterEmailLinksDlq] publishing filter failure", {
					receivedAtMessageId: triage.receivedAtMessageId,
					receiveCount,
				});
				await publishEvent(EmailLinksFilterFailedEvent, {
					userId: triage.userId,
					receivedAtMessageId: triage.receivedAtMessageId,
					readlist: triage.readlist,
					reason: REASON,
					receiveCount,
				});
			} catch (error) {
				logger.error("[FilterEmailLinksDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
