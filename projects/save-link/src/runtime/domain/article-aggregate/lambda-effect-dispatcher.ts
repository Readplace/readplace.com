import type { DispatchEffect } from "@packages/domain/article-aggregate";
import {
	AnonymousLinkSavedEvent,
	CanonicalContentChangedEvent,
	CrawlArticleCompletedEvent,
	CrawlArticleFailedEvent,
	type GenerateSummaryCommand,
	LinkSavedEvent,
	ReaderViewLoadingSucceeded,
	RecrawlCompletedEvent,
	SubmitLinkCommand,
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
			case "dispatch-submit-link":
				/* EventBridge route (not direct SQS): the existing EVENT_BUS_NAME
				 * is wired on every Lambda, so no new queue / env var / IAM grant
				 * is required at the publisher. The future subscriber Lambda
				 * lands via eventBus.subscribe(SubmitLinkCommand, …) in infra. */
				await publishEvent(SubmitLinkCommand, {
					url: effect.url,
					...(effect.userId !== undefined ? { userId: effect.userId } : {}),
					...(effect.rawHtml !== undefined ? { rawHtml: effect.rawHtml } : {}),
				});
				return;
			case "publish-crawl-article-failed":
				await publishEvent(CrawlArticleFailedEvent, {
					url: effect.url,
					reason: effect.reason,
					receiveCount: effect.receiveCount,
				});
				return;
			case "publish-recrawl-completed":
				await publishEvent(RecrawlCompletedEvent, { url: effect.url });
				return;
			case "publish-crawl-article-completed":
				await publishEvent(CrawlArticleCompletedEvent, { url: effect.url });
				return;
			case "publish-canonical-content-changed":
				await publishEvent(CanonicalContentChangedEvent, { url: effect.url });
				return;
			case "publish-link-saved":
				await publishEvent(LinkSavedEvent, {
					url: effect.url,
					userId: effect.userId,
				});
				return;
			case "publish-anonymous-link-saved":
				await publishEvent(AnonymousLinkSavedEvent, { url: effect.url });
				return;
			case "publish-summary-generated":
				await publishEvent(SummaryGeneratedEvent, {
					url: effect.url,
					inputTokens: effect.inputTokens,
					outputTokens: effect.outputTokens,
				});
				return;
			case "publish-summary-generation-failed":
				await publishEvent(SummaryGenerationFailedEvent, {
					url: effect.url,
					reason: effect.reason,
					receiveCount: effect.receiveCount,
				});
				return;
			case "publish-reader-view-loading-succeeded":
				await publishEvent(ReaderViewLoadingSucceeded, {
					url: effect.url,
					succeededAt: effect.succeededAt,
					hasSummary: effect.hasSummary,
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
