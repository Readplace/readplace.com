import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	markCrawlFailed,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import {
	SaveLinkRawHtmlCommand,
	TierContentExtractedEvent,
	type LogCrawlOutcome,
	type LogParseError,
} from "@packages/hutch-infra-components";
import type { FinalizeArticle } from "../save-link/finalize-article";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { ReadPendingHtml } from "../../providers/article-store/read-pending-html";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";

const TIER = "tier-0";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveLinkRawHtmlCommandHandler(deps: {
	readPendingHtml: ReadPendingHtml;
	finalizeArticle: FinalizeArticle;
	putTierSource: PutTierSource;
	publishEvent: PublishEvent;
	transitionAndPersist: TransitionAndPersist;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		readPendingHtml,
		finalizeArticle,
		putTierSource,
		publishEvent,
		transitionAndPersist,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SaveLinkRawHtmlCommand.detailSchema.parse(envelope.detail);

				const rawHtml = await readPendingHtml(detail.url);
				const finalized = await finalizeArticle({
					url: detail.url,
					html: rawHtml,
				});
				if (!finalized.ok) {
					logParseError({ url: detail.url, reason: finalized.reason });
					const snapshot = await readTierSnapshot({ url: detail.url });
					logCrawlOutcome({
						url: detail.url,
						thisTier: TIER,
						thisTierStatus: "failed",
						otherTierStatus: snapshot.tier1Status,
						pickedTier: snapshot.pickedTier,
					});
					/* Parse errors are terminal on the same HTML — re-running yields the
					 * same failure. Flip crawlStatus immediately so the reader shows a
					 * failed state at t+0 instead of polling for ~90s until SQS exhausts
					 * retries and the DLQ handler marks failed. Snapshot is read above
					 * before this flip so otherTierStatus reflects tier-1's pre-flip
					 * state. Re-throw preserves the SQS retry + DLQ observability path —
					 * the surrounding try/catch routes the throw to batchItemFailures so
					 * sibling records still settle under any future batchSize > 1. */
					await transitionAndPersist(markCrawlFailed, {
						url: detail.url,
						input: {
							reason: { kind: "parse-error", detail: finalized.reason },
						},
					});
					throw new Error(`save-link-raw-html parse failed for ${detail.url}: ${finalized.reason}`);
				}

				await putTierSource({
					url: detail.url,
					tier: TIER,
					html: finalized.article.html,
					metadata: finalized.article.metadata,
				});
				logger.info("[SaveLinkRawHtmlCommand] tier-0 source written", {
					url: detail.url,
					// Captured tab title from the extension — often includes site branding
					// and may differ from the readability-extracted title. Useful in logs
					// for correlating a save with what the user actually had open.
					capturedTitle: detail.title,
				});

				const snapshot = await readTierSnapshot({ url: detail.url });
				logCrawlOutcome({
					url: detail.url,
					thisTier: TIER,
					thisTierStatus: "success",
					otherTierStatus: snapshot.tier1Status,
					pickedTier: snapshot.pickedTier,
				});

				await publishEvent(TierContentExtractedEvent, {
					url: detail.url,
					tier: TIER,
					userId: detail.userId,
				});
			} catch (error) {
				logger.error("[SaveLinkRawHtmlCommand] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
