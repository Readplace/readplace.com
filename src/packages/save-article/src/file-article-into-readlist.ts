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
}) => Promise<{ createdUserArticle: boolean; wroteUserArticle: boolean }>;

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
			savedAt: await deps.allocateSavedAt({ userId }),
		});
		if (filed.wroteUserArticle && filed.saved.status === "read") {
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
		};
	};
}
