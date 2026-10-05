import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
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
import type { RecordGmailDiagnostic } from "../../observability/gmail-diagnostics";
import { type GmailImportRecordTrace, startGmailImportRecordTrace } from "./gmail-import-record-trace";

interface OutcomeHandlerDependencies {
	imports: GmailHistoryImportStore;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
	recordDiagnostic: RecordGmailDiagnostic;
}

export function initGmailHistoryImportOutcomeRecorder(input: OutcomeHandlerDependencies & {
	diagnosticHandler: "history-import-outcomes" | "history-import-outcome-dlq";
	logPrefix: string;
	outcomeFor: (ingested: GmailHistoryImportMessageOutcome) => GmailHistoryImportMessageOutcome;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { imports, publishEvent, now, logger } = input;

	async function recordMessageOutcome(record: SQSRecord, trace: GmailImportRecordTrace): Promise<void> {
		const detail = GmailHistoryImportMessageIngestedEvent.detailSchema.parse(JSON.parse(record.body).detail);
		const userId = UserIdSchema.parse(detail.userId);
		const jobId = GmailHistoryImportJobIdSchema.parse(detail.jobId);
		trace.identify({ envelopeKind: "outcome", userId, jobId, generation: detail.generation, page: undefined });
		const gmailMessageId = GmailMessageIdSchema.parse(detail.gmailMessageId);
		const outcome = input.outcomeFor(detail.outcome);
		const recorded = await imports.recordOutcome({
			userId,
			jobId,
			generation: detail.generation,
			gmailMessageId,
			outcome,
			now: now(),
		});
		trace.step({ kind: "outcome-recorded", result: recorded, outcome });
		if (recorded === "stale") return;
		const completed = await imports.completeIfSettled({ userId, jobId, now: now() });
		trace.step({ kind: "job-completed", persisted: completed !== undefined });
		if (completed === undefined) return;
		await trace.publish({
			target: GmailHistoryImportCompletedEvent.detailType,
			send: () => publishEvent(GmailHistoryImportCompletedEvent, { userId, jobId, counts: completed.counts }),
		});
	}

	return async (event, context) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			const trace = startGmailImportRecordTrace({
				handler: input.diagnosticHandler,
				invocationId: context.awsRequestId,
				record,
				recordDiagnostic: input.recordDiagnostic,
				now,
			});
			try {
				await recordMessageOutcome(record, trace);
				trace.acked();
			} catch (error) {
				logger.error(`${input.logPrefix} record failed`, { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
				trace.retryRequested(error);
			}
		}
		return { batchItemFailures };
	};
}

export function initRecordGmailHistoryImportOutcomeHandler(deps: OutcomeHandlerDependencies): Handler<SQSEvent, SQSBatchResponse> {
	return initGmailHistoryImportOutcomeRecorder({
		...deps,
		diagnosticHandler: "history-import-outcomes",
		logPrefix: "[gmail-history-import-outcomes]",
		outcomeFor: (ingested) => ingested,
	});
}
