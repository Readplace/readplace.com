import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { newSaveAttemptId } from "@packages/domain/article";
import { EventEnvelope } from "@packages/domain/event-envelope";
import { isCanonicalCandidateRevoked, type LoadArticle, type SaveArticle } from "@packages/domain/article-aggregate";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import {
	RecrawlLinkInitiatedEvent,
	RemoveMyContentCommand,
	ReselectAfterRemovalEvent,
} from "@packages/infra-components";
import type {
	CountSaversByUrl,
	RevokeContentCandidates,
	DeleteContentObjects,
	PruneCrawlVersions,
	PurgeArticleContent,
	ResolveAuthoredContentKeys,
	TombstoneArticle,
} from "@packages/article-store";
import type { ListAvailableTierSources } from "../select-content/list-available-tier-sources";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initRemoveMyContentCommandHandler(deps: {
	resolveAuthoredContentKeys: ResolveAuthoredContentKeys;
	revokeContentCandidates: RevokeContentCandidates;
	loadArticle: LoadArticle;
	saveArticle: SaveArticle;
	deleteContentObjects: DeleteContentObjects;
	pruneCrawlVersions: PruneCrawlVersions;
	listAvailableTierSources: ListAvailableTierSources;
	countSaversByUrl: CountSaversByUrl;
	purgeArticleContent: PurgeArticleContent;
	tombstoneArticle: TombstoneArticle;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		resolveAuthoredContentKeys,
		deleteContentObjects,
		pruneCrawlVersions,
		listAvailableTierSources,
		countSaversByUrl,
		purgeArticleContent,
		tombstoneArticle,
		publishEvent,
		now,
		logger,
	} = deps;

	return initSqsRecordHandler({
		definition: RemoveMyContentCommand,
		logger,
		failure: { message: "[RemoveMyContent] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { time: requestedAt } = EventEnvelope.parse(JSON.parse(record.body));
			const authored = await resolveAuthoredContentKeys({
				url: detail.url,
				userId: detail.userId,
				versionMinuteId: detail.versionMinuteId,
				requestedAt,
			});
			await deps.revokeContentCandidates({ url: detail.url, candidateIds: authored.candidateIds });
			await deleteContentObjects(authored.objectKeys);
			await deleteContentObjects(authored.manifestKeys);
			await pruneCrawlVersions({
				url: detail.url,
				minuteIds: authored.pruneMinuteIds,
			});
			logger.info("[RemoveMyContent] authored objects removed", {
				url: detail.url,
				objectCount: authored.objectKeys.length,
			});

			/* The canonical body is a copy of whichever tier source won selection,
			 * so an erasure only completes once that source is gone AND the copy is
			 * rebuilt. Deriving the condition from stored state rather than from
			 * what this delivery erased keeps it correct on redelivery, when the
			 * objects are already gone and nothing resolves. */
			const article = await deps.loadArticle(detail.url);
			if (article?.contentSelection?.tier === undefined) return;
			const selection = article.contentSelection;
			const canonicalTier = article.contentSelection.tier;

			const remaining = await listAvailableTierSources(detail.url);
			const reselectable = remaining.some((source) => source.metadata.id !== undefined && (source.metadata.httpStatus === undefined || (source.metadata.httpStatus >= 200 && source.metadata.httpStatus < 300)));
			const legacyCanonicalKey = ArticleResourceUniqueId.parse(detail.url).toS3ContentKey();
			if (selection.candidateId !== undefined) {
				await deleteContentObjects([legacyCanonicalKey]);
				if (!isCanonicalCandidateRevoked(selection)) return;
			} else {
				if (remaining.some((source) => source.tier === canonicalTier && (canonicalTier !== "tier-0" || source.metadata.id === undefined))) return;
				await deps.saveArticle({
					article: { ...article, freshness: { ...article.freshness, canonicalContentHash: undefined } },
					writes: ["freshness"],
					selectionExpected: { snapshot: selection },
				});
				await deleteContentObjects([legacyCanonicalKey]);
			}

			if (reselectable) {
				await publishEvent(ReselectAfterRemovalEvent, { url: detail.url });
				logger.info("[RemoveMyContent] re-selecting canonical from remaining sources", {
					url: detail.url,
					remaining: remaining.map((source) => source.tier),
				});
				return;
			}

			const savers = await countSaversByUrl(detail.url);
			if (savers > 0) {
				/* Nothing is left to select from, but somebody — the remover
				 * included, since a version delete leaves their queue row — still
				 * holds this URL, so re-crawl the public page rather than purging it
				 * out from under them. */
				await publishEvent(RecrawlLinkInitiatedEvent, { url: detail.url, saveAttemptId: newSaveAttemptId() });
				logger.info("[RemoveMyContent] re-crawling for remaining savers", {
					url: detail.url,
					savers,
				});
				return;
			}

			await purgeArticleContent(detail.url);
			await tombstoneArticle({ url: detail.url, at: now() });
			logger.info("[RemoveMyContent] purged and tombstoned", { url: detail.url });
		},
	});
}
