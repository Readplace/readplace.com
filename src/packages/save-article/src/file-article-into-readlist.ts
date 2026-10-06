import type { SaveProvenance, SavedArticle } from "@packages/domain/article";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	AllocateSavedAt,
	SaveReadlistArticle,
	UpdateArticleStatusAcrossReadlists,
} from "@packages/provider-contracts/article-store";

export interface FileArticleIntoReadlistDependencies {
	allocateSavedAt: AllocateSavedAt;
	saveReadlistArticle: SaveReadlistArticle;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
}

export type FileArticleIntoReadlist = (params: {
	userId: UserId;
	readlist: ReadlistSlug;
	article: SavedArticle;
	provenance: SaveProvenance;
}) => Promise<{ createdUserArticle: boolean; wroteUserArticle: boolean; resurfacedFromRead: boolean }>;

export function initFileArticleIntoReadlist(
	deps: FileArticleIntoReadlistDependencies,
): FileArticleIntoReadlist {
	return async ({ userId, readlist, article, provenance }) => {
		const filed = await deps.saveReadlistArticle({
			userId,
			readlist,
			url: article.url,
			metadata: article.metadata,
			estimatedReadTime: article.estimatedReadTime,
			provenance,
			suggestionAttribution: article.suggestionAttribution,
			savedAt: await deps.allocateSavedAt({ userId }),
		});
		const resurfacedFromRead = filed.wroteUserArticle && filed.saved.status === "read";
		if (resurfacedFromRead) {
			await deps.updateArticleStatusAcrossReadlists({
				id: article.id,
				userId,
				addressed: readlist,
				status: "unread",
			});
		}
		return {
			createdUserArticle: filed.createdUserArticle,
			wroteUserArticle: filed.wroteUserArticle,
			resurfacedFromRead,
		};
	};
}
