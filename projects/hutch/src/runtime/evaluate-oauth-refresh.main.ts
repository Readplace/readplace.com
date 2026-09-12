import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initPublishRefreshEvaluation } from "./oauth-refresh/publish-evaluation";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { initDynamoRefreshOutcomes } from "./oauth-refresh/dynamodb-outcomes";
import { initEvaluateRefreshOutcomes, TestGrantWindows } from "./oauth-refresh/outcomes";
import { initRefreshEvaluationHandler } from "./oauth-refresh/evaluate-handler";
import { initPublishRefreshMetrics } from "./oauth-refresh/publish-metrics";

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const outcomes = initDynamoRefreshOutcomes({ client: createDynamoDocumentClient(), tableName: requireEnv("DYNAMODB_OAUTH_OUTCOMES_TABLE") });
const publish = initPublishRefreshMetrics(new CloudWatchClient({}));
const logger = HutchLogger.from(consoleLogger);
export const handler = initRefreshEvaluationHandler({ evaluate: initEvaluateRefreshOutcomes({
	readDay: outcomes.readDay,
	testGrants: TestGrantWindows.parse(JSON.parse(requireEnv("OAUTH_TEST_GRANTS"))),
	publish: initPublishRefreshEvaluation({ publish, publishEvent, logger }),
}) });
