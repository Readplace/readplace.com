import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	markSummaryReady,
	markSummarySkipped,
	type LoadArticle,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { GenerateSummaryCommand } from "./index";
import type { SummarizeArticle } from "./link-summariser";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";

interface GenerateSummaryHandlerDeps {
	summarizeArticle: SummarizeArticle;
	findArticleContent: FindArticleContent;
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	logger: HutchLogger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initGenerateSummaryHandler(deps: GenerateSummaryHandlerDeps): Handler<SQSEvent, SQSBatchResponse> {
	const { summarizeArticle, findArticleContent, loadArticle, transitionAndPersist, now, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = GenerateSummaryCommand.detailSchema.parse(envelope.detail);

				/* Cache check via the aggregate's loader — `ready` and `skipped` are
				 * terminal, short-circuit those. `failed` is retryable on redrive so
				 * a new attempt re-runs the AI. */
				const existing = await loadArticle(command.url);
				if (
					existing &&
					(existing.summary.kind === "ready" ||
						existing.summary.kind === "skipped")
				) {
					logger.info("[GenerateSummary] cache hit", {
						url: command.url,
						kind: existing.summary.kind,
					});
					continue;
				}

				const article = await findArticleContent(command.url);
				assert(article, `Article content not found: ${command.url}`);

				const result = await summarizeArticle({
					url: command.url,
					textContent: article.content,
				});

				if (result.kind === "ready") {
					/* Tag the persisted ready summary with the hash of the canonical
					 * content it was generated against so a future caller can compare
					 * hashes and short-circuit on cacheability. */
					const sourceContentHash = computeCanonicalContentHash(article.content);
					await transitionAndPersist(markSummaryReady, {
						url: command.url,
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
					});
					continue;
				}

				if (result.kind === "skipped") {
					await transitionAndPersist(markSummarySkipped, {
						url: command.url,
						input: { reason: result.reason, now: now().toISOString() },
					});
					logger.info("[GenerateSummary] skipped", {
						url: command.url,
						reason: result.reason,
					});
					continue;
				}

				/* no-text-block: the AI returned but the response had no parseable
				 * text. Throw so the catch block adds the record to
				 * batchItemFailures — SQS redelivery re-runs; eventual DLQ
				 * exhaustion flips the row via markSummaryFailed. */
				throw new Error(`[GenerateSummary] ${result.kind satisfies "no-text-block"} for ${command.url}`);
			} catch (error) {
				logger.error("[GenerateSummary] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
