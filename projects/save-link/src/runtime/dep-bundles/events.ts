import type { SQSClient } from "@aws-sdk/client-sqs";
import {
	type EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
	type DispatchCommand,
	type PublishEvent,
} from "@packages/hutch-infra-components/runtime";
import {
	SimpleCrawlUnsupportedEvent,
	GenerateSummaryCommand,
} from "@packages/hutch-infra-components";

export type DispatchGenerateSummary = DispatchCommand<typeof GenerateSummaryCommand>;

/** Bridges `save-link-work`'s "simple unsupported, defer the comprehensive
 * crawl" branch to EventBridge by emitting `SimpleCrawlUnsupportedEvent`.
 * The policy Lambda subscribes to the event and dispatches
 * `ComprehensiveCrawlCommand` so `save-link-work` itself does not need to
 * know which downstream command the policy issues. */
export type EmitSimpleCrawlUnsupported = (params: {
	url: string;
	userId?: string;
	recrawl?: boolean;
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

/** Build an `emitSimpleCrawlUnsupported` that publishes
 * `SimpleCrawlUnsupportedEvent` via EventBridge. The policy Lambda
 * subscribes and dispatches `ComprehensiveCrawlCommand`. */
export function initEmitSimpleCrawlUnsupported(deps: {
	publishEvent: PublishEvent;
}): EmitSimpleCrawlUnsupported {
	return async ({ url, userId, recrawl }) => {
		await deps.publishEvent({
			source: SimpleCrawlUnsupportedEvent.source,
			detailType: SimpleCrawlUnsupportedEvent.detailType,
			detail: JSON.stringify({ url, userId, recrawl }),
		});
	};
}
