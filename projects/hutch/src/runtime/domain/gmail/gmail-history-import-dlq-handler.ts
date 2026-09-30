import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { z } from "zod";
import { type GmailHistoryImportStore, GmailHistoryImportJobIdSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { GmailHistoryImportFailedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import { GmailHistoryImportEnvelope } from "./gmail-history-import-handler";
import { initGmailHistoryImportOutcomeRecorder } from "./record-gmail-history-import-outcome-handler";

interface DlqHandlerDependencies {
	imports: GmailHistoryImportStore;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
}

function deadLetteredGeneration(envelope: z.output<typeof GmailHistoryImportEnvelope>): string | undefined {
	if (envelope.kind === "progress") return envelope.detail.nextPage?.generation;
	return envelope.detail.generation;
}

export function initGmailHistoryImportPageDlqHandler(deps: DlqHandlerDependencies): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = GmailHistoryImportEnvelope.parse(JSON.parse(record.body));
				const userId = UserIdSchema.parse(envelope.detail.userId);
				const jobId = GmailHistoryImportJobIdSchema.parse(envelope.detail.jobId);
				const generation = deadLetteredGeneration(envelope);
				if (generation === undefined) continue;
				const failed = await deps.imports.failJob({ userId, jobId, generation, reason: "dead-lettered", now: deps.now() });
				if (failed === undefined) continue;
				await deps.publishEvent(GmailHistoryImportFailedEvent, { userId, jobId, reason: "dead-lettered" });
			} catch (error) {
				deps.logger.error("[gmail-history-import-dlq] page record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}

export function initGmailHistoryImportOutcomeDlqHandler(deps: DlqHandlerDependencies): Handler<SQSEvent, SQSBatchResponse> {
	return initGmailHistoryImportOutcomeRecorder({
		...deps,
		logPrefix: "[gmail-history-import-dlq] outcome",
		outcomeFor: () => "failed",
	});
}
