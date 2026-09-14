import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	FindReadCandidatesAcrossReadlists,
	FindRelatedTargetArticle,
	MarkPastReadsReady,
	PastReadLink,
	ReadPastReadsState,
} from "@packages/provider-contracts/related-articles";
import {
	ComputeRelatedPastReadsCommand,
	RelatedPastReadsComputedEvent,
} from "./index";
import { computePastReadsFingerprint } from "./related-past-reads-fingerprint";
import { RELATED_CANDIDATES_MAX } from "./related-articles-limits";
import type { SelectRelatedArticles } from "./related-articles-selector";

interface ComputeRelatedPastReadsHandlerDeps {
	findRelatedTargetArticle: FindRelatedTargetArticle;
	findReadCandidatesAcrossReadlists: FindReadCandidatesAcrossReadlists;
	readPastReadsState: ReadPastReadsState;
	selectPastReads: SelectRelatedArticles;
	markPastReadsReady: MarkPastReadsReady;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
}

class MetadataNotReadyError extends Error {
	readonly url: string;
	constructor(url: string) {
		super(`[ComputeRelatedPastReads] article metadata not ready for ${url}`);
		this.url = url;
	}
}

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
		publishEvent,
		now,
		logger,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const entry = ComputeRelatedPastReadsCommand.detailSchema.parse(
					envelope.detail,
				);
				const userId = UserIdSchema.parse(entry.userId);

				const store = async (
					pastReads: readonly PastReadLink[],
					fingerprint: string,
					tokens: { inputTokens: number; outputTokens: number },
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
						url: entry.url,
						relatedCount: pastReads.length,
					});
				};

				const lookup = await findRelatedTargetArticle(entry.url);
				if (lookup.state === "purged") {
					logger.info("[ComputeRelatedPastReads] target purged; nothing to compare", {
						url: entry.url,
					});
					continue;
				}
				if (lookup.state === "absent" || lookup.article.crawlStatus === "pending") {
					throw new MetadataNotReadyError(entry.url);
				}
				const target = lookup.article;

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
					await store([], fingerprint, { inputTokens: 0, outputTokens: 0 });
					continue;
				}

				const result = await selectPastReads({
					target,
					unreadCandidates: [],
					readCandidates: candidates,
				});
				if (result.kind === "shared-boilerplate") {
					await store([], fingerprint, { inputTokens: 0, outputTokens: 0 });
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
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
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
				}
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
