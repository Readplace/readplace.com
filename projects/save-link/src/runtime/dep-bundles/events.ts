import type { SQSClient } from "@aws-sdk/client-sqs";
import {
	type EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
	type DispatchCommand,
	type PublishEvent,
} from "@packages/hutch-infra-components/runtime";
import {
	ComprehensiveCrawlCommand,
	GenerateSummaryCommand,
} from "@packages/hutch-infra-components";

export type DispatchGenerateSummary = DispatchCommand<typeof GenerateSummaryCommand>;

/** Bridges `save-link-work`'s "simple unsupported, defer the comprehensive
 * crawl" branch to EventBridge. Each composition root partial-applies the
 * publisher context — userId for the authenticated save, `recrawl=true` for
 * the admin recrawl path — so `save-link-work` itself does not need to know
 * which downstream event the comprehensive Lambda will emit. */
export type DispatchComprehensiveCrawl = (params: {
	url: string;
	userId?: string;
}) => Promise<void>;

export type EventsDepBundle = {
	publishEvent: PublishEvent;
	dispatchGenerateSummary: DispatchGenerateSummary;
};

export function initEventsDepBundle(deps: {
	eventBridgeClient: EventBridgeClient;
	eventBusName: string;
	sqsClient: SQSClient;
	generateSummaryQueueUrl: string;
}): EventsDepBundle {
	const { publishEvent } = initEventBridgePublisher({
		client: deps.eventBridgeClient,
		eventBusName: deps.eventBusName,
	});
	const { dispatch: dispatchGenerateSummary } = initSqsCommandDispatcher({
		sqsClient: deps.sqsClient,
		queueUrl: deps.generateSummaryQueueUrl,
		command: GenerateSummaryCommand,
	});
	return { publishEvent, dispatchGenerateSummary };
}

/** Build a `dispatchComprehensiveCrawl` that publishes via EventBridge with
 * the caller's downstream-event context baked in. The `recrawl` boolean
 * picks which event the comprehensive Lambda emits on success. */
export function initDispatchComprehensiveCrawl(deps: {
	publishEvent: PublishEvent;
	recrawl?: boolean;
}): DispatchComprehensiveCrawl {
	return async ({ url, userId }) => {
		await deps.publishEvent({
			source: ComprehensiveCrawlCommand.source,
			detailType: ComprehensiveCrawlCommand.detailType,
			detail: JSON.stringify({ url, userId, recrawl: deps.recrawl }),
		});
	};
}
