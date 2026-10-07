import { wrapperFamilyOf } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { candidateProvenance } from "../select-content/candidate-provenance";
import { initResolveSubmittedSource } from "../select-content/resolve-submitted-source";
import type { VerifyWrapperSource } from "@packages/save-article";
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
import { type FinalizeArticle, UNREADABLE_ARTICLE } from "@packages/finalize-article";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { ReadPendingHtml } from "../../providers/article-store/read-pending-html";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";

const TIER = "tier-0";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveLinkRawHtmlCommandHandler(deps: {
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
	readPendingHtml: ReadPendingHtml;
	finalizeArticle: FinalizeArticle;
	putTierSource: PutTierSource;
	publishEvent: PublishEvent;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
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
		now,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
	} = deps;

	const resolveSubmittedSource = initResolveSubmittedSource(deps);
	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SaveLinkRawHtmlCommand.detailSchema.parse(envelope.detail);
				const { saveAttemptId } = detail;
				const originalUrl = await resolveSubmittedSource(detail);

				const { html: rawHtml, capturedAt } = await readPendingHtml(detail.url, { saveAttemptId });
				const finalized = await finalizeArticle({
					writeContext: { url: detail.url, attemptId: saveAttemptId, authorUserId: UserIdSchema.parse(detail.userId) },
					url: originalUrl,
					documentUrl: detail.sourceUrl,
					html: rawHtml,
				});
				if (!finalized.ok && wrapperFamilyOf(detail.sourceUrl) === undefined) {
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
					 * failed state right away instead of polling until SQS exhausts
					 * retries and the failure path marks failed. Snapshot is read above
					 * before this flip so otherTierStatus reflects tier-1's pre-flip
					 * state. Re-throw preserves the SQS retry + observability path —
					 * the surrounding try/catch routes the throw to batchItemFailures so
					 * sibling records still settle when a batch holds more than one. */
					await transitionAndPersist(markCrawlFailed, {
						url: detail.url,
						input: {
							reason: { kind: "parse-error", detail: finalized.reason },
						},
					});
					throw new Error(`save-link-raw-html parse failed for ${detail.url}: ${finalized.reason}`);
				}

				const article = finalized.ok ? finalized.article : UNREADABLE_ARTICLE;
				const metadata = candidateProvenance({ metadata: { ...article.metadata, authorUserId: detail.userId }, html: article.html, evaluationHtml: rawHtml, attemptId: saveAttemptId, originalUrl, sourceUrl: detail.sourceUrl, kind: "extension", fetchedAt: capturedAt });
				await putTierSource({
					url: detail.url,
					tier: TIER,
					html: article.html,
					metadata,
					evaluationHtml: rawHtml,
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
					saveAttemptId,
					candidates: [{ id: metadata.id, tier: TIER }],
					url: detail.url,
					userId: detail.userId,
					extractedAt: now().toISOString(),
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
