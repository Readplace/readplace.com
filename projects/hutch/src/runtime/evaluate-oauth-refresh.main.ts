import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { initPublishRefreshEvaluation } from "./oauth-refresh/publish-evaluation";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { initDynamoRefreshOutcomes } from "./oauth-refresh/dynamodb-outcomes";
import { initEvaluateRefreshOutcomes, TestGrantWindows } from "./oauth-refresh/outcomes";
import { initRefreshEvaluationHandler } from "./oauth-refresh/evaluate-handler";
import { initPublishRefreshMetrics } from "./oauth-refresh/publish-metrics";
import { EVALUATE_OAUTH_REFRESH_ENV } from "./evaluate-oauth-refresh.env";

const env = readEnv(EVALUATE_OAUTH_REFRESH_ENV);

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });
const outcomes = initDynamoRefreshOutcomes({ client: createDynamoDocumentClient(), tableName: env.DYNAMODB_OAUTH_OUTCOMES_TABLE });
const publish = initPublishRefreshMetrics(new CloudWatchClient({}));
const logger = Logger.from(consoleLogger);
export const handler = initRefreshEvaluationHandler({ evaluate: initEvaluateRefreshOutcomes({
	readDay: outcomes.readDay,
	testGrants: TestGrantWindows.parse(JSON.parse(env.OAUTH_TEST_GRANTS)),
	publish: initPublishRefreshEvaluation({ publish, publishEvent, logger }),
}) });
