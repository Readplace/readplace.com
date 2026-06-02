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

/** Bridges the simple-only Lambdas' "simple unsupported, defer the
 * comprehensive crawl" branch to EventBridge by emitting
 * `SimpleCrawlUnsupportedEvent`. The policy Lambda subscribes to the event
 * and dispatches `ComprehensiveCrawlCommand` so the publisher Lambda itself
 * does not need to know which downstream command the policy issues.
 *
 * `recrawl=true` and `refresh=true` are mutually exclusive: `recrawl` is the
 * admin-recrawl chain (RecrawlContentExtractedEvent downstream), `refresh`
 * is the stale-check chain (RefreshContentExtractedEvent downstream). The
 * default (neither set) is the save chain (TierContentExtractedEvent). */
export type EmitSimpleCrawlUnsupported = (params: {
	url: string;
	userId?: string;
	recrawl?: boolean;
	refresh?: boolean;
	previousBodyHash?: string;
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
	return ({ url, userId, recrawl, refresh, previousBodyHash }) =>
		deps.publishEvent(SimpleCrawlUnsupportedEvent, {
			url,
			userId,
			recrawl,
			refresh,
			previousBodyHash,
		});
}
