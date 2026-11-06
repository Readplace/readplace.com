/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient, defineDynamoTable } from "@packages/storage-client";
import { initDynamoRefreshOutcomes } from "./oauth-refresh/dynamodb-outcomes";
import { initAttributeRefreshRefusal } from "./oauth-refresh/attribute-refusal";
import { CredentialHistory } from "./oauth-refresh/evidence";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { initCloudWatchLogsAnalyticsForward } from "./providers/analytics-forward/cloudwatch-logs-analytics-forward";
import { initForwardAnalyticsHandler } from "./forward-analytics/forward-analytics-handler";
import { FORWARDED_STREAMS } from "./observability/events";
import { FORWARD_ANALYTICS_ENV } from "./forward-analytics.env";

const env = readEnv(FORWARD_ANALYTICS_ENV);

const analyticsLogGroupName = env.ANALYTICS_LOG_GROUP_NAME;
const errorsLogGroupName = env.ERRORS_LOG_GROUP_NAME;

const client = new CloudWatchLogsClient({});

const { createLogStream, putLogEvents } = initCloudWatchLogsAnalyticsForward({ client });
const dynamoClient = createDynamoDocumentClient();
const credentialHistory = defineDynamoTable({ client: dynamoClient, tableName: env.DYNAMODB_OAUTH_TABLE, schema: CredentialHistory });

export const handler = initForwardAnalyticsHandler({
	recordRefreshRefusal: initAttributeRefreshRefusal({
		findHistory: fingerprint => credentialHistory.get({ pk: `credential#${fingerprint}` }, { consistentRead: true }),
		record: initDynamoRefreshOutcomes({ client: dynamoClient, tableName: env.DYNAMODB_OAUTH_OUTCOMES_TABLE }).refuse,
	}),
	createLogStream,
	putLogEvents,
	analyticsLogGroupName,
	errorsLogGroupName,
	authDiagnosticsLogGroupName: env.AUTH_DIAGNOSTICS_LOG_GROUP_NAME,
	analyticsStreams: FORWARDED_STREAMS,
	logger: Logger.from(consoleLogger),
});
/* c8 ignore stop */
