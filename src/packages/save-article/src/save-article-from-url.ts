import { calculateReadTime, isNonArticleHost, stubMetadataFor, isArchiveHost } from "@packages/domain/article";
import type { ResolvedFreshnessResult } from "@packages/provider-contracts/article-freshness";
import type { MarkCrawlPending } from "@packages/provider-contracts/article-crawl";
import type { MarkSummaryPending } from "@packages/provider-contracts/article-summary";
import type { PinContentSource, SaveArticle, UpdateArticleStatus, WrapperSourceBinding } from "@packages/provider-contracts/article-store";
import type {
	PublishLinkQueued,
	PublishLinkSaved,
	PublishQueueEntryCreated,
} from "@packages/provider-contracts/events";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { UserId } from "@packages/domain/user";
import type { SaveAttemptId, SaveProvenance, SaveableUrl, SavedArticle } from "@packages/domain/article";

export interface SaveArticleFromUrlDependencies {
	saveArticle: SaveArticle;
	updateArticleStatus: UpdateArticleStatus;
	markCrawlPending: MarkCrawlPending;
	markSummaryPending: MarkSummaryPending;
	pinContentSource: PinContentSource;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	publishLinkSaved: PublishLinkSaved;
	publishLinkQueued: PublishLinkQueued;
	publishQueueEntryCreated: PublishQueueEntryCreated;
}

const RESURFACES_EARLIER_SAVES = {
	web: true,
	client: true,
	email: true,
	mcp: true,
	import: false,
	"hn-suggestion": false,
	"founder-seed": false,
} satisfies Record<SaveProvenance["kind"], boolean>;

type SaveOutcome = {
	saved: SavedArticle;
	createdUserArticle: boolean;
	wroteUserArticle: boolean;
	resurfacedFromRead: boolean;
};

async function markUnreadIfRead(
	updateArticleStatus: UpdateArticleStatus,
	result: { saved: SavedArticle; createdUserArticle: boolean; wroteUserArticle: boolean },
): Promise<SaveOutcome> {
	if (result.wroteUserArticle && result.saved.status === "read") {
		await updateArticleStatus(result.saved.id, result.saved.userId, "unread");
		return {
			...result,
			saved: { ...result.saved, status: "unread", readAt: undefined },
			resurfacedFromRead: true,
		};
	}
	return { ...result, resurfacedFromRead: false };
}

export type SaveArticleFromUrl = (params: {
	userId: UserId;
	url: SaveableUrl;
	freshness: ResolvedFreshnessResult;
	provenance: SaveProvenance;
	savedAt: Date;
	saveAttemptId: SaveAttemptId;
}) => Promise<{
	saved: SavedArticle;
	canonicalUrl: string;
	createdUserArticle: boolean;
	wroteUserArticle: boolean;
	resurfacedFromRead: boolean;
}>;

async function saveByFreshness(
	deps: SaveArticleFromUrlDependencies,
	params: {
		userId: UserId;
		url: string;
		source?: WrapperSourceBinding;
		saveAttemptId: SaveAttemptId;
		freshness: ResolvedFreshnessResult;
		provenance: SaveProvenance;
		savedAt: Date;
	},
): Promise<SaveOutcome> {
	const { userId, url, source, saveAttemptId, freshness, provenance, savedAt } = params;

	const written = await deps.saveArticle({
		userId,
		url,
		metadata:
			freshness.action === "new"
				? { ...stubMetadataFor(new URL(url).hostname), wordCount: 0 }
				: { title: "", siteName: "", excerpt: "", wordCount: 0 },
		estimatedReadTime: calculateReadTime(0),
		provenance,
		savedAt,
	});
	if (source !== undefined && isArchiveHost(source.contentSourceUrl)) {
		await deps.pinContentSource({ articleUrl: url, ...source });
	}

	if (freshness.action === "new") {
		if (isNonArticleHost(url)) {
			return markUnreadIfRead(deps.updateArticleStatus, written);
		}
		await deps.markCrawlPending({ url });
		await deps.markSummaryPending({ url });
		const [outcome] = await Promise.all([
			markUnreadIfRead(deps.updateArticleStatus, written),
			deps.publishUpdateFetchTimestamp({
				url,
				contentFetchedAt: new Date().toISOString(),
			}),
			deps.publishLinkSaved({ url, userId, saveAttemptId, captureUrl: source?.contentSourceUrl, sourceOriginalUrl: source?.sourceOriginalUrl }),
		]);
		return outcome;
	}

	if (source === undefined && freshness.action === "refreshed" && freshness.article.article.content) {
		await deps.markSummaryPending({ url });
		await deps.publishLinkSaved({ url, userId, saveAttemptId });
	}

	if (source !== undefined) {
		await deps.publishLinkSaved({ url, userId, captureUrl: source.contentSourceUrl, sourceOriginalUrl: source.sourceOriginalUrl, saveAttemptId });
	}

	return markUnreadIfRead(deps.updateArticleStatus, written);
}

export function initSaveArticleFromUrl(
	deps: SaveArticleFromUrlDependencies,
): SaveArticleFromUrl {
	return async (params) => {
		const { identity } = params.freshness;
		const { url } = identity;
		const source =
			identity.contentSourceUrl === undefined
				? undefined
				: { contentSourceUrl: identity.contentSourceUrl, sourceOriginalUrl: identity.sourceOriginalUrl };
		const result = await saveByFreshness(deps, {
			userId: params.userId,
			url,
			source,
			saveAttemptId: params.saveAttemptId,
			freshness: params.freshness,
			provenance: params.provenance,
			savedAt: params.savedAt,
		});
		// The row is committed, so the save is accepted on every freshness branch —
		// including the skip that publishes no LinkSaved. Carries the submitted URL,
		// not the canonical one a consumer never saw.
		await deps.publishLinkQueued({ url: params.url, userId: params.userId });
		if (result.createdUserArticle && RESURFACES_EARLIER_SAVES[params.provenance.kind]) {
			await deps.publishQueueEntryCreated({ url, userId: params.userId });
		}
		return { ...result, canonicalUrl: url };
	};
}
