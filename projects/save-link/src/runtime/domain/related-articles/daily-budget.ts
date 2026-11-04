import assert from "node:assert";
import {
	type CreateAiMessage,
	DEEPSEEK_FEATURES,
	DEEPSEEK_MODEL,
	DEEPSEEK_PRICE_TABLE,
	DEEPSEEK_PROMPT_TOKEN_MARGIN,
	deepseekCostNanodollars,
	deepseekPeakNanodollarsPerToken,
	encodeDeepseekChatPrompt,
	toDeepseekMessages,
} from "@packages/ai-message";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	type CountPromptTokens,
	DEEPSEEK_FLASH_TOKENIZER,
} from "./deepseek-flash-tokenizer/deepseek-flash-tokenizer";
import type { RecommendationBudget } from "./recommendation-budget";
import { RELATED_MAX_OUTPUT_TOKENS } from "./related-articles-limits";
import {
	buildRelatedArticlesRequest,
	type RecommendationTrigger,
	type RelatedSelection,
	type SelectRelatedArticles,
} from "./related-articles-selector";

export interface RecommendationBudgetDeniedLine {
	event: "recommendation_budget_denied";
	userId: string;
	feature: "next_read" | "past_reads";
	trigger: RecommendationTrigger;
	articleId: string;
	messageId: string;
	receiveCount: number;
	windowStartsAt: string;
	resetsAt: string;
	limitNanodollars: number;
	consumedNanodollars: number;
	requestedNanodollars: number;
	calls: number;
	candidateCount: number;
	promptTokenBound: number;
	model: string;
	priceTable: string;
	tokenizerRevision: string;
}

export function initSelectRelatedArticlesWithinDailyBudget(deps: {
	selection: RelatedSelection;
	calls: 1 | 2;
	createMessage: CreateAiMessage;
	buildSelector: (createMessage: CreateAiMessage) => SelectRelatedArticles;
	budget: RecommendationBudget;
	countPromptTokens: CountPromptTokens;
	limitNanodollars: number;
	logger: HutchLogger;
	budgetDeniedLog: HutchLogger.Typed<RecommendationBudgetDeniedLine>;
}): { selectRelatedArticles: SelectRelatedArticles } {
	const feature = DEEPSEEK_FEATURES[deps.selection];
	const price = deepseekPeakNanodollarsPerToken(DEEPSEEK_MODEL);

	const selectRelatedArticles: SelectRelatedArticles = async (params) => {
		const { attempt } = params;
		const request = buildRelatedArticlesRequest({ selection: deps.selection, params });
		const prompt = encodeDeepseekChatPrompt({
			system: request.system,
			messages: toDeepseekMessages(request),
			responseFormat: { type: "json_object" },
		});
		const promptTokenBound =
			(await deps.countPromptTokens(prompt)) + DEEPSEEK_PROMPT_TOKEN_MARGIN;
		const perCallNanodollars =
			promptTokenBound * price.cacheMissInput + RELATED_MAX_OUTPUT_TOKENS * price.output;
		const requested = Array.from({ length: deps.calls }, (_unused, index) => ({
			id: `${attempt.messageId}:${attempt.receiveCount}:${attempt.userId}:${feature}:${index + 1}`,
			nanodollars: perCallNanodollars,
		}));

		const decision = await deps.budget.reserveRecommendationBudget({
			userId: attempt.userId,
			reservations: requested,
		});
		if (!decision.allowed) {
			deps.budgetDeniedLog.warn({
				event: "recommendation_budget_denied",
				userId: attempt.userId,
				feature,
				trigger: attempt.trigger,
				articleId: ReaderArticleHashId.from(params.target.destinationUrl).value,
				messageId: attempt.messageId,
				receiveCount: attempt.receiveCount,
				windowStartsAt: decision.window.startsAt.toISOString(),
				resetsAt: decision.window.resetsAt.toISOString(),
				limitNanodollars: deps.limitNanodollars,
				consumedNanodollars: decision.consumedNanodollars,
				requestedNanodollars: perCallNanodollars * deps.calls,
				calls: deps.calls,
				candidateCount: params.unreadCandidates.length + params.readCandidates.length,
				promptTokenBound,
				model: DEEPSEEK_MODEL,
				priceTable: DEEPSEEK_PRICE_TABLE.effectiveDate,
				tokenizerRevision: DEEPSEEK_FLASH_TOKENIZER.revision,
			});
			return { kind: "budget-limited", resetsAt: decision.window.resetsAt };
		}

		const pending = [...decision.reservations];
		const metered: CreateAiMessage = async (message) => {
			const reservation = pending.shift();
			assert(reservation, "every provider call was reserved up front");
			const response = await deps.createMessage(message);
			const { usage } = response;
			const cacheHitInputTokens = usage.cache_hit_input_tokens ?? 0;
			const cacheMissInputTokens =
				usage.cache_miss_input_tokens ?? usage.input_tokens - cacheHitInputTokens;
			const actualNanodollars = deepseekCostNanodollars({
				model: DEEPSEEK_MODEL,
				cacheHitInputTokens,
				cacheMissInputTokens,
				outputTokens: usage.output_tokens,
			});
			await deps.budget.settleRecommendationBudget({ reservation, actualNanodollars });
			deps.logger.info("[related-articles] budget settled", {
				reservationId: reservation.id,
				promptTokenBound,
				inputTokens: usage.input_tokens,
				cacheHitInputTokens,
				cacheMissInputTokens,
				outputTokens: usage.output_tokens,
				reservedNanodollars: reservation.nanodollars,
				actualNanodollars,
			});
			if (usage.input_tokens > promptTokenBound) {
				deps.logger.warn("[related-articles] prompt token bound exceeded", {
					reservationId: reservation.id,
					promptTokenBound,
					inputTokens: usage.input_tokens,
				});
			}
			return response;
		};

		try {
			return await deps.buildSelector(metered)(params);
		} finally {
			for (const reservation of pending) {
				await deps.budget.releaseRecommendationBudget({ reservation });
			}
		}
	};

	return { selectRelatedArticles };
}
