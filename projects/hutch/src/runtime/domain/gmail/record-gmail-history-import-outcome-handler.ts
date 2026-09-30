import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	type GmailHistoryImportMessageOutcome,
	type GmailHistoryImportStore,
	GmailHistoryImportJobIdSchema,
	GmailMessageIdSchema,
} from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { GmailHistoryImportCompletedEvent, GmailHistoryImportMessageIngestedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";

interface OutcomeHandlerDependencies {
	imports: GmailHistoryImportStore;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
}

export function initGmailHistoryImportOutcomeRecorder(input: OutcomeHandlerDependencies & {
	logPrefix: string;
	outcomeFor: (ingested: GmailHistoryImportMessageOutcome) => GmailHistoryImportMessageOutcome;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { imports, publishEvent, now, logger } = input;
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const detail = GmailHistoryImportMessageIngestedEvent.detailSchema.parse(JSON.parse(record.body).detail);
				const userId = UserIdSchema.parse(detail.userId);
				const jobId = GmailHistoryImportJobIdSchema.parse(detail.jobId);
				const recorded = await imports.recordOutcome({
					userId,
					jobId,
					generation: detail.generation,
					gmailMessageId: GmailMessageIdSchema.parse(detail.gmailMessageId),
					outcome: input.outcomeFor(detail.outcome),
					now: now(),
				});
				if (recorded === "stale") continue;
				const completed = await imports.completeIfSettled({ userId, jobId, now: now() });
				if (completed === undefined) continue;
				await publishEvent(GmailHistoryImportCompletedEvent, { userId, jobId, counts: completed.counts });
			} catch (error) {
				logger.error(`${input.logPrefix} record failed`, { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}

export function initRecordGmailHistoryImportOutcomeHandler(deps: OutcomeHandlerDependencies): Handler<SQSEvent, SQSBatchResponse> {
	return initGmailHistoryImportOutcomeRecorder({
		...deps,
		logPrefix: "[gmail-history-import-outcomes]",
		outcomeFor: (ingested) => ingested,
	});
}
