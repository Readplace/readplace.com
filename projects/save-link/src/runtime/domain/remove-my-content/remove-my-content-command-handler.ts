import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	RecrawlLinkInitiatedEvent,
	RemoveMyContentCommand,
	ReselectAfterRemovalEvent,
} from "@packages/hutch-infra-components";
import type {
	CountSaversByUrl,
	DeleteContentObjects,
	PruneCrawlVersions,
	PurgeArticleContent,
	ResolveAuthoredContentKeys,
	TombstoneArticle,
} from "@packages/article-store";
import type { FindContentSourceTier } from "../../providers/article-store/find-content-source-tier";
import type { ListAvailableTierSources } from "../select-content/list-available-tier-sources";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initRemoveMyContentCommandHandler(deps: {
	resolveAuthoredContentKeys: ResolveAuthoredContentKeys;
	deleteContentObjects: DeleteContentObjects;
	pruneCrawlVersions: PruneCrawlVersions;
	findContentSourceTier: FindContentSourceTier;
	listAvailableTierSources: ListAvailableTierSources;
	countSaversByUrl: CountSaversByUrl;
	purgeArticleContent: PurgeArticleContent;
	tombstoneArticle: TombstoneArticle;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		resolveAuthoredContentKeys,
		deleteContentObjects,
		pruneCrawlVersions,
		findContentSourceTier,
		listAvailableTierSources,
		countSaversByUrl,
		purgeArticleContent,
		tombstoneArticle,
		publishEvent,
		now,
		logger,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RemoveMyContentCommand.detailSchema.parse(envelope.detail);

				/* Every step is idempotent against an at-least-once redelivery:
				 * resolving against already-deleted objects yields no keys, deleting
				 * absent keys is a no-op, and the prune converges once the entries
				 * are gone. */
				const authored = await resolveAuthoredContentKeys({
					url: detail.url,
					userId: detail.userId,
					versionMinuteId: detail.versionMinuteId,
				});
				await deleteContentObjects(authored.objectKeys);
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
				const canonicalTier = await findContentSourceTier(detail.url);
				if (canonicalTier === undefined) continue;

				const remaining = await listAvailableTierSources(detail.url);
				if (remaining.some((source) => source.tier === canonicalTier)) continue;

				if (remaining.length > 0) {
					await publishEvent(ReselectAfterRemovalEvent, { url: detail.url });
					logger.info("[RemoveMyContent] re-selecting canonical from remaining sources", {
						url: detail.url,
						remaining: remaining.map((source) => source.tier),
					});
					continue;
				}

				const savers = await countSaversByUrl(detail.url);
				if (savers > 0) {
					/* Nothing is left to select from, but somebody — the remover
					 * included, since a version delete leaves their queue row — still
					 * holds this URL, so re-crawl the public page rather than purging it
					 * out from under them. */
					await publishEvent(RecrawlLinkInitiatedEvent, { url: detail.url });
					logger.info("[RemoveMyContent] re-crawling for remaining savers", {
						url: detail.url,
						savers,
					});
					continue;
				}

				await purgeArticleContent(detail.url);
				await tombstoneArticle({ url: detail.url, at: now() });
				logger.info("[RemoveMyContent] purged and tombstoned", { url: detail.url });
			} catch (error) {
				logger.error("[RemoveMyContent] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
