import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";
import { type GmailHistoryImportJobId, GmailHistoryImportJobIdSchema } from "@packages/domain/gmail";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import {
	GmailHistoryImportCompletedEvent,
	GmailHistoryImportFailedEvent,
	GmailHistoryImportPageProcessedEvent,
	ProcessGmailHistoryImportPageCommand,
	StartGmailHistoryImportCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { RecordGmailDiagnostic } from "../../observability/gmail-diagnostics";
import type { GmailHistoryImport, GmailHistoryImportPage } from "./gmail-history-import";
import { type GmailImportRecordIdentity, type GmailImportRecordTrace, startGmailImportRecordTrace } from "./gmail-import-record-trace";

export const GmailHistoryImportEnvelope = z.union([
	z.object({ "detail-type": z.literal(StartGmailHistoryImportCommand.detailType), detail: StartGmailHistoryImportCommand.detailSchema }).transform(({ detail }) => ({ kind: "start" as const, detail })),
	z.object({ "detail-type": z.literal(ProcessGmailHistoryImportPageCommand.detailType).optional(), detail: ProcessGmailHistoryImportPageCommand.detailSchema }).transform(({ detail }) => ({ kind: "page" as const, detail })),
	z.object({ "detail-type": z.literal(GmailHistoryImportPageProcessedEvent.detailType), detail: GmailHistoryImportPageProcessedEvent.detailSchema }).transform(({ detail }) => ({ kind: "progress" as const, detail })),
]);

function envelopePage(envelope: z.output<typeof GmailHistoryImportEnvelope>): { generation: string; page: number } | undefined {
	if (envelope.kind === "progress") return envelope.detail.nextPage;
	if (envelope.kind === "start") return { generation: envelope.detail.generation, page: 0 };
	return envelope.detail;
}

export function gmailHistoryImportRecordIdentity(input: {
	envelope: z.output<typeof GmailHistoryImportEnvelope>;
	userId: UserId;
	jobId: GmailHistoryImportJobId;
}): GmailImportRecordIdentity {
	const located = envelopePage(input.envelope);
	return { envelopeKind: input.envelope.kind, userId: input.userId, jobId: input.jobId, generation: located?.generation, page: located?.page };
}

export function initGmailHistoryImportHandler(deps: {
	importer: GmailHistoryImport;
	dispatchPage: (input: GmailHistoryImportPage) => Promise<void>;
	publishEvent: PublishEvent;
	logger: HutchLogger;
	recordDiagnostic: RecordGmailDiagnostic;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	async function processRecord(record: SQSRecord, trace: GmailImportRecordTrace): Promise<void> {
		const envelope = GmailHistoryImportEnvelope.parse(JSON.parse(record.body));
		const userId = UserIdSchema.parse(envelope.detail.userId);
		const jobId = GmailHistoryImportJobIdSchema.parse(envelope.detail.jobId);
		trace.identify(gmailHistoryImportRecordIdentity({ envelope, userId, jobId }));
		if (envelope.kind === "progress") {
			const next = envelope.detail.nextPage;
			if (next !== undefined) {
				await trace.publish({ target: ProcessGmailHistoryImportPageCommand.detailType, send: () => deps.dispatchPage({ userId, jobId, ...next }) });
			}
			return;
		}
		const step = envelope.kind === "start"
			? await deps.importer.start({ userId, jobId, generation: envelope.detail.generation }, trace.observe)
			: await deps.importer.page({ userId, jobId, generation: envelope.detail.generation, page: envelope.detail.page }, trace.observe);
		const completed = step.completed;
		if (completed !== undefined) {
			await trace.publish({
				target: GmailHistoryImportCompletedEvent.detailType,
				send: () => deps.publishEvent(GmailHistoryImportCompletedEvent, { userId, jobId, counts: completed.counts }),
			});
		}
		const failed = step.failed;
		if (failed !== undefined) {
			await trace.publish({
				target: GmailHistoryImportFailedEvent.detailType,
				send: () => deps.publishEvent(GmailHistoryImportFailedEvent, { userId, jobId, reason: failed }),
			});
		}
		const nextPage = step.next === undefined ? undefined : { generation: step.next.generation, page: step.next.page };
		await trace.publish({
			target: GmailHistoryImportPageProcessedEvent.detailType,
			send: () => deps.publishEvent(GmailHistoryImportPageProcessedEvent, { userId, jobId, nextPage }),
		});
	}

	return async (event, context) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			const trace = startGmailImportRecordTrace({
				handler: "history-import",
				invocationId: context.awsRequestId,
				record,
				recordDiagnostic: deps.recordDiagnostic,
				now: deps.now,
			});
			try {
				await processRecord(record, trace);
				trace.acked();
			} catch (error) {
				deps.logger.error("[gmail-history-import] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
				trace.retryRequested(error);
			}
		}
		return { batchItemFailures };
	};
}
