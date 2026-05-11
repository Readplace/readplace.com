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

/**
 * Wires the typed Effect union to the existing SQS command dispatchers and
 * EventBridge publisher. The orchestrator iterates effects after a successful
 * store.save(), so a thrown failure propagates back to the Lambda handler
 * and SQS retries the whole transition.
 *
 * The switch is exhaustive via a `never` default — adding a new Effect
 * variant without a case here is a compile error.
 */
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
