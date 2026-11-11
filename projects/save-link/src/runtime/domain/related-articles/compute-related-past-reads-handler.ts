import assert from "node:assert";
import type { RecommendationTrigger, SelectionSample } from "./related-articles-selector";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { Logger } from "@packages/logger";
import { type DeepseekCallFailedLogLine, describeAiProviderError, deepseekCallFailedLogLine } from "@packages/ai-message";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type {
	FindReadCandidatesAcrossReadlists,
	FindRelatedTargetArticle,
	MarkPastReadsBudgetBlocked,
	MarkPastReadsReady,
	PastReadLink,
	ReadPastReadsState,
} from "@packages/provider-contracts/related-articles";
import {
	ComputeRelatedPassesCommand,
	ComputeRelatedPastReadsCommand,
	QueueEntryCreatedEvent,
	RelatedPastReadsComputedEvent,
} from "./index";
import { COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT } from "./max-receive-count";
import { computePastReadsFingerprint } from "./related-past-reads-fingerprint";
import { RELATED_CANDIDATES_MAX } from "./related-articles-limits";
import type { SelectRelatedArticles } from "./related-articles-selector";

interface ComputeRelatedPastReadsHandlerDeps {
	findRelatedTargetArticle: FindRelatedTargetArticle;
	findReadCandidatesAcrossReadlists: FindReadCandidatesAcrossReadlists;
	readPastReadsState: ReadPastReadsState;
	selectPastReads: SelectRelatedArticles;
	markPastReadsReady: MarkPastReadsReady;
	markPastReadsBudgetBlocked: MarkPastReadsBudgetBlocked;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
	deepseekCallFailedLog: Logger.Typed<DeepseekCallFailedLogLine>;
}

class MetadataNotReadyError extends Error {
	readonly url: string;
	constructor(url: string) {
		super(`[ComputeRelatedPastReads] article metadata not ready for ${url}`);
		this.url = url;
	}
}

