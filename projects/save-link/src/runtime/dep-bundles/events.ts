import type { SQSClient } from "@aws-sdk/client-sqs";
import {
	type EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
	type DispatchCommand,
	type PublishEvent,
} from "@packages/hutch-infra-components/runtime";
import { GenerateSummaryCommand } from "@packages/hutch-infra-components";

export type DispatchGenerateSummary = DispatchCommand<typeof GenerateSummaryCommand>;

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
