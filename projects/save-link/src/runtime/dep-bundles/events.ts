import type { SQSClient } from "@aws-sdk/client-sqs";
import {
	type EventBridgeClient,
	initEventBridgePublisher,
	initSqsCommandDispatcher,
	type DispatchCommand,
	type PublishEvent,
} from "@packages/hutch-infra-components/runtime";
import {
	GenerateSummaryCommand,
	SubmitLinkCommand,
} from "@packages/hutch-infra-components";

export type DispatchGenerateSummary = DispatchCommand<typeof GenerateSummaryCommand>;
export type DispatchSubmitLink = DispatchCommand<typeof SubmitLinkCommand>;

export type EventsDepBundle = {
	publishEvent: PublishEvent;
	dispatchGenerateSummary: DispatchGenerateSummary;
	dispatchSubmitLink: DispatchSubmitLink;
};

export function initEventsDepBundle(deps: {
	eventBridgeClient: EventBridgeClient;
	eventBusName: string;
	sqsClient: SQSClient;
	generateSummaryQueueUrl: string;
	submitLinkQueueUrl: string;
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
	const { dispatch: dispatchSubmitLink } = initSqsCommandDispatcher({
		sqsClient: deps.sqsClient,
		queueUrl: deps.submitLinkQueueUrl,
		command: SubmitLinkCommand,
	});
	return {
		publishEvent,
		dispatchGenerateSummary,
		dispatchSubmitLink,
	};
}

