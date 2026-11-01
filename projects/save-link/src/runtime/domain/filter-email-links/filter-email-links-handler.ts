import assert from "node:assert";
import {
	type DeepseekCallFailedLogLine,
	deepseekCallFailedLogLine,
	describeAiProviderError,
} from "@packages/ai-message";
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
	parseReadlistPurposeFields,
	type ReadlistPurposeVersion,
	type ReadlistSlug,
	readlistPurposeVersion,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import {
	EmailLinksFilteredEvent,
	EmailLinksTriagedEvent,
	FileArticleIntoReadlistCommand,
	type FileArticleIntoReadlistDetail,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	ListReadlistDefinitions,
	ReadlistDefinitionData,
} from "@packages/provider-contracts/article-store";
import type { DecideReadlistFit, ReadlistFitEngine, ReadlistFitVerdict } from "@packages/readlist-fit";
import type { ReadlistFitDecidedLine, ReadlistFitUnsureLine } from "./readlist-fit-log-lines.types";

type FitEntry = { ordinal: EmailLinkOrdinal; verdict: ReadlistFitVerdict; reason: string };

type Filing = { url: string; fit: FileArticleIntoReadlistDetail["fit"] };

type FilterDecision = {
	readlistLabel: string;
	decision: "filtered" | "no-purpose" | "readlist-missing";
	fit: FitEntry[];
	filings: Filing[];
	purposeVersion?: ReadlistPurposeVersion;
	engine?: ReadlistFitEngine;
	model?: string;
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
};

