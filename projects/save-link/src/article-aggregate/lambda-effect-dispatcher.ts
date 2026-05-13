import type { DispatchEffect } from "@packages/domain/article-aggregate";
import {
	AnonymousLinkSavedEvent,
	CrawlArticleCompletedEvent,
	CrawlArticleFailedEvent,
	type GenerateSummaryCommand,
	LinkSavedEvent,
	RecrawlCompletedEvent,
	SummaryGeneratedEvent,
	SummaryGenerationFailedEvent,
} from "@packages/hutch-infra-components";
import type {
	DispatchCommand,
	PublishEvent,
} from "@packages/hutch-infra-components/runtime";

export function initLambdaEffectDispatcher(deps: {
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
	publishEvent: PublishEvent;
}): { dispatchEffect: DispatchEffect } {
	const { dispatchGenerateSummary, publishEvent } = deps;

	const dispatchEffect: DispatchEffect = async (effect) => {
		switch (effect.kind) {
			case "generate-summary":
				await dispatchGenerateSummary({ url: effect.url });
				return;
			case "dispatch-generate-summary-retry":
				/* Same SQS queue + same payload as the initial generate-summary
				 * dispatch — the attempt counter rides on the aggregate row, not
				 * the SQS message, so workers don't need a new entry point. */
				await dispatchGenerateSummary({ url: effect.url });
				return;
			case "publish-crawl-article-failed":
				await publishEvent({
					source: CrawlArticleFailedEvent.source,
					detailType: CrawlArticleFailedEvent.detailType,
					detail: JSON.stringify({
						url: effect.url,
						reason: effect.reason,
						receiveCount: effect.receiveCount,
					}),
				});
				return;
			case "publish-recrawl-completed":
				await publishEvent({
					source: RecrawlCompletedEvent.source,
					detailType: RecrawlCompletedEvent.detailType,
					detail: JSON.stringify({ url: effect.url }),
				});
				return;
			case "publish-crawl-article-completed":
				await publishEvent({
					source: CrawlArticleCompletedEvent.source,
					detailType: CrawlArticleCompletedEvent.detailType,
					detail: JSON.stringify({ url: effect.url }),
				});
				return;
			case "publish-link-saved":
				await publishEvent({
					source: LinkSavedEvent.source,
					detailType: LinkSavedEvent.detailType,
					detail: JSON.stringify({ url: effect.url, userId: effect.userId }),
				});
				return;
			case "publish-anonymous-link-saved":
				await publishEvent({
					source: AnonymousLinkSavedEvent.source,
					detailType: AnonymousLinkSavedEvent.detailType,
					detail: JSON.stringify({ url: effect.url }),
				});
				return;
			case "publish-summary-generated":
				await publishEvent({
					source: SummaryGeneratedEvent.source,
					detailType: SummaryGeneratedEvent.detailType,
					detail: JSON.stringify({
						url: effect.url,
						inputTokens: effect.inputTokens,
						outputTokens: effect.outputTokens,
					}),
				});
				return;
			case "publish-summary-generation-failed":
				await publishEvent({
					source: SummaryGenerationFailedEvent.source,
					detailType: SummaryGenerationFailedEvent.detailType,
					detail: JSON.stringify({
						url: effect.url,
						reason: effect.reason,
						receiveCount: effect.receiveCount,
					}),
				});
				return;
			default: {
				const _exhaustive: never = effect;
				throw new Error(
					`Unhandled aggregate effect: ${JSON.stringify(_exhaustive)}`,
				);
			}
		}
	};

	return { dispatchEffect };
}
