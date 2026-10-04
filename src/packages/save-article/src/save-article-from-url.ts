import { calculateReadTime, isNonArticleHost, stubMetadataFor } from "@packages/domain/article";
import type { ContentFreshnessResult, RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { MarkCrawlPending } from "@packages/provider-contracts/article-crawl";
import type { MarkSummaryPending } from "@packages/provider-contracts/article-summary";
import type { PinContentSource, SaveArticle, UpdateArticleStatus } from "@packages/provider-contracts/article-store";
import type {
	PublishLinkQueued,
	PublishLinkSaved,
	PublishQueueEntryCreated,
} from "@packages/provider-contracts/events";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { UserId } from "@packages/domain/user";
import type { SaveProvenance, SaveableUrl, SavedArticle } from "@packages/domain/article";
import type { ResolveSaveIdentity } from "./resolve-save-identity";

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
	refreshArticleIfStale: RefreshArticleIfStale;
	/** Collapse an adopted terminal URL onto the article it aliases, so the save
	 * attaches to that article instead of minting a duplicate (and never lands on
	 * an inert alias row). */
	resolveSaveIdentity: ResolveSaveIdentity;
}

const RESURFACES_EARLIER_SAVES = {
	web: true,
	client: true,
	email: true,
	mcp: true,
	import: false,
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
	freshness: ContentFreshnessResult;
	provenance: SaveProvenance;
	savedAt: Date;
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
		contentSourceUrl?: string;
		freshness: ContentFreshnessResult;
		provenance: SaveProvenance;
		savedAt: Date;
	},
): Promise<SaveOutcome> {
	const { userId, url, contentSourceUrl, freshness, provenance, savedAt } = params;

	if (freshness.action === "new") {
		const hostname = new URL(url).hostname;
		const written = await deps.saveArticle({
			userId,
			url,
			metadata: {
				...stubMetadataFor(hostname),
				wordCount: 0,
			},
			estimatedReadTime: calculateReadTime(0),
			provenance,
			savedAt,
		});
		if (contentSourceUrl !== undefined) {
			await deps.pinContentSource({ articleUrl: url, contentSourceUrl });
		}
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
			deps.publishLinkSaved({ url, userId }),
		]);
		if (contentSourceUrl !== undefined) {
			await deps.publishLinkSaved({ url, userId, captureUrl: contentSourceUrl });
		}
		return outcome;
	}

	const written = await deps.saveArticle({
		userId,
		url,
		metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
		estimatedReadTime: calculateReadTime(0),
		provenance,
		savedAt,
	});

	if (freshness.action === "refreshed" && freshness.article.article.content) {
		await deps.markSummaryPending({ url });
		await deps.publishLinkSaved({ url, userId });
	}

	if (contentSourceUrl !== undefined) {
		await deps.pinContentSource({ articleUrl: url, contentSourceUrl });
		await deps.publishLinkSaved({ url, userId, captureUrl: contentSourceUrl });
	}

	return markUnreadIfRead(deps.updateArticleStatus, written);
}

export function initSaveArticleFromUrl(
	deps: SaveArticleFromUrlDependencies,
): SaveArticleFromUrl {
	return async (params) => {
		const { url, contentSourceUrl } = params.freshness.identity ?? (await deps.resolveSaveIdentity(params.url));
		const result = await saveByFreshness(deps, {
			userId: params.userId,
			url,
			contentSourceUrl,
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
