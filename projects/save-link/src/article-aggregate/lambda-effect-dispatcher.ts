import type { DispatchEffect } from "@packages/domain/article-aggregate";
import {
	CrawlArticleFailedEvent,
	type GenerateSummaryCommand,
	RecrawlCompletedEvent,
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
