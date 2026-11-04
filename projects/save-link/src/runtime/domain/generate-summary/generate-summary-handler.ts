import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { type DeepseekCallFailedLogLine, describeAiProviderError, deepseekCallFailedLogLine } from "@packages/ai-message";
import {
	isCanonicalCandidateRevoked,
	markSummaryExhausted,
	markSummaryReady,
	markSummarySkipped,
	summaryMatchesCanonical,
	type LoadArticle,
	type SelectionExpected,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { GenerateSummaryCommand } from "./index";
import type { SummarizeArticle, SummarizeResult } from "./link-summariser";
import type { RunMeteredLeg } from "../metered-leg/run-metered-leg";
import { GENERATE_SUMMARY_TIMEOUTS } from "./timeouts";
import type { FindArticleContent } from "../save-link/article-content.types";
import { computeCanonicalContentHash } from "./compute-canonical-content-hash";
import { GENERATE_SUMMARY_MAX_RECEIVE_COUNT } from "./max-receive-count";

interface GenerateSummaryHandlerDeps {
	summarizeArticle: SummarizeArticle;
	runMeteredLeg: RunMeteredLeg;
	findArticleContent: FindArticleContent;
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	logger: Logger;
	deepseekCallFailedLog: Logger.Typed<DeepseekCallFailedLogLine>;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initGenerateSummaryHandler(deps: GenerateSummaryHandlerDeps): Handler<SQSEvent, SQSBatchResponse> {
	const { summarizeArticle, runMeteredLeg, findArticleContent, loadArticle, transitionAndPersist, now, logger, deepseekCallFailedLog } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			let url: string | undefined;
			try {
				const envelope = JSON.parse(record.body);
				const command = GenerateSummaryCommand.detailSchema.parse(envelope.detail);
				url = command.url;

				/* `failed` is retryable on redrive so a new attempt re-runs the AI. */
				const existing = await loadArticle(command.url);
				const selectionExpected: SelectionExpected = { scope: "canonical-content", snapshot: existing?.contentSelection };
				const candidateRevoked = isCanonicalCandidateRevoked(existing?.contentSelection);
				const validReadySummary = existing?.summary.kind === "ready" &&
					summaryMatchesCanonical({ candidateId: existing.contentSelection?.candidateId, summarySourceContentHash: existing.summary.sourceContentHash, canonicalContentHash: existing.freshness.canonicalContentHash });
				if (
					existing &&
					!candidateRevoked &&
					(validReadySummary ||
						existing.summary.kind === "skipped")
				) {
					logger.info("[GenerateSummary] cache hit", {
						url: command.url,
						kind: existing.summary.kind,
					});
					continue;
				}

				const article = await findArticleContent(command.url);
				/* Terminal crawl without canonical content is not a race — the crawl
				 * gave up, so no content will ever arrive. Collapse the summary to
				 * skipped (the same terminal outcome markCrawlBlocked/markCrawlNotFound
				 * write) so the auto-heal loop stops repriming this row forever. A
				 * pending crawl (content still landing) or a ready crawl (content
				 * genuinely missing) keeps the assert → retry → DLQ path below. */
				if (
					!article &&
					existing &&
					(existing.crawl.kind === "failed" || existing.crawl.kind === "unsupported")
				) {
					await transitionAndPersist(markSummarySkipped, {
						url: command.url,
						selectionExpected,
						input: {
							reason: existing.crawl.kind === "failed" ? "crawl-failed" : "crawl-unsupported",
							now: now().toISOString(),
						},
					});
					logger.info("[GenerateSummary] crawl terminal without canonical content — marking summary skipped", {
						url: command.url,
						crawl: existing.crawl.kind,
					});
					continue;
				}
				assert(article, `Article content not found: ${command.url}`);
				const sourceContentHash = computeCanonicalContentHash(article.content);
				if (existing?.freshness.canonicalContentHash !== undefined) assert(sourceContentHash === existing.freshness.canonicalContentHash, "summary fetched a different canonical snapshot");

				const summarized: { result?: Exclude<SummarizeResult, { kind: "ready" }> } = {};
				const leg = await runMeteredLeg({
					url: command.url,
					leg: "summary",
					inputs: [sourceContentHash, existing?.summary.kind === "pending" ? existing.summary.pendingSince : ""],
					claimId: record.messageId,
					claimTtlMs: GENERATE_SUMMARY_TIMEOUTS.sqsVisibilitySeconds * 1000,
					run: async (permit) => {
						const result = await summarizeArticle({
							url: command.url,
							textContent: article.content,
							permit,
						});
						if (result.kind !== "ready") {
							summarized.result = result;
							return { kind: "unsucceeded" };
						}
						/* Tag the persisted ready summary with the hash of the canonical
						 * content it was generated against so a future caller can compare
						 * hashes and short-circuit on cacheability. */
						await transitionAndPersist(markSummaryReady, {
							url: command.url,
							selectionExpected,
							input: {
								summary: result.summary,
								excerpt: result.excerpt,
								inputTokens: result.inputTokens,
								outputTokens: result.outputTokens,
								sourceContentHash,
								now: now().toISOString(),
							},
						});
						logger.info("[GenerateSummary] completed", {
							url: command.url,
							inputTokens: result.inputTokens,
							outputTokens: result.outputTokens,
							cacheHitInputTokens: result.cacheHitInputTokens ?? "unknown",
							cacheMissInputTokens: result.cacheMissInputTokens ?? "unknown",
						});
						return { kind: "succeeded", outcome: sourceContentHash };
					},
				});

				if (leg.kind === "deferred") {
					await transitionAndPersist(markSummarySkipped, {
						url: command.url,
						selectionExpected,
						input: { reason: "awaiting-reader", now: now().toISOString() },
					});
					logger.info("[GenerateSummary] deferred until a reader opens it", { url: command.url });
					continue;
				}

				if (leg.kind === "settled") {
					logger.info("[GenerateSummary] cache hit", { url: command.url, kind: "settled" });
					continue;
				}

				if (leg.kind === "in-flight") {
					logger.info("[GenerateSummary] summary already in flight — leaving the message for redelivery", { url: command.url });
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				if (leg.kind === "ran") continue;

				const result = summarized.result;
				assert(result, "an unsucceeded summary leg ran the summariser");

				if (result.kind === "skipped") {
					await transitionAndPersist(markSummarySkipped, {
						url: command.url,
						selectionExpected,
						input: { reason: result.reason, now: now().toISOString() },
					});
					logger.info("[GenerateSummary] skipped", {
						url: command.url,
						reason: result.reason,
					});
					continue;
				}

				const receiveCount = Number(record.attributes.ApproximateReceiveCount);
				if (result.kind === "declined") {
					if (receiveCount >= GENERATE_SUMMARY_MAX_RECEIVE_COUNT) {
						await transitionAndPersist(markSummarySkipped, {
							url: command.url,
							selectionExpected,
							input: { reason: "declined", now: now().toISOString() },
						});
						logger.info("[GenerateSummary] declined on the final receive — marking summary skipped", {
							url: command.url,
							receiveCount,
						});
						continue;
					}
					logger.info("[GenerateSummary] declined — leaving the message for redelivery", {
						url: command.url,
						receiveCount,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				if (result.kind === "unusable-answer" && receiveCount < GENERATE_SUMMARY_MAX_RECEIVE_COUNT) {
					logger.warn("[GenerateSummary] unusable-answer — leaving the message for redelivery", {
						url: command.url,
						receiveCount,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				throw new Error(`[GenerateSummary] ${result.kind satisfies "no-text-block" | "unusable-answer"} for ${command.url}`);
			} catch (error) {
				logger.error("[GenerateSummary] record failed", {
					messageId: record.messageId,
					url,
					error,
				});
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);
				const failure = describeAiProviderError(error);
				if (failure.kind !== "unknown") {
					deepseekCallFailedLog.error(
						deepseekCallFailedLogLine({
							feature: "generate-summary",
							failure,
							receiveCount,
							messageId: record.messageId,
							ids: {},
						}),
					);
				}
				if (url && receiveCount >= GENERATE_SUMMARY_MAX_RECEIVE_COUNT) {
					try {
						await transitionAndPersist(markSummaryExhausted, {
							url,
							input: { reason: { kind: "exhausted-retries" as const, receiveCount }, receiveCount },
						});
					} catch (markError) {
						logger.error(
							`[GenerateSummary] exhausted-mark record failed on receive ${receiveCount} (messageId ${record.messageId})`,
							{ url, error: markError },
						);
					}
				}
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
