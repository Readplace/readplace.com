import type { UserId } from "@packages/article-state-types";
import type { SaveAttemptId } from "@packages/domain/article";
import type { SQSClient } from "@aws-sdk/client-sqs";
import {
	type EventBridgeClient,
	initEventBridgePublisher,
	type PublishEvent,
} from "@packages/infra-components/runtime";
import {
	SimpleCrawlUnsupportedEvent,
	type SimpleCrawlUnsupportedDetail,
} from "@packages/infra-components";
import type { CandidateReference } from "../domain/select-content/list-available-tier-sources";
import { type DispatchGenerateSummary, initGenerateSummaryDispatch } from "./generate-summary-dispatch";

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
export type DeferredUnsupportedKind = SimpleCrawlUnsupportedDetail["unsupportedReason"];

export type EmitSimpleCrawlUnsupported = (params: {
	url: string;
	unsupportedReason: DeferredUnsupportedKind;
	userId?: UserId;
	recrawl?: boolean;
	refresh?: boolean;
	previousBodyHash?: string;
	saveAttemptId: SaveAttemptId;
	candidates?: CandidateReference[];
	finalUrl?: string;
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
	const dispatchGenerateSummary = initGenerateSummaryDispatch({
		sqsClient: deps.sqsClient,
		generateSummaryQueueUrl: deps.generateSummaryQueueUrl,
	});
	return { publishEvent, dispatchGenerateSummary };
}

/** Build an `emitSimpleCrawlUnsupported` that publishes
 * `SimpleCrawlUnsupportedEvent` via EventBridge. The policy Lambda
 * subscribes and dispatches `ComprehensiveCrawlCommand`. */
export function initEmitSimpleCrawlUnsupported(deps: {
	publishEvent: PublishEvent;
}): EmitSimpleCrawlUnsupported {
	return ({ url, unsupportedReason, userId, recrawl, refresh, previousBodyHash, saveAttemptId, candidates, finalUrl }) =>
		deps.publishEvent(SimpleCrawlUnsupportedEvent, {
			url,
			unsupportedReason,
			userId,
			recrawl,
			refresh,
			previousBodyHash,
			saveAttemptId,
			candidates,
			finalUrl,
		});
}
