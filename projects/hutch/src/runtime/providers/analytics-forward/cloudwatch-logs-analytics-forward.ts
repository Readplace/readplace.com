/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	CreateLogStreamCommand,
	PutLogEventsCommand,
	type CloudWatchLogsClient,
} from "@aws-sdk/client-cloudwatch-logs";
import type {
	CreateLogStream,
	PutLogEvents,
} from "../../forward-analytics/forward-analytics-handler";

/**
 * CloudWatch Logs writes for the analytics forwarder. Deliberately logicless —
 * the `ResourceAlreadyExistsException` tolerance and the batch chunking live in
 * the handler, where they are unit-tested, so this wrapper only translates the
 * handler's calls into SDK commands.
 */
export function initCloudWatchLogsAnalyticsForward(deps: {
	client: CloudWatchLogsClient;
}): { createLogStream: CreateLogStream; putLogEvents: PutLogEvents } {
	const { client } = deps;

	const createLogStream: CreateLogStream = async ({ logGroupName, logStreamName }) => {
		await client.send(new CreateLogStreamCommand({ logGroupName, logStreamName }));
	};

	const putLogEvents: PutLogEvents = async ({ logGroupName, logStreamName, logEvents }) => {
		const response = await client.send(
			new PutLogEventsCommand({
				logGroupName,
				logStreamName,
				logEvents: logEvents.map((event) => ({
					timestamp: event.timestamp,
					message: event.message,
				})),
			}),
		);
		// Returned rather than dropped: a 200 can still discard individual events, and
		// only the handler logs that loss.
		return response.rejectedLogEventsInfo;
	};

	return { createLogStream, putLogEvents };
}
/* c8 ignore stop */
