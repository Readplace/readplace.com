import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { mergeSubmittedSender } from "@packages/domain/newsletter-catalog";
import { NewsletterSenderSubmittedEvent, SubmitNewsletterSenderCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { UpdateNewsletterCatalog, UpdateNewsletterCatalogResult } from "./update-newsletter-catalog";

function submissionOutcome(result: UpdateNewsletterCatalogResult): "created-pending" | "already-present" | undefined {
	if (result.ok) return "created-pending";
	if (result.reason === "unchanged") return "already-present";
	return undefined;
}

export function initSubmitNewsletterSenderHandler(deps: {
	updateCatalog: UpdateNewsletterCatalog;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const detail = SubmitNewsletterSenderCommand.detailSchema.parse(JSON.parse(record.body).detail);
				const senderEmail = ForwardableSenderSchema.parse(detail.senderEmail);
				const result = await deps.updateCatalog((document) =>
					mergeSubmittedSender(document, {
						from: senderEmail,
						now: deps.now(),
					}),
				);
				const outcome = submissionOutcome(result);
				if (outcome === undefined) {
					deps.logger.error("[newsletter-catalog-suggestions] catalog update failed", { messageId: record.messageId, result });
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				await deps.publishEvent(NewsletterSenderSubmittedEvent, {
					senderEmail,
					outcome,
				});
			} catch (error) {
				deps.logger.error("[newsletter-catalog-suggestions] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
