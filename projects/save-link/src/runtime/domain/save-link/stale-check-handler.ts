import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	decideSummaryAutoHeal,
	incrementSummaryAutoHealAttempt,
	type LoadArticle,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { StaleCheckRequestedEvent } from "@packages/hutch-infra-components";
import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type { PublishSaveAnonymousLink } from "@packages/test-fixtures/providers/events";

export function initStaleCheckHandler(deps: {
	refreshArticleIfStale: RefreshArticleIfStale;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		refreshArticleIfStale,
		publishSaveAnonymousLink,
		loadArticle,
		transitionAndPersist,
		now,
		logger,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = StaleCheckRequestedEvent.detailSchema.parse(envelope.detail);

				logger.info("[StaleCheckRequested] processing", { url: detail.url });

				const result = await refreshArticleIfStale({ url: detail.url });

				if (result.action === "new") {
					await publishSaveAnonymousLink({ url: detail.url });
					logger.info("[StaleCheckRequested] re-published SaveAnonymousLinkCommand", {
						url: detail.url,
						action: result.action,
					});
				} else {
					logger.info("[StaleCheckRequested] no-op", {
						url: detail.url,
						action: result.action,
					});
				}

				/* Summary auto-heal: reprime a summary-failed row once per
				 * stale-check tick, bounded by the attempt budget + TTL gate.
				 * Runs after refreshArticleIfStale so a successful refresh
				 * (which resets summary to pending) skips the heal naturally. */
				const article = await loadArticle(detail.url);
				if (article !== undefined) {
					const decision = decideSummaryAutoHeal(article, now());
					if (decision === "reprime") {
						await transitionAndPersist(incrementSummaryAutoHealAttempt, {
							url: detail.url,
							input: { now: now().toISOString() },
						});
						logger.info("[StaleCheckRequested] reprimed summary auto-heal", {
							url: detail.url,
							attempts: article.summaryAutoHeal.attempts + 1,
						});
					}
				}
			} catch (error) {
				logger.error("[StaleCheckRequested] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
