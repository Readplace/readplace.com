import assert from "node:assert";
import {
	type InboxEmailLinkStore,
	InboxReadlistOutcomeSchema,
} from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import {
	EmailLinksFilteredEvent,
	EmailLinksFilterFailedEvent,
} from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";

const FilteredFactSchema = InboxReadlistOutcomeSchema.extend({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	decision: z.enum(["filtered", "no-purpose", "readlist-missing"]),
});

const FilterFailedFactSchema = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	readlist: ReadlistSlugSchema,
});

export function initRecordEmailLinksFilteredHandler(deps: {
	putReadlistOutcome: InboxEmailLinkStore["putReadlistOutcome"];
	listLinksByEmail: InboxEmailLinkStore["listLinksByEmail"];
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { putReadlistOutcome, listLinksByEmail, logger } = deps;

	const destinationSnapshot = async (fact: {
		userId: UserId;
		receivedAtMessageId: string;
		readlist: string;
	}) => {
		const { meta } = await listLinksByEmail(fact);
		assert(meta, "filtering outcome arrived before the extraction barrier");
		assert(
			meta.selectedReadlists,
			"a readlist decision arrives only for an email with a destination snapshot",
		);
		const destination = meta.selectedReadlists.find(
			({ readlist }) => readlist === fact.readlist,
		);
		assert(destination, "filtering outcome is outside the destination snapshot");
		return destination;
	};

	const recordFiltered = async (detail: unknown): Promise<void> => {
		const { userId, receivedAtMessageId, ...outcome } =
			FilteredFactSchema.parse(detail);
		await destinationSnapshot({
			userId,
			receivedAtMessageId,
			readlist: outcome.readlist,
		});
		await putReadlistOutcome({ userId, receivedAtMessageId, outcome });
	};

	const recordFilterFailed = async (detail: unknown): Promise<void> => {
		const fact = FilterFailedFactSchema.parse(detail);
		const { label } = await destinationSnapshot(fact);
		await putReadlistOutcome({
			userId: fact.userId,
			receivedAtMessageId: fact.receivedAtMessageId,
			outcome: {
				readlist: fact.readlist,
				readlistLabel: label,
				decision: "failed",
				fit: [],
			},
		});
	};

	const recorders = new Map<string, (detail: unknown) => Promise<void>>([
		[EmailLinksFilteredEvent.detailType, recordFiltered],
		[EmailLinksFilterFailedEvent.detailType, recordFilterFailed],
	]);

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detailType = envelope["detail-type"];
				const recorder = recorders.get(detailType);
				if (recorder === undefined) {
					logger.error("[record-email-links-filtered] unknown fact", {
						messageId: record.messageId,
						detailType,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				await recorder(envelope.detail);
			} catch (error) {
				logger.error("[record-email-links-filtered] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
