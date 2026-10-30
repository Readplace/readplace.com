import assert from "node:assert";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkStore,
} from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import {
	EmailLinksFilteredEvent,
	EmailLinksFilterFailedEvent,
} from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";

const FilteredFactSchema = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	readlist: ReadlistSlugSchema,
	savedTo: ReadlistSlugSchema,
	readlistLabel: z.string().min(1),
	dropped: z.array(
		z.object({ ordinal: EmailLinkOrdinalSchema, reason: z.string() }),
	),
});

const FilterFailedFactSchema = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	readlist: ReadlistSlugSchema,
});

export function initRecordEmailLinksFilteredHandler(deps: {
	putReadlistOutcome: InboxEmailLinkStore["putReadlistOutcome"];
	listLinksByEmail: InboxEmailLinkStore["listLinksByEmail"];
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { putReadlistOutcome, listLinksByEmail, logger } = deps;

	const destinationSnapshot = async (fact: {
		userId: UserId;
		receivedAtMessageId: string;
		readlist: string;
	}): Promise<void> => {
		const { meta } = await listLinksByEmail(fact);
		assert(meta, "filtering outcome arrived before the extraction barrier");
		assert(
			meta.selectedReadlists,
			"a readlist decision arrives only for an email with a destination snapshot",
		);
		assert(
			meta.selectedReadlists.some(({ readlist }) => readlist === fact.readlist),
			"filtering outcome is outside the destination snapshot",
		);
	};

	const recordFiltered = async (detail: unknown): Promise<void> => {
		const fact = FilteredFactSchema.parse(detail);
		await destinationSnapshot(fact);
		await putReadlistOutcome({
			userId: fact.userId,
			receivedAtMessageId: fact.receivedAtMessageId,
			outcome: {
				readlist: fact.readlist,
				decision: {
					state: "decided",
					readlist: fact.savedTo,
					readlistLabel: fact.readlistLabel,
				},
				dropped: fact.dropped,
			},
		});
	};

	const recordFilterFailed = async (detail: unknown): Promise<void> => {
		const fact = FilterFailedFactSchema.parse(detail);
		await destinationSnapshot(fact);
		await putReadlistOutcome({
			userId: fact.userId,
			receivedAtMessageId: fact.receivedAtMessageId,
			outcome: {
				readlist: fact.readlist,
				decision: { state: "failed", readlist: fact.readlist },
				dropped: [],
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
