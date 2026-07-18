import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	RecrawlLinkInitiatedEvent,
	RemoveMyContentCommand,
	ReselectAfterRemovalEvent,
} from "@packages/hutch-infra-components";
import type {
	CountOtherSaversByUrl,
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
	deleteContentObjects: DeleteContentObjects;
	pruneCrawlVersions: PruneCrawlVersions;
	listAvailableTierSources: ListAvailableTierSources;
	countOtherSaversByUrl: CountOtherSaversByUrl;
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
		listAvailableTierSources,
		countOtherSaversByUrl,
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
					scope: detail.versionMinuteId === undefined ? "copy" : "version",
				});

				/* Single-snapshot scope stops here: the canonical copy was never
				 * touched, so there is nothing to re-select. */
				if (detail.versionMinuteId !== undefined) continue;

				const remaining = await listAvailableTierSources(detail.url);
				if (remaining.length > 0) {
					await publishEvent(ReselectAfterRemovalEvent, { url: detail.url });
					logger.info("[RemoveMyContent] re-selecting canonical from remaining sources", {
						url: detail.url,
						remaining: remaining.map((source) => source.tier),
					});
					continue;
				}

				const otherSavers = await countOtherSaversByUrl({
					url: detail.url,
					excludeUserId: detail.userId,
				});
				if (otherSavers > 0) {
					/* The single tier-0 slot held the remover's capture and there is no
					 * tier-1: co-savers would be left contentless, so re-crawl the
					 * public URL for them instead of purging. */
					await publishEvent(RecrawlLinkInitiatedEvent, { url: detail.url });
					logger.info("[RemoveMyContent] re-crawling for remaining savers", {
						url: detail.url,
						otherSavers,
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
