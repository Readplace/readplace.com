import type { ArticleMetadata, Minutes, SaveProvenance } from "@packages/domain/article";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { SetArticleDisplayUrl } from "@packages/article-store";
import type { FindArticleCrawlStatus, MarkCrawlPending } from "@packages/provider-contracts/article-crawl";
import type { MarkSummaryPending } from "@packages/provider-contracts/article-summary";
import type {
	AllocateSavedAt,
	FileIntoLiveReadlist,
	FileIntoLiveReadlistOutcome,
	ReadlistFilingLandsAs,
	SaveArticle,
} from "@packages/provider-contracts/article-store";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";
import type { FindEmailIssueStanding } from "./email-issue-standing";

export type EmailIssueFiling = { readlist: ReadlistSlug; outcome: "already-filed" | FileIntoLiveReadlistOutcome };

export type SaveEmailIssueOutcome =
	| { kind: "saved"; contentPending: boolean; filings: EmailIssueFiling[] }
	| { kind: "removed-by-reader"; contentPending: boolean }
	| { kind: "write-access-lapsed" };

export type SaveEmailIssue = (params: {
	userId: UserId;
	url: string;
	displayUrl: string;
	metadata: ArticleMetadata;
	estimatedReadTime: Minutes;
	provenance: SaveProvenance;
	readlists: readonly ReadlistSlug[];
	requestedAt: Date;
	onSavedToAll: () => Promise<void>;
}) => Promise<SaveEmailIssueOutcome>;

export function initSaveEmailIssue(deps: {
	allocateSavedAt: AllocateSavedAt;
	saveArticleKeepingPosition: SaveArticle;
	setDisplayUrl: SetArticleDisplayUrl;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	markSummaryPending: MarkSummaryPending;
	fileIntoLiveReadlist: FileIntoLiveReadlist;
	findEmailIssueStanding: FindEmailIssueStanding;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}): SaveEmailIssue {
	return async ({
		userId,
		url,
		displayUrl,
		metadata,
		estimatedReadTime,
		provenance,
		readlists,
		requestedAt,
		onSavedToAll,
	}) => {
		const standing = await deps.findEmailIssueStanding({ userId, url });
		if (
			!standing.savedToAll &&
			!standing.removedByReader &&
			resolveWriteAccess(await deps.findSubscriptionByUserId(userId), deps.now()) === "read-only"
		) {
			return { kind: "write-access-lapsed" };
		}
		const contentPending = (await deps.findArticleCrawlStatus(url))?.status !== "ready";
		const markContentPending = async () => {
			if (!contentPending) return;
			await deps.markCrawlPending({ url, measured: false, meteredLegs: "run" });
			await deps.markSummaryPending({ url });
		};
		if (standing.removedByReader) {
			await markContentPending();
			await onSavedToAll();
			return { kind: "removed-by-reader", contentPending };
		}
		const { saved } = await deps.saveArticleKeepingPosition({
			userId,
			url,
			metadata,
			estimatedReadTime,
			provenance,
			savedAt: await deps.allocateSavedAt({ userId }),
			saveTrigger: "automatic",
		});
		await deps.setDisplayUrl({ articleUrl: url, displayUrl });
		await markContentPending();
		await onSavedToAll();
		const landsAs: ReadlistFilingLandsAs =
			saved.status === "read" && saved.readAt !== undefined && saved.readAt >= requestedAt
				? { status: "read", readAt: saved.readAt }
				: { status: "unread" };
		const filings: EmailIssueFiling[] = [];
		for (const readlist of readlists) {
			if (standing.filedInto.includes(readlist)) {
				filings.push({ readlist, outcome: "already-filed" });
				continue;
			}
			const { outcome } = await deps.fileIntoLiveReadlist({
				userId,
				readlist,
				url: saved.url,
				savedAt: await deps.allocateSavedAt({ userId }),
				provenance,
				suggestionAttribution: saved.suggestionAttribution,
				requestedAt,
				landsAs,
			});
			filings.push({ readlist, outcome });
		}
		return { kind: "saved", contentPending, filings };
	};
}
