import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { z } from "zod";
import { type GmailHistoryImportStore, GmailHistoryImportJobIdSchema } from "@packages/domain/gmail";
import { GmailHistoryImportFailedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { RecordGmailDiagnostic } from "./gmail-diagnostic.types";
import { GmailHistoryImportEnvelope, gmailHistoryImportRecordIdentity } from "./gmail-history-import-handler";
import { type GmailImportRecordTrace, startGmailImportRecordTrace } from "./gmail-import-record-trace";
import { initGmailHistoryImportOutcomeRecorder } from "./record-gmail-history-import-outcome-handler";

interface DlqHandlerDependencies {
	imports: GmailHistoryImportStore;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
	recordDiagnostic: RecordGmailDiagnostic;
}

function deadLetteredGeneration(envelope: z.output<typeof GmailHistoryImportEnvelope>): string | undefined {
	if (envelope.kind === "progress") return envelope.detail.nextPage?.generation;
	return envelope.detail.generation;
}

export function initGmailHistoryImportPageDlqHandler(deps: DlqHandlerDependencies): Handler<SQSEvent, SQSBatchResponse> {
	async function drainRecord(record: SQSRecord, trace: GmailImportRecordTrace): Promise<void> {
		const envelope = GmailHistoryImportEnvelope.parse(JSON.parse(record.body));
		const { userId } = envelope.detail;
		const jobId = GmailHistoryImportJobIdSchema.parse(envelope.detail.jobId);
		trace.identify(gmailHistoryImportRecordIdentity({ envelope, userId, jobId }));
		const generation = deadLetteredGeneration(envelope);
		if (generation === undefined) {
			trace.step({ kind: "dead-letter-without-generation" });
			return;
		}
		const failed = await deps.imports.failJob({ userId, jobId, generation, reason: "dead-lettered", now: deps.now() });
		trace.step({ kind: "job-failed", reason: "dead-lettered", persisted: failed !== undefined });
		if (failed === undefined) return;
		await trace.publish({
			target: GmailHistoryImportFailedEvent.detailType,
			send: () => deps.publishEvent(GmailHistoryImportFailedEvent, { userId, jobId, reason: "dead-lettered" }),
		});
	}

	return async (event, context) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			const trace = startGmailImportRecordTrace({
				handler: "history-import-page-dlq",
				invocationId: context.awsRequestId,
				record,
				recordDiagnostic: deps.recordDiagnostic,
				now: deps.now,
			});
			try {
				await drainRecord(record, trace);
				trace.acked();
			} catch (error) {
				deps.logger.error("[gmail-history-import-dlq] page record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
				trace.retryRequested(error);
			}
		}
		return { batchItemFailures };
	};
}

export function initGmailHistoryImportOutcomeDlqHandler(deps: DlqHandlerDependencies): Handler<SQSEvent, SQSBatchResponse> {
	return initGmailHistoryImportOutcomeRecorder({
		...deps,
		diagnosticHandler: "history-import-outcome-dlq",
		logPrefix: "[gmail-history-import-dlq] outcome",
		outcomeFor: () => "failed",
	});
}
