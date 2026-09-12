/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient, defineDynamoTable } from "@packages/hutch-storage-client";
import { initDynamoRefreshOutcomes } from "./oauth-refresh/dynamodb-outcomes";
import { initAttributeRefreshRefusal } from "./oauth-refresh/attribute-refusal";
import { CredentialHistory } from "./oauth-refresh/evidence";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { initCloudWatchLogsAnalyticsForward } from "./providers/analytics-forward/cloudwatch-logs-analytics-forward";
import { initForwardAnalyticsHandler } from "./forward-analytics/forward-analytics-handler";
import { FORWARDED_STREAMS } from "./observability/events";

const analyticsLogGroupName = requireEnv("ANALYTICS_LOG_GROUP_NAME");
const errorsLogGroupName = requireEnv("ERRORS_LOG_GROUP_NAME");

const client = new CloudWatchLogsClient({});

const { createLogStream, putLogEvents } = initCloudWatchLogsAnalyticsForward({ client });
const dynamoClient = createDynamoDocumentClient();
const credentialHistory = defineDynamoTable({ client: dynamoClient, tableName: requireEnv("DYNAMODB_OAUTH_TABLE"), schema: CredentialHistory });

export const handler = initForwardAnalyticsHandler({
	recordRefreshRefusal: initAttributeRefreshRefusal({
		findHistory: fingerprint => credentialHistory.get({ pk: `credential#${fingerprint}` }, { consistentRead: true }),
		record: initDynamoRefreshOutcomes({ client: dynamoClient, tableName: requireEnv("DYNAMODB_OAUTH_OUTCOMES_TABLE") }).refuse,
	}),
	createLogStream,
	putLogEvents,
	analyticsLogGroupName,
	errorsLogGroupName,
	analyticsStreams: FORWARDED_STREAMS,
	logger: HutchLogger.from(consoleLogger),
});
/* c8 ignore stop */
