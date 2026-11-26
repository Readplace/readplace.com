import assert from "node:assert";
import {
	type InboxEmailLinkStore,
	type InboxReadlistOutcome,
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
	scope: z.enum(["email", "link"]),
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	decision: z.enum(["filtered", "no-purpose", "readlist-missing", "smart-matching"]),
});

const FilterFailedFactSchema = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	readlist: ReadlistSlugSchema,
	startIndex: z.number().int().positive().optional(),
});

export function initRecordEmailLinksFilteredHandler(deps: {
	putReadlistOutcome: InboxEmailLinkStore["putReadlistOutcome"];
	mergeReadlistOutcomeFit: InboxEmailLinkStore["mergeReadlistOutcomeFit"];
	listLinksByEmail: InboxEmailLinkStore["listLinksByEmail"];
	deliverIssueMatches: (input: { userId: UserId; receivedAtMessageId: string; outcome: InboxReadlistOutcome }) => Promise<void>;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { putReadlistOutcome, mergeReadlistOutcomeFit, listLinksByEmail, logger } = deps;

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
		return { destination, issue: meta.issueSave !== undefined };
	};

	type FilteredFact = z.infer<typeof FilteredFactSchema>;

	const recordEmailDecision = async ({ scope: _scope, userId, receivedAtMessageId, ...outcome }: FilteredFact) => {
		const key = { userId, receivedAtMessageId };
		const { destination, issue } = await destinationSnapshot({ ...key, readlist: outcome.readlist });
		const written = await putReadlistOutcome({ ...key, outcome });
		if (issue && destination.qualification === "preferences") {
			const stored = written === "stored" ? outcome : (await listLinksByEmail(key)).meta?.readlistOutcomes?.find(
				(entry) => entry.readlist === outcome.readlist && entry.startIndex === outcome.startIndex,
			);
			assert(stored, "a duplicate decision has a stored outcome");
			await deps.deliverIssueMatches({ ...key, outcome: stored });
		}
	};

	const recordLinkDecision = async (fact: FilteredFact) => {
		await destinationSnapshot(fact);
		const { userId, receivedAtMessageId, readlist, decision, fit } = fact;
		if (decision !== "filtered") {
			logger.info("[record-email-links-filtered] saved link needs no merge", {
				receivedAtMessageId,
				readlist,
				decision,
			});
			return;
		}
		const [entry] = fit;
		assert(entry !== undefined && fit.length === 1, "a saved link's decision holds exactly that link");
		const merged = await mergeReadlistOutcomeFit({ userId, receivedAtMessageId, readlist, entry, ...(fact.startIndex !== undefined && { startIndex: fact.startIndex }) });
		logger.info("[record-email-links-filtered] saved link decided", {
			receivedAtMessageId,
			readlist,
			ordinal: entry.ordinal,
			result: merged,
		});
	};

	const RECORD_BY_SCOPE = { email: recordEmailDecision, link: recordLinkDecision } satisfies Record<
		FilteredFact["scope"],
		(fact: FilteredFact) => Promise<void>
	>;

	const recordFiltered = async (detail: unknown): Promise<void> => {
		const fact = FilteredFactSchema.parse(detail);
		await RECORD_BY_SCOPE[fact.scope](fact);
	};

	const recordFilterFailed = async (detail: unknown): Promise<void> => {
		const fact = FilterFailedFactSchema.parse(detail);
		const { destination, issue } = await destinationSnapshot(fact);
		const key = { userId: fact.userId, receivedAtMessageId: fact.receivedAtMessageId };
		const outcome: InboxReadlistOutcome = {
			readlist: fact.readlist,
			readlistLabel: destination.label,
			...(fact.startIndex !== undefined && { startIndex: fact.startIndex }),
			decision: "failed",
			fit: [],
		};
		const written = await putReadlistOutcome({ ...key, outcome });
		if (written === "stored" && issue && destination.qualification === "preferences") {
			await deps.deliverIssueMatches({ ...key, outcome });
		}
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
