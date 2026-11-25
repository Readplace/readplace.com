import assert from "node:assert";
import {
	type DeepseekCallFailedLogLine,
	deepseekCallFailedLogLine,
	describeAiProviderError,
} from "@packages/ai-message";
import { isNonArticleHost, ReaderArticleHashId, type SavedArticle } from "@packages/domain/article";
import { parseReadlistPurposeFields, readlistPurposeVersion, type ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	MatchSmartReadlistsCommand,
	SmartReadlistsMatchedEvent,
	type SmartReadlistsMatchedDetail,
} from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type {
	FileIntoLiveReadlist,
	FindArticleById,
	FindSmartMatchRevisions,
	ListReadlistDefinitions,
	ListReadlistFitOverrides,
	ReadlistDefinitionData,
	RecordSmartMatchRevision,
} from "@packages/provider-contracts/article-store";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { type DecideReadlistFit, READLIST_FIT_EXAMPLES_MAX } from "@packages/readlist-fit";
import { resolvePlanAccess } from "@packages/subscription-access";
import type { SQSBatchResponse, SQSEvent, Handler } from "aws-lambda";
import type { SmartReadlistMatchDecidedLine } from "./smart-readlist-match-log-lines.types";

export class SmartMatchMetadataPendingError extends Error {
	constructor(storedKey: string) {
		super(`[match-smart-readlists] crawl of ${storedKey} is still pending`);
		this.name = "SmartMatchMetadataPendingError";
	}
}

type MatchedReadlist = SmartReadlistsMatchedDetail["readlists"][number];
type SmartDefinition = ReadlistDefinitionData & { filing: { mode: "smart"; revision: number; effectiveAt: Date } };

function isSmart(definition: ReadlistDefinitionData): definition is SmartDefinition {
	return definition.filing?.mode === "smart";
}

