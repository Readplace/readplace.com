import assert from "node:assert";
import {
	type DeepseekCallFailedLogLine,
	deepseekCallFailedLogLine,
	describeAiProviderError,
} from "@packages/ai-message";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { z } from "zod";
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
import { type UserId, UserIdSchema } from "@packages/domain/user";
import {
	EmailLinksFilteredEvent,
	EmailLinksFilterFailedEvent,
	EmailLinksTriagedEvent,
	FileArticleIntoReadlistCommand,
	type FileArticleIntoReadlistDetail,
} from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type {
	ListReadlistDefinitions,
	ListReadlistFitOverrides,
	ReadlistDefinitionData,
} from "@packages/provider-contracts/article-store";
import {
	type DecideReadlistFit,
	READLIST_FIT_EXAMPLES_MAX,
	type ReadlistFitEngine,
	type ReadlistFitExample,
	type ReadlistFitVerdict,
} from "@packages/readlist-fit";
import { FILTER_EMAIL_LINKS_MAX_RECEIVE_COUNT } from "./max-receive-count";
import type { ReadlistFitDecidedLine, ReadlistFitUnsureLine } from "./readlist-fit-log-lines.types";

const FailedTriageIds = z.object({
	detail: z.object({ userId: UserIdSchema, receivedAtMessageId: z.string(), readlist: z.string() }),
});

function failedTriageIds(body: string) {
	let envelope: unknown;
	try {
		envelope = JSON.parse(body);
	} catch {
		return undefined;
	}
	const parsed = FailedTriageIds.safeParse(envelope);
	return parsed.success ? parsed.data.detail : undefined;
}

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
	listReadlistFitOverrides: ListReadlistFitOverrides;
	decideReadlistFit: DecideReadlistFit;
	publishEvent: PublishEvent;
	logger: Logger;
	fitDecidedLog: Logger.Typed<ReadlistFitDecidedLine>;
	fitUnsureLog: Logger.Typed<ReadlistFitUnsureLine>;
	deepseekCallFailedLog: Logger.Typed<DeepseekCallFailedLogLine>;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		listReadlistDefinitions,
		listReadlistFitOverrides,
		decideReadlistFit,
		publishEvent,
		logger,
		fitDecidedLog,
		fitUnsureLog,
		deepseekCallFailedLog,
		now,
	} = deps;

	const decideFor = async (input: {
		userId: UserId;
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

		const overrides = await listReadlistFitOverrides({ userId, readlist });
		const examples = overrides.slice(0, READLIST_FIT_EXAMPLES_MAX).map(
			(override): ReadlistFitExample => ({
				text: override.anchorText,
				host: override.host,
				verdict: override.readerVerdict,
			}),
		);

		const startedAt = now();
		const { decisions, engine, model, usage } = await decideReadlistFit({
			purpose: { ...parseReadlistPurposeFields(purpose), version: purposeVersion },
			examples,
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

	return initSqsRecordHandler({
		definition: EmailLinksTriagedEvent,
		logger,
		malformed: { policy: "retry" },
		failure: {
			report: async ({ record, error, detail }) => {
				const { messageId, receiveCount } = record;
				logger.error("[filter-email-links] record failed", {
					messageId,
					error,
				});
				const failure = describeAiProviderError(error);
				if (failure.kind !== "unknown") {
					assert(detail, "a provider error comes only after the record parsed");
					deepseekCallFailedLog.error(
						deepseekCallFailedLogLine({
							feature: "filter-email-links",
							failure,
							receiveCount,
							messageId,
							ids: {
								userId: detail.userId,
								receivedAtMessageId: detail.receivedAtMessageId,
								readlist: detail.readlist,
							},
						}),
					);
				}
				const failedIds = failedTriageIds(record.body);
				if (failedIds !== undefined && receiveCount >= FILTER_EMAIL_LINKS_MAX_RECEIVE_COUNT) {
					await publishEvent(EmailLinksFilterFailedEvent, {
						...failedIds,
						reason: "decision-retries-exhausted",
						receiveCount,
					});
				}
			},
		},
		handle: async (detail) => {
			const { userId } = detail;
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
		},
	});
}
