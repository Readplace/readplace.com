import assert from "node:assert";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import {
	EmailLinksFilteredEvent,
	EmailLinksFilterFailedEvent,
} from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkStore,
	type InboxEmailStore,
	isExcludedLink,
	type SettledInboxReadlistDecision,
} from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { z } from "zod";

const FilteredFactSchema = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	readlist: ReadlistSlugSchema,
	savedTo: ReadlistSlugSchema,
	readlistLabel: z.string().min(1),
	dropped: z.array(z.object({ ordinal: EmailLinkOrdinalSchema, reason: z.string() })),
});

const FilterFailedFactSchema = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	readlist: ReadlistSlugSchema,
});

export function initRecordEmailLinksFilteredHandler(deps: {
	markLinkDropped: InboxEmailLinkStore["markLinkDropped"];
	settleReadlistDecision: InboxEmailLinkStore["settleReadlistDecision"];
	listLinksByEmail: InboxEmailLinkStore["listLinksByEmail"];
	setEmailLinkCounts: InboxEmailStore["setEmailLinkCounts"];
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { markLinkDropped, settleReadlistDecision, listLinksByEmail, setEmailLinkCounts, logger } =
		deps;

	const recountLinks = async (input: { userId: UserId; receivedAtMessageId: string }): Promise<void> => {
		const { links, meta } = await listLinksByEmail(input);
		assert(meta, "a settled readlist decision lives on the extraction barrier");
		await setEmailLinkCounts({
			...input,
			linkCounts: {
				kept: links.filter((link) => !isExcludedLink(link)).length,
				skipped: links.filter(isExcludedLink).length,
				truncated: meta.truncated,
			},
		});
	};

	const settle = async (input: {
		userId: UserId;
		receivedAtMessageId: string;
		decision: SettledInboxReadlistDecision;
	}): Promise<void> => {
		const outcome = await settleReadlistDecision(input);
		logger.info(`[record-email-links-filtered] decision ${outcome}`, {
			receivedAtMessageId: input.receivedAtMessageId,
			state: input.decision.state,
		});
	};

	const recordFiltered = async (detail: unknown): Promise<void> => {
		const fact = FilteredFactSchema.parse(detail);
		for (const drop of fact.dropped) {
			const marked = await markLinkDropped({
				userId: fact.userId,
				receivedAtMessageId: fact.receivedAtMessageId,
				ordinal: drop.ordinal,
				droppedFor: {
					readlist: fact.readlist,
					readlistLabel: fact.readlistLabel,
					reason: drop.reason,
				},
			});
			if (marked === "not-a-candidate") {
				logger.warn("[record-email-links-filtered] dropped link is not a candidate", {
					receivedAtMessageId: fact.receivedAtMessageId,
					ordinal: drop.ordinal,
				});
			}
		}
		await settle({
			userId: fact.userId,
			receivedAtMessageId: fact.receivedAtMessageId,
			decision: { state: "decided", readlist: fact.savedTo, readlistLabel: fact.readlistLabel },
		});
		await recountLinks({ userId: fact.userId, receivedAtMessageId: fact.receivedAtMessageId });
	};

	const recordFilterFailed = async (detail: unknown): Promise<void> => {
		const fact = FilterFailedFactSchema.parse(detail);
		await settle({
			userId: fact.userId,
			receivedAtMessageId: fact.receivedAtMessageId,
			decision: { state: "failed", readlist: fact.readlist },
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
