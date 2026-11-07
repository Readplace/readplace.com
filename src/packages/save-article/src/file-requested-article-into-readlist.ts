import { prepareNewSaveUrl, ReaderArticleHashId, type SaveProvenance, type SavedArticle, validateSaveableUrl } from "@packages/domain/article";
import { floorToSecond } from "@packages/domain/event-envelope";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	AllocateSavedAt,
	FileIntoLiveReadlist,
	FindReadlistFiling,
	ListReadlistFitOverrides,
	ReadlistFitOverride,
	ReadlistFilingLandsAs,
	ResolveCanonicalIdentity,
	UpdateArticleStatusAcrossReadlists,
} from "@packages/provider-contracts/article-store";

export interface FileRequestedArticleIntoReadlistDependencies {
	listReadlistFitOverrides: ListReadlistFitOverrides;
	resolveCanonicalIdentity: ResolveCanonicalIdentity;
	findReadlistFiling: FindReadlistFiling;
	fileIntoLiveReadlist: FileIntoLiveReadlist;
	allocateSavedAt: AllocateSavedAt;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
}

type FilingSource = { kind: "reader" } | { kind: "email"; receivedAtMessageId: string; ordinal: string };

type FilingSkipReason = "reader-dropped" | "readlist-gone" | "removed-after-request";

export type FileRequestedArticleIntoReadlist = (params: {
	userId: UserId;
	readlist: ReadlistSlug;
	article: SavedArticle;
	provenance: SaveProvenance;
	source: FilingSource;
	requestedAt: Date;
}) => Promise<{ kind: "filed" } | { kind: "skipped"; reason: FilingSkipReason } | { kind: "not-in-all" }>;

export function initFileRequestedArticleIntoReadlist(
	deps: FileRequestedArticleIntoReadlistDependencies,
): FileRequestedArticleIntoReadlist {
	const resolvesTo = async ({ overrideUrl, article }: { overrideUrl: string; article: SavedArticle }) => {
		const validation = validateSaveableUrl(overrideUrl);
		if (validation.status !== "SUCCESS") return false;
		const identity = await deps.resolveCanonicalIdentity(prepareNewSaveUrl(validation.url));
		return ReaderArticleHashId.from(identity).value === article.id.value;
	};

	const namesThisLink = async ({
		override,
		source,
		article,
	}: {
		override: ReadlistFitOverride;
		source: FilingSource;
		article: SavedArticle;
	}) => {
		if (
			source.kind === "email" &&
			override.receivedAtMessageId === source.receivedAtMessageId &&
			override.ordinal === source.ordinal
		) {
			return true;
		}
		return resolvesTo({ overrideUrl: override.url, article });
	};

	const readerDroppedSince = async (params: Parameters<FileRequestedArticleIntoReadlist>[0]) => {
		const overrides = await deps.listReadlistFitOverrides({ userId: params.userId, readlist: params.readlist });
		for (const override of overrides) {
			if (override.readerVerdict !== "drop") continue;
			if (floorToSecond(override.createdAt) <= params.requestedAt) continue;
			if (await namesThisLink({ override, source: params.source, article: params.article })) return true;
		}
		return false;
	};

	return async (params) => {
		const { userId, readlist, article, requestedAt } = params;
		if (await readerDroppedSince(params)) return { kind: "skipped", reason: "reader-dropped" };

		const existing = await deps.findReadlistFiling({ userId, readlist, url: article.url });
		if (existing?.readAt !== undefined && floorToSecond(existing.readAt) > requestedAt) return { kind: "filed" };
		if (existing !== undefined && existing.savedAt >= requestedAt) return { kind: "filed" };

		const landsAs: ReadlistFilingLandsAs =
			existing === undefined && article.status === "read" && article.readAt !== undefined && article.readAt >= requestedAt
				? { status: "read", readAt: article.readAt }
				: { status: "unread" };
		const { outcome } = await deps.fileIntoLiveReadlist({
			userId,
			readlist,
			url: article.url,
			savedAt: await deps.allocateSavedAt({ userId }),
			provenance: params.provenance,
			suggestionAttribution: article.suggestionAttribution,
			requestedAt,
			landsAs,
		});
		if (outcome === "not-in-all") return { kind: "not-in-all" };
		if (outcome === "readlist-gone" || outcome === "removed-after-request") return { kind: "skipped", reason: outcome };
		if (outcome === "filed" && existing?.status === "read") {
			await deps.updateArticleStatusAcrossReadlists({ id: article.id, userId, addressed: readlist, status: "unread" });
		}
		return { kind: "filed" };
	};
}
