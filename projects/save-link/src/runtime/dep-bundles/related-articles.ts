import type { CreateAiMessage } from "@packages/ai-message";
import { isSameArticle } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import { initSelectAgreedPicks } from "../domain/related-articles/agreed-picks";
import { initSelectRelatedArticlesWithinDailyBudget, type RecommendationBudgetDeniedLine } from "../domain/related-articles/daily-budget";
import type { CountPromptTokens } from "../domain/related-articles/deepseek-flash-tokenizer/deepseek-flash-tokenizer";
import { RECOMMENDATION_DAILY_LIMIT_NANODOLLARS, type RecommendationBudget } from "../domain/related-articles/recommendation-budget";
import { NEXT_READ_SHARED_WORDS_FLOOR, PAST_READS_SHARED_WORDS_FLOOR } from "../domain/related-articles/related-articles-limits";
import { initSelectRelatedArticles, type SelectRelatedArticles } from "../domain/related-articles/related-articles-selector";
import { initSelectRelatedArticlesWithoutSharedBoilerplate } from "../domain/related-articles/shared-boilerplate";
import { initSelectRelatedArticlesAboveSharedWordsFloor } from "../domain/related-articles/shared-words-floor";

export type RelatedArticlesDepBundle = {
	selectRelatedArticles: SelectRelatedArticles;
	selectPastReads: SelectRelatedArticles;
};

export function initRelatedArticlesDepBundle(deps: {
	createMessage: CreateAiMessage;
	nowMs: () => number;
	logger: HutchLogger;
	budget: RecommendationBudget;
	countPromptTokens: CountPromptTokens;
	budgetDeniedLog: HutchLogger.Typed<RecommendationBudgetDeniedLine>;
}): RelatedArticlesDepBundle {
	const withinDailyBudget = (input: {
		selection: "nextRead" | "pastReads";
		calls: 1 | 2;
		buildSelector: (createMessage: CreateAiMessage) => SelectRelatedArticles;
	}) => initSelectRelatedArticlesWithinDailyBudget({
		...input,
		createMessage: deps.createMessage,
		budget: deps.budget,
		countPromptTokens: deps.countPromptTokens,
		limitNanodollars: RECOMMENDATION_DAILY_LIMIT_NANODOLLARS,
		logger: deps.logger,
		budgetDeniedLog: deps.budgetDeniedLog,
	});
	const { selectRelatedArticles } = initSelectRelatedArticlesWithoutSharedBoilerplate(
		initSelectRelatedArticlesAboveSharedWordsFloor({
			...withinDailyBudget({
				selection: "nextRead",
				calls: 2,
				buildSelector: (createMessage) => initSelectAgreedPicks(initSelectRelatedArticles({
					createMessage,
					selection: "nextRead",
					nowMs: deps.nowMs,
					logger: deps.logger,
				})).selectRelatedArticles,
			}),
			floor: NEXT_READ_SHARED_WORDS_FLOOR,
			countsTowardFloor: ({ target, candidate }) => !isSameArticle({
				article: { url: target.destinationUrl, title: target.title },
				other: { url: candidate.destinationUrl, title: candidate.title },
			}),
		}),
	);
	const { selectRelatedArticles: selectPastReads } = initSelectRelatedArticlesWithoutSharedBoilerplate(
		initSelectRelatedArticlesAboveSharedWordsFloor({
			...withinDailyBudget({
				selection: "pastReads",
				calls: 1,
				buildSelector: (createMessage) => initSelectRelatedArticles({
					createMessage,
					logger: deps.logger,
					selection: "pastReads",
					nowMs: deps.nowMs,
				}).selectRelatedArticles,
			}),
			floor: PAST_READS_SHARED_WORDS_FLOOR,
			countsTowardFloor: () => true,
		}),
	);
	return { selectRelatedArticles, selectPastReads };
}