const TRIGGER_BY_DETAIL_TYPE: Record<string, RecommendationTrigger> = {
	[QueueEntryCreatedEvent.detailType]: "save",
	[ComputeRelatedPassesCommand.detailType]: "reader-request",
	[ComputeRelatedPastReadsCommand.detailType]: "reader-request",
};

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initComputeRelatedPastReadsHandler(
	deps: ComputeRelatedPastReadsHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const {
		findRelatedTargetArticle,
		findReadCandidatesAcrossReadlists,
		readPastReadsState,
		selectPastReads,
		markPastReadsReady,
		markPastReadsBudgetBlocked,
		publishEvent,
		now,
		logger,
		deepseekCallFailedLog,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const entry = ComputeRelatedPastReadsCommand.detailSchema.parse(
					envelope.detail,
				);
				const { userId } = entry;
				const trigger = TRIGGER_BY_DETAIL_TYPE[envelope["detail-type"]];
				assert(trigger, `[ComputeRelatedPastReads] unexpected detail-type ${envelope["detail-type"]}`);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);

				const store = async (
					pastReads: readonly PastReadLink[],
					fingerprint: string,
					tokens: {
						samples: SelectionSample[];
						inputTokens: number;
						outputTokens: number;
						droppedNoSharedWord: number;
						droppedReasonNotAboutPick: number;
					},
				): Promise<void> => {
					const outcome = await markPastReadsReady({
						userId,
						url: entry.url,
						pastReads,
						fingerprint,
						inputTokens: tokens.inputTokens,
						outputTokens: tokens.outputTokens,
						at: now(),
					});
					if (outcome === "superseded") {
						logger.info("[ComputeRelatedPastReads] superseded", { url: entry.url });
						return;
					}
					await publishEvent(RelatedPastReadsComputedEvent, {
						url: entry.url,
						userId,
						outcome: "ready",
						relatedCount: pastReads.length,
						inputTokens: tokens.inputTokens,
						outputTokens: tokens.outputTokens,
					});
					logger.info("[ComputeRelatedPastReads] completed", {
						sampleCount: tokens.samples.length,
						samples: tokens.samples,
						url: entry.url,
						relatedCount: pastReads.length,
						droppedNoSharedWord: tokens.droppedNoSharedWord,
						droppedReasonNotAboutPick: tokens.droppedReasonNotAboutPick,
					});
				};

				const lookup = await findRelatedTargetArticle(entry.url);
				if (lookup.state === "purged") {
					logger.info("[ComputeRelatedPastReads] target purged; nothing to compare", {
						url: entry.url,
					});
					continue;
				}
				if (lookup.state === "not-an-article") {
					logger.info("[ComputeRelatedPastReads] target is not an article; nothing to compare", {
						url: entry.url,
					});
					continue;
				}
				if (lookup.state === "absent") {
					if (receiveCount < COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT) {
						throw new MetadataNotReadyError(entry.url);
					}
					logger.info("[ComputeRelatedPastReads] skipped; article row gone after the wait", {
						url: entry.url,
					});
					continue;
				}
				const target = lookup.article;
				if (target.crawlStatus === "pending") {
					if (receiveCount < COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT) {
						throw new MetadataNotReadyError(entry.url);
					}
					logger.info("[ComputeRelatedPastReads] skipped; crawl still pending after the wait", {
						url: entry.url,
					});
					continue;
				}

				const { candidates } = await findReadCandidatesAcrossReadlists({
					userId,
					excludeUrl: entry.url,
					limit: RELATED_CANDIDATES_MAX,
				});

				const fingerprint = computePastReadsFingerprint({
					target: { url: entry.url, ...target },
					candidateUrls: candidates.map((candidate) => candidate.url),
				});
				const state = await readPastReadsState({ userId, url: entry.url });
				if (state.fingerprint === fingerprint) {
					await publishEvent(RelatedPastReadsComputedEvent, {
						url: entry.url,
						userId,
						outcome: "unchanged",
						relatedCount: 0,
						inputTokens: 0,
						outputTokens: 0,
					});
					logger.info("[ComputeRelatedPastReads] inputs unchanged; kept cache", {
						url: entry.url,
					});
					continue;
				}

				if (target.hasStubMetadata) {
					await store([], fingerprint, { samples: [], inputTokens: 0, outputTokens: 0, droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0 });
					continue;
				}

				const result = await selectPastReads({
					attempt: { userId, trigger, messageId: record.messageId, receiveCount },
					target,
					unreadCandidates: [],
					readCandidates: candidates,
				});
				if (result.kind === "shared-boilerplate") {
					await store([], fingerprint, { samples: [], inputTokens: 0, outputTokens: 0, droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0 });
					continue;
				}
				if (result.kind === "no-shared-words") {
					logger.info("[ComputeRelatedPastReads] no earlier read shares the article's words", {
						url: entry.url,
						bestScore: result.bestScore,
						candidateCount: result.candidateCount,
					});
					await store([], fingerprint, { samples: [], inputTokens: 0, outputTokens: 0, droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0 });
					continue;
				}
				if (result.kind === "budget-limited") {
					if (state.savedAt === undefined) {
						logger.info("[ComputeRelatedPastReads] superseded", { url: entry.url });
						continue;
					}
					const outcome = await markPastReadsBudgetBlocked({
						userId,
						url: entry.url,
						blockedUntil: result.resetsAt,
						observed: {
							savedAt: state.savedAt,
							...(state.computedAt !== undefined ? { computedAt: state.computedAt } : {}),
						},
					});
					if (outcome === "superseded") {
						logger.info("[ComputeRelatedPastReads] superseded", { url: entry.url });
						continue;
					}
					logger.info("[ComputeRelatedPastReads] budget-limited", {
						url: entry.url,
						resetsAt: result.resetsAt,
						receiveCount,
					});
					continue;
				}
				if (result.kind === "no-text-block") {
					throw new Error(
						`[ComputeRelatedPastReads] ${result.kind satisfies "no-text-block"} for ${entry.url}`,
					);
				}

				const readlistByUrl = new Map(
					candidates.map((candidate) => [candidate.url, candidate.readlist]),
				);
				const pastReads: PastReadLink[] = result.related.map((link) => {
					const readlist = readlistByUrl.get(link.url);
					return readlist === undefined
						? { url: link.url, reason: link.reason }
						: { url: link.url, reason: link.reason, readlist };
				});
				await store(pastReads, fingerprint, {
					samples: result.samples,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
					droppedNoSharedWord: result.droppedNoSharedWord,
					droppedReasonNotAboutPick: result.droppedReasonNotAboutPick,
				});
			} catch (error) {
				if (error instanceof MetadataNotReadyError) {
					logger.info(
						"[ComputeRelatedPastReads] waiting for crawl metadata; redelivery scheduled",
						{ url: error.url, messageId: record.messageId },
					);
				} else {
					logger.error("[ComputeRelatedPastReads] record failed", {
						messageId: record.messageId,
						error,
					});
					const failure = describeAiProviderError(error);
					if (failure.kind !== "unknown") {
						deepseekCallFailedLog.error(deepseekCallFailedLogLine({
							feature: "compute-related-past-reads",
							failure,
							receiveCount: Number(record.attributes.ApproximateReceiveCount),
							messageId: record.messageId,
							ids: {},
						}));
					}
				}
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