const NO_MODEL_CALL = { fit: [], filings: [], inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

function countVerdict(input: { fit: FitEntry[]; verdict: ReadlistFitVerdict }): number {
	return input.fit.filter((entry) => entry.verdict === input.verdict).length;
}

export function initFilterEmailLinksHandler(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	decideReadlistFit: DecideReadlistFit;
	publishEvent: PublishEvent;
	logger: HutchLogger;
	fitDecidedLog: HutchLogger.Typed<ReadlistFitDecidedLine>;
	fitUnsureLog: HutchLogger.Typed<ReadlistFitUnsureLine>;
	deepseekCallFailedLog: HutchLogger.Typed<DeepseekCallFailedLogLine>;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		listReadlistDefinitions,
		decideReadlistFit,
		publishEvent,
		logger,
		fitDecidedLog,
		fitUnsureLog,
		deepseekCallFailedLog,
		now,
	} = deps;

	const decideFor = async (input: {
		userId: string;
		receivedAtMessageId: string;
		readlist: ReadlistSlug;
		definition: ReadlistDefinitionData | undefined;
		subject: string;
		senderEmail: string;
		links: { ordinal: EmailLinkOrdinal; url: string; anchorText: string }[];
	}): Promise<FilterDecision> => {
		const { userId, receivedAtMessageId, readlist, definition, subject, senderEmail, links } = input;
		if (definition === undefined) {
			return { ...NO_MODEL_CALL, readlistLabel: DEFAULT_READLIST_LABEL, decision: "readlist-missing" };
		}
		const { purpose } = definition;
		if (purpose === undefined) {
			return {
				...NO_MODEL_CALL,
				readlistLabel: definition.label,
				decision: "no-purpose",
				filings: links.map((link) => ({
					url: link.url,
					fit: {
						kind: "no-purpose",
						source: { kind: "email", receivedAtMessageId, ordinal: link.ordinal },
					},
				})),
			};
		}
		const purposeVersion = readlistPurposeVersion(purpose);
		if (links.length === 0) {
			return { ...NO_MODEL_CALL, readlistLabel: definition.label, decision: "filtered", purposeVersion };
		}

		const startedAt = now();
		const { decisions, engine, model, usage } = await decideReadlistFit({
			purpose: { ...parseReadlistPurposeFields(purpose), version: purposeVersion },
			examples: [],
			candidates: links.map((link) => ({ id: link.ordinal, url: link.url, text: link.anchorText })),
			context: { subject, senderEmail },
		});
		const latencyMs = now().getTime() - startedAt.getTime();

		const fit = decisions.map((decision) => ({
			ordinal: EmailLinkOrdinalSchema.parse(decision.id),
			verdict: decision.verdict,
			reason: decision.reason,
		}));
		const urlByOrdinal = new Map(links.map((link) => [link.ordinal, link.url]));
		const filings = fit
			.filter((entry) => entry.verdict === "keep")
			.map((entry): Filing => {
				const url = urlByOrdinal.get(entry.ordinal);
				assert(url !== undefined, `kept ordinal ${entry.ordinal} is not one of the email's links`);
				return {
					url,
					fit: {
						verdict: "keep",
						reason: entry.reason,
						purposeVersion,
						source: { kind: "email", receivedAtMessageId, ordinal: entry.ordinal },
					},
				};
			});

		fitDecidedLog.info({
			level: "INFO",
			event: "readlist-fit-decided",
			userId,
			readlist,
			receivedAtMessageId,
			engine,
			model,
			purposeVersion,
			links: links.length,
			kept: countVerdict({ fit, verdict: "keep" }),
			dropped: countVerdict({ fit, verdict: "drop" }),
			unsure: countVerdict({ fit, verdict: "unsure" }),
			...usage,
			latencyMs,
		});
		for (const entry of fit.filter(({ verdict }) => verdict === "unsure")) {
			fitUnsureLog.error({
				level: "ERROR",
				event: "readlist-fit-unsure",
				userId,
				readlist,
				receivedAtMessageId,
				ordinal: entry.ordinal,
				reason: entry.reason,
				engine,
				purposeVersion,
			});
		}

		return {
			readlistLabel: definition.label,
			decision: "filtered",
			fit,
			filings,
			purposeVersion,
			engine,
			model,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			reasoningTokens: usage.reasoningTokens,
		};
	};

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			let failureIds: { userId: string; receivedAtMessageId: string; readlist: string } | undefined;
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
				failureIds = { userId, receivedAtMessageId: detail.receivedAtMessageId, readlist };

				const definition = (await listReadlistDefinitions(userId)).find(
					(candidate) => candidate.slug === readlist,
				);
				const outcome = await decideFor({
					userId,
					receivedAtMessageId: detail.receivedAtMessageId,
					readlist,
					definition,
					subject: detail.subject,
					senderEmail: detail.senderEmail,
					links,
				});

				for (const filing of outcome.filings) {
					await publishEvent(FileArticleIntoReadlistCommand, {
						url: filing.url,
						userId,
						readlist,
						provenance: { kind: "email", senderEmail: detail.senderEmail },
						fit: filing.fit,
					});
				}
				await publishEvent(EmailLinksFilteredEvent, {
					userId,
					receivedAtMessageId: detail.receivedAtMessageId,
					readlist,
					readlistLabel: outcome.readlistLabel,
					decision: outcome.decision,
					fit: outcome.fit,
					purposeVersion: outcome.purposeVersion,
					engine: outcome.engine,
					model: outcome.model,
					inputTokens: outcome.inputTokens,
					outputTokens: outcome.outputTokens,
					reasoningTokens: outcome.reasoningTokens,
				});
				logger.info("[filter-email-links] filtered", {
					receivedAtMessageId: detail.receivedAtMessageId,
					decision: outcome.decision,
					kept: outcome.filings.length,
					dropped: countVerdict({ fit: outcome.fit, verdict: "drop" }),
					unsure: countVerdict({ fit: outcome.fit, verdict: "unsure" }),
				});
			} catch (error) {
				logger.error("[filter-email-links] record failed", {
					messageId: record.messageId,
					error,
				});
				const failure = describeAiProviderError(error);
				if (failure.kind !== "unknown") {
					assert(failureIds, "a provider error comes only after the record parsed");
					deepseekCallFailedLog.error(
						deepseekCallFailedLogLine({
							feature: "filter-email-links",
							failure,
							receiveCount: Number(record.attributes.ApproximateReceiveCount),
							messageId: record.messageId,
							ids: failureIds,
						}),
					);
				}
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
