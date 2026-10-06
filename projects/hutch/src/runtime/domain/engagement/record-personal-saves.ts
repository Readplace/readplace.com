import { ReaderArticleHashId } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type {
	AssignSavedArticleToReadlist,
	FindArticleById,
	FindReadlistArticleById,
	SaveArticle,
	SaveReadlistArticle,
} from "@packages/provider-contracts/article-store";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";

export function initRecordPersonalSaves(deps: {
	saveArticle: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
	saveReadlistArticle: SaveReadlistArticle;
	assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
	findArticleById: FindArticleById;
	findReadlistArticleById: FindReadlistArticleById;
	recordEngagementActivity: RecordEngagementActivity;
	now: () => Date;
}): {
	saveArticle: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
	saveReadlistArticle: SaveReadlistArticle;
	assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
} {
	const record = async (
		params: Parameters<SaveArticle>[0],
		result: Awaited<ReturnType<SaveArticle>>,
	) => {
		if (
			params.provenance.kind !== "email" &&
			params.provenance.kind !== "hn-suggestion" &&
			params.provenance.kind !== "founder-seed"
		) {
			await deps.recordEngagementActivity({
				userId: params.userId,
				kind: "personal-save",
				at: deps.now(),
				articleId: result.saved.id,
				campaignId: result.saved.suggestionAttribution?.campaignId,
			});
		}
		return result;
	};
	return {
		saveArticleKeepingPosition: async (params) =>
			record(params, await deps.saveArticleKeepingPosition(params)),
		saveArticle: async (params) => record(params, await deps.saveArticle(params)),
		saveReadlistArticle: async (params) => record(params, await deps.saveReadlistArticle(params)),
		assignSavedArticleToReadlist: async (params) => {
			const id = ReaderArticleHashId.from(params.url);
			const source =
				params.from === DEFAULT_READLIST_SLUG
					? await deps.findArticleById(id, params.userId)
					: await deps.findReadlistArticleById({
							userId: params.userId,
							id,
							readlist: params.from,
						});
			const result = await deps.assignSavedArticleToReadlist(params);
			if (source !== null) {
				await deps.recordEngagementActivity({
					userId: params.userId,
					kind: "personal-save",
					at: deps.now(),
					articleId: source.id,
					campaignId: source.suggestionAttribution?.campaignId,
				});
			}
			return result;
		},
	};
}