export function initMatchSmartReadlistsHandler(deps: {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findSmartMatchRevisions: FindSmartMatchRevisions;
	recordSmartMatchRevision: RecordSmartMatchRevision;
	listReadlistDefinitions: ListReadlistDefinitions;
	listReadlistFitOverrides: ListReadlistFitOverrides;
	findArticleById: FindArticleById;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	fileIntoLiveReadlist: FileIntoLiveReadlist;
	decideReadlistFit: DecideReadlistFit;
	publishEvent: PublishEvent;
	logger: Logger;
	decisionLog: Logger.Typed<SmartReadlistMatchDecidedLine>;
	deepseekCallFailedLog: Logger.Typed<DeepseekCallFailedLogLine>;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { logger, publishEvent } = deps;

	const matchOne = async (params: {
		userId: UserId;
		storedKey: string;
		definition: SmartDefinition;
		article: SavedArticle;
		savedAt: Date;
	}): Promise<MatchedReadlist> => {
		const { userId, storedKey, definition, article, savedAt } = params;
		const readlist: ReadlistSlug = definition.slug;
		const purpose = definition.purpose;
		assert(purpose !== undefined, "a smart readlist always carries a purpose");
		const purposeVersion = readlistPurposeVersion(purpose);
		const overrides = await deps.listReadlistFitOverrides({ userId, readlist });
		const provenance = article.provenance ?? { kind: "web" };
		const result = await deps.decideReadlistFit({
			purpose: { ...parseReadlistPurposeFields(purpose), version: purposeVersion },
			examples: overrides
				.slice(0, READLIST_FIT_EXAMPLES_MAX)
				.map((override) => ({ text: override.anchorText, host: override.host, verdict: override.readerVerdict })),
			candidates: [
				{ id: "0000", url: article.url, text: [article.metadata.title, article.metadata.excerpt].join("\n") },
			],
			...(provenance.kind === "email"
				? { context: { subject: article.metadata.title, senderEmail: provenance.senderEmail } }
				: {}),
		});
		const decision = result.decisions.find(({ id }) => id === "0000");
		const verdict = decision?.verdict ?? "unsure";
		let filing: MatchedReadlist["filing"];
		if (verdict === "keep") {
			const readAt = article.readAt;
			const landsAs = readAt !== undefined && readAt >= savedAt ? { status: "read" as const, readAt } : { status: "unread" as const };
			const filed = await deps.fileIntoLiveReadlist({
				userId,
				readlist,
				url: article.url,
				savedAt: article.savedAt,
				provenance,
				requestedAt: savedAt,
				landsAs,
				smartRule: { revision: definition.filing.revision },
			});
			filing = filed.outcome;
		}
		await deps.recordSmartMatchRevision({ userId, storedKey, readlist, revision: definition.filing.revision });
		deps.decisionLog.info({
			level: "INFO",
			event: "smart-readlist-match-decided",
			userId,
			readlist,
			storedKey,
			revision: definition.filing.revision,
			verdict,
			reason: decision?.reason ?? "The model returned no decision.",
			...(filing === undefined ? {} : { filing }),
			engine: result.engine,
			model: result.model,
			purposeVersion,
			...result.usage,
		});
		return {
			readlist,
			revision: definition.filing.revision,
			verdict,
			...(filing === undefined ? {} : { filing }),
		};
	};

	const finish = (detail: Omit<SmartReadlistsMatchedDetail, "readlists"> & { readlists?: MatchedReadlist[] }) =>
		publishEvent(SmartReadlistsMatchedEvent, { ...detail, readlists: detail.readlists ?? [] });

	return initSqsRecordHandler({
		definition: MatchSmartReadlistsCommand,
		logger,
		malformed: { policy: "retry" },
		failure: {
			report: async ({ record, error, detail }) => {
				const { messageId, receiveCount } = record;
				if (error instanceof SmartMatchMetadataPendingError) {
					logger.info("[match-smart-readlists] waiting for the crawl", { messageId, receiveCount });
					return;
				}
				logger.error("[match-smart-readlists] record failed", { messageId, error });
				const failure = describeAiProviderError(error);
				if (failure.kind !== "unknown") {
					assert(detail, "a provider error comes only after the record parsed");
					deps.deepseekCallFailedLog.error(
						deepseekCallFailedLogLine({
							feature: "match-smart-readlists",
							failure,
							receiveCount,
							messageId,
							ids: { userId: detail.userId },
						}),
					);
				}
			},
		},
		handle: async (detail) => {
			const { userId, storedKey } = detail;
			const savedAt = new Date(detail.savedAt);
			if (resolvePlanAccess(await deps.findSubscriptionByUserId(userId), deps.now()) === "free") {
				logger.info("[match-smart-readlists] free plan", { userId });
				await finish({ userId, storedKey, outcome: "paid-plan-required" });
				return;
			}
			const matched = await deps.findSmartMatchRevisions({ userId, storedKey });
			if (matched.kind === "not-in-all") {
				await finish({ userId, storedKey, outcome: "not-in-all" });
				return;
			}
			const definitions = await deps.listReadlistDefinitions(userId);
			const eligible = definitions
				.filter(isSmart)
				.filter(
					(definition) =>
						definition.filing.effectiveAt <= savedAt &&
						(matched.revisions.get(definition.slug) ?? 0) < definition.filing.revision,
				);
			if (eligible.length === 0) {
				await finish({ userId, storedKey, outcome: "nothing-to-match" });
				return;
			}
			const article = await deps.findArticleById(ReaderArticleHashId.fromResourceUniqueId(storedKey), userId);
			assert(article, "a save in All always has an article row");
			if (isNonArticleHost(article.url)) {
				await finish({ userId, storedKey, outcome: "not-an-article" });
				return;
			}
			const crawl = await deps.findArticleCrawlStatus(article.url);
			if (crawl?.status === "pending") throw new SmartMatchMetadataPendingError(storedKey);
			const settled = await Promise.allSettled(
				eligible.map((definition) => matchOne({ userId, storedKey, definition, article, savedAt })),
			);
			const readlists = settled.map((outcome) => {
				if (outcome.status === "rejected") throw outcome.reason;
				return outcome.value;
			});
			await finish({ userId, storedKey, outcome: "matched", readlists });
		},
	});
}
