import assert from "node:assert";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { type EmailLinkOrdinal, EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import {
	DEFAULT_READLIST_LABEL,
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import {
	EmailLinksFilteredEvent,
	EmailLinksTriagedEvent,
	SubmitLinkCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	ListReadlistDefinitions,
	ReadlistDefinitionData,
} from "@packages/provider-contracts/article-store";
import type { DecideEmailLinks } from "./decide-email-links";

type FilterDecision = {
	savedTo: ReadlistSlug;
	readlistLabel: string;
	decision: "filtered" | "no-purpose" | "readlist-missing";
	kept: EmailLinkOrdinal[];
	dropped: { ordinal: EmailLinkOrdinal; reason: string }[];
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
};

const NO_MODEL_CALL = { dropped: [], inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

export function initFilterEmailLinksHandler(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	decideEmailLinks: DecideEmailLinks;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { listReadlistDefinitions, decideEmailLinks, publishEvent, logger } = deps;

	const decideFor = async (input: {
		readlist: ReadlistSlug;
		definition: ReadlistDefinitionData | undefined;
		subject: string;
		senderEmail: string;
		links: { ordinal: EmailLinkOrdinal; url: string; anchorText: string }[];
	}): Promise<FilterDecision> => {
		const everyLink = input.links.map((link) => link.ordinal);
		if (input.definition === undefined) {
			return {
				...NO_MODEL_CALL,
				savedTo: DEFAULT_READLIST_SLUG,
				readlistLabel: DEFAULT_READLIST_LABEL,
				decision: "readlist-missing",
				kept: everyLink,
			};
		}
		if (input.definition.purpose === undefined) {
			return {
				...NO_MODEL_CALL,
				savedTo: input.readlist,
				readlistLabel: input.definition.label,
				decision: "no-purpose",
				kept: everyLink,
			};
		}
		const decided = await decideEmailLinks({
			purpose: input.definition.purpose,
			subject: input.subject,
			senderEmail: input.senderEmail,
			links: input.links,
		});
		return {
			...decided,
			savedTo: input.readlist,
			readlistLabel: input.definition.label,
			decision: "filtered",
		};
	};

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = EmailLinksTriagedEvent.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(detail.userId);
				const readlist = ReadlistSlugSchema.parse(detail.readlist);
				assert(readlist !== DEFAULT_READLIST_SLUG, "All takes every link and is never filtered");
				const links = detail.links.map((link) => ({
					...link,
					ordinal: EmailLinkOrdinalSchema.parse(link.ordinal),
				}));

				const definition = (await listReadlistDefinitions(userId)).find(
					(candidate) => candidate.slug === readlist,
				);
				const outcome = await decideFor({
					readlist,
					definition,
					subject: detail.subject,
					senderEmail: detail.senderEmail,
					links,
				});

				const urlByOrdinal = new Map(links.map((link) => [link.ordinal, link.url]));
				for (const ordinal of outcome.kept) {
					const url = urlByOrdinal.get(ordinal);
					assert(url !== undefined, `kept ordinal ${ordinal} is not one of the email's links`);
					await publishEvent(SubmitLinkCommand, {
						url,
						userId,
						provenance: { kind: "email", senderEmail: detail.senderEmail },
						readlist: outcome.savedTo,
					});
				}
				await publishEvent(EmailLinksFilteredEvent, {
					userId,
					receivedAtMessageId: detail.receivedAtMessageId,
					readlist,
					savedTo: outcome.savedTo,
					readlistLabel: outcome.readlistLabel,
					decision: outcome.decision,
					dropped: outcome.dropped,
					inputTokens: outcome.inputTokens,
					outputTokens: outcome.outputTokens,
					reasoningTokens: outcome.reasoningTokens,
				});
				logger.info("[filter-email-links] filtered", {
					receivedAtMessageId: detail.receivedAtMessageId,
					decision: outcome.decision,
					kept: outcome.kept.length,
					dropped: outcome.dropped.length,
				});
			} catch (error) {
				logger.error("[filter-email-links] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
