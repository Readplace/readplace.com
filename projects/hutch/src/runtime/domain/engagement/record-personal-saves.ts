import { ReaderArticleHashId } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type { CountEarlyIntentionalSave, MarkActivationThresholdReached } from "@packages/provider-contracts/auth";
import type {
	AssignSavedArticleToReadlist,
	FindArticleById,
	FindReadlistArticleById,
	SaveArticle,
	SaveArticleParams,
	SaveReadlistArticle,
} from "@packages/provider-contracts/article-store";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import {
	type ActivationThresholdReachedEvent,
	buildActivationThresholdReachedEvent,
} from "./funnel-events";
import { isIntentionalSave } from "./intentional-save";
import type { LogError } from "@packages/logger";

export function initRecordPersonalSaves(deps: {
	saveArticle: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
	saveReadlistArticle: SaveReadlistArticle;
	assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
	findArticleById: FindArticleById;
	findReadlistArticleById: FindReadlistArticleById;
	recordEngagementActivity: RecordEngagementActivity;
	now: () => Date;
	logError: LogError;
	countEarlyIntentionalSave: CountEarlyIntentionalSave;
	recordActivationThresholdReached: (event: ActivationThresholdReachedEvent) => void;
	markActivationThresholdReached: MarkActivationThresholdReached;
}): {
	saveArticle: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
	saveReadlistArticle: SaveReadlistArticle;
	assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
} {
	const record = async (
		params: Omit<SaveArticleParams, "saveTrigger">,
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
	const countIntentionalSave = async (
		params: Parameters<SaveArticle>[0],
		result: Awaited<ReturnType<SaveArticle>>,
	) => {
		if (!result.createdUserArticle || !isIntentionalSave(params)) return;
		try {
			const counted = await deps.countEarlyIntentionalSave({ userId: params.userId, at: deps.now() });
			if (counted.inWindow && counted.count === 2) {
				deps.recordActivationThresholdReached(
					buildActivationThresholdReachedEvent(
						{ now: deps.now },
						{
							userId: params.userId,
							registeredAt: counted.registeredAt,
							signupOAuthClientId: counted.signupOAuthClientId,
						},
					),
				);
				await deps.markActivationThresholdReached({ userId: params.userId, at: deps.now() });
			}
		} catch (error) {
			deps.logError("Failed to count early intentional save", error instanceof Error ? error : undefined);
		}
	};
	return {
		saveArticleKeepingPosition: async (params) => {
			const result = await record(params, await deps.saveArticleKeepingPosition(params));
			await countIntentionalSave(params, result);
			return result;
		},
		saveArticle: async (params) => {
			const result = await record(params, await deps.saveArticle(params));
			await countIntentionalSave(params, result);
			return result;
		},
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
