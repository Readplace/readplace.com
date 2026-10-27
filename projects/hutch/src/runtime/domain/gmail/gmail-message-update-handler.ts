import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { z } from "zod";
import { GmailAccountEmailSchema, type GmailMessageUpdateStore, GmailMessageOriginSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import {
	GMAIL_EMAIL_UPDATE_FAILED_EVENT,
	GmailEmailMarkedImportedEvent,
	type GmailEmailUpdateFailedLine,
	GmailEmailUpdateDeferredEvent,
	GmailEmailUpdateFailedEvent,
	GmailModifyPermissionGrantedEvent,
	MarkGmailEmailImportedCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { MarkGmailEmailImported } from "./mark-gmail-email-imported";

export const GmailMessageUpdateEnvelope = z.union([
	z
		.object({ "detail-type": z.literal(MarkGmailEmailImportedCommand.detailType), detail: MarkGmailEmailImportedCommand.detailSchema })
		.transform(({ detail }) => ({
			kind: "mark" as const,
			userId: UserIdSchema.parse(detail.userId),
			receivedAtMessageId: detail.receivedAtMessageId,
			origin: GmailMessageOriginSchema.parse(detail.origin),
		})),
	z
		.object({ "detail-type": z.literal(GmailModifyPermissionGrantedEvent.detailType), detail: GmailModifyPermissionGrantedEvent.detailSchema })
		.transform(({ detail }) => ({
			kind: "resume" as const,
			userId: UserIdSchema.parse(detail.userId),
			accountEmail: GmailAccountEmailSchema.parse(detail.accountEmail),
		})),
]);

export function initGmailMessageUpdateHandler(deps: {
	markImported: MarkGmailEmailImported;
	listPendingByAccount: GmailMessageUpdateStore["listPendingByAccount"];
	publishEvent: PublishEvent;
	metricLog: HutchLogger.Typed<GmailEmailUpdateFailedLine>;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, metricLog, logger } = deps;

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = GmailMessageUpdateEnvelope.parse(JSON.parse(record.body));
				if (envelope.kind === "resume") {
					const pending = await deps.listPendingByAccount({ userId: envelope.userId, accountEmail: envelope.accountEmail });
					for (const update of pending) {
						await publishEvent(MarkGmailEmailImportedCommand, {
							userId: update.userId,
							receivedAtMessageId: update.receivedAtMessageId,
							origin: update.origin,
						});
					}
					logger.info("[gmail-message-update] resumed pending updates", { userId: envelope.userId, count: pending.length });
					continue;
				}
				const outcome = await deps.markImported(envelope);
				const fact = { userId: envelope.userId, receivedAtMessageId: envelope.receivedAtMessageId, originKind: envelope.origin.kind };
				if (outcome.kind === "deferred") {
					await publishEvent(GmailEmailUpdateDeferredEvent, { ...fact, reason: outcome.reason });
				} else if (outcome.kind === "failed") {
					await publishEvent(GmailEmailUpdateFailedEvent, { ...fact, reason: outcome.reason });
					metricLog.error({
						level: "ERROR",
						message: "[gmail-message-update] Gmail original not updated",
						event: GMAIL_EMAIL_UPDATE_FAILED_EVENT,
						reason: outcome.reason,
						originKind: envelope.origin.kind,
						userId: envelope.userId,
					});
				} else {
					await publishEvent(GmailEmailMarkedImportedEvent, { ...fact, outcome: outcome.kind });
				}
				logger.info("[gmail-message-update] processed", { ...fact, outcome: outcome.kind });
			} catch (error) {
				logger.error("[gmail-message-update] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}

export function initGmailMessageUpdateDlqHandler(deps: {
	markFailed: GmailMessageUpdateStore["markFailed"];
	publishEvent: PublishEvent;
	metricLog: HutchLogger.Typed<GmailEmailUpdateFailedLine>;
	logger: HutchLogger;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = GmailMessageUpdateEnvelope.parse(JSON.parse(record.body));
				if (envelope.kind === "resume") {
					deps.logger.error("[gmail-message-update-dlq] permission resume dead-lettered", { userId: envelope.userId });
					continue;
				}
				await deps.markFailed({ userId: envelope.userId, origin: envelope.origin, reason: "dead-lettered", now: deps.now() });
				deps.metricLog.error({
					level: "ERROR",
					message: "[gmail-message-update-dlq] Gmail original not updated",
					event: GMAIL_EMAIL_UPDATE_FAILED_EVENT,
					reason: "dead-lettered",
					originKind: envelope.origin.kind,
					userId: envelope.userId,
				});
				await deps.publishEvent(GmailEmailUpdateFailedEvent, {
					userId: envelope.userId,
					receivedAtMessageId: envelope.receivedAtMessageId,
					originKind: envelope.origin.kind,
					reason: "dead-lettered",
				});
			} catch (error) {
				deps.logger.error("[gmail-message-update-dlq] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
