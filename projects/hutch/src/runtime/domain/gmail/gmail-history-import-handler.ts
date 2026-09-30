import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { z } from "zod";
import { GmailHistoryImportJobIdSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import {
	GmailHistoryImportCompletedEvent,
	GmailHistoryImportFailedEvent,
	GmailHistoryImportPageProcessedEvent,
	ProcessGmailHistoryImportPageCommand,
	StartGmailHistoryImportCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GmailHistoryImport, GmailHistoryImportPage } from "./gmail-history-import";

export const GmailHistoryImportEnvelope = z.union([
	z.object({ "detail-type": z.literal(StartGmailHistoryImportCommand.detailType), detail: StartGmailHistoryImportCommand.detailSchema }).transform(({ detail }) => ({ kind: "start" as const, detail })),
	z.object({ "detail-type": z.literal(ProcessGmailHistoryImportPageCommand.detailType).optional(), detail: ProcessGmailHistoryImportPageCommand.detailSchema }).transform(({ detail }) => ({ kind: "page" as const, detail })),
	z.object({ "detail-type": z.literal(GmailHistoryImportPageProcessedEvent.detailType), detail: GmailHistoryImportPageProcessedEvent.detailSchema }).transform(({ detail }) => ({ kind: "progress" as const, detail })),
]);

export function initGmailHistoryImportHandler(deps: {
	importer: GmailHistoryImport;
	dispatchPage: (input: GmailHistoryImportPage) => Promise<void>;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = GmailHistoryImportEnvelope.parse(JSON.parse(record.body));
				const userId = UserIdSchema.parse(envelope.detail.userId);
				const jobId = GmailHistoryImportJobIdSchema.parse(envelope.detail.jobId);
				if (envelope.kind === "progress") {
					const next = envelope.detail.nextPage;
					if (next !== undefined) await deps.dispatchPage({ userId, jobId, ...next });
					continue;
				}
				const step = envelope.kind === "start"
					? await deps.importer.start({ userId, jobId, generation: envelope.detail.generation })
					: await deps.importer.page({ userId, jobId, generation: envelope.detail.generation, page: envelope.detail.page });
				if (step.completed !== undefined) {
					await deps.publishEvent(GmailHistoryImportCompletedEvent, { userId, jobId, counts: step.completed.counts });
				}
				if (step.failed !== undefined) {
					await deps.publishEvent(GmailHistoryImportFailedEvent, { userId, jobId, reason: step.failed });
				}
				const nextPage = step.next === undefined ? undefined : { generation: step.next.generation, page: step.next.page };
				await deps.publishEvent(GmailHistoryImportPageProcessedEvent, { userId, jobId, nextPage });
			} catch (error) {
				deps.logger.error("[gmail-history-import] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
