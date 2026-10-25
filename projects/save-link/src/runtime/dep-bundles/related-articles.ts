import type { CreateAiMessage } from "@packages/ai-message";
import { isSameArticle } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import { initSelectAgreedPicks } from "../domain/related-articles/agreed-picks";
import { NEXT_READ_SHARED_WORDS_FLOOR, PAST_READS_SHARED_WORDS_FLOOR } from "../domain/related-articles/related-articles-limits";
import { initSelectRelatedArticles, type SelectRelatedArticles } from "../domain/related-articles/related-articles-selector";
import { PAST_READS_PROMPT } from "../domain/related-articles/related-past-reads-prompt";
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
}): RelatedArticlesDepBundle {
	const { selectRelatedArticles } = initSelectRelatedArticlesWithoutSharedBoilerplate(
		initSelectRelatedArticlesAboveSharedWordsFloor({
			...initSelectAgreedPicks(initSelectRelatedArticles({
				createMessage: deps.createMessage,
				nowMs: deps.nowMs,
				logger: deps.logger,
			})),
			floor: NEXT_READ_SHARED_WORDS_FLOOR,
			countsTowardFloor: ({ target, candidate }) => !isSameArticle({
				article: { url: target.destinationUrl, title: target.title },
				other: { url: candidate.destinationUrl, title: candidate.title },
			}),
		}),
	);
	const { selectRelatedArticles: selectPastReads } = initSelectRelatedArticlesWithoutSharedBoilerplate(
		initSelectRelatedArticlesAboveSharedWordsFloor({
			...initSelectRelatedArticles({
				createMessage: deps.createMessage,
				logger: deps.logger,
				system: PAST_READS_PROMPT,
				nowMs: deps.nowMs,
			}),
			floor: PAST_READS_SHARED_WORDS_FLOOR,
			countsTowardFloor: () => true,
		}),
	);
	return { selectRelatedArticles, selectPastReads };
}
