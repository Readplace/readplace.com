import { initPublishRefreshEvaluation } from "./oauth-refresh/publish-evaluation";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { initDynamoRefreshOutcomes } from "./oauth-refresh/dynamodb-outcomes";
import { initEvaluateRefreshOutcomes } from "./oauth-refresh/outcomes";
import { initRefreshEvaluationHandler } from "./oauth-refresh/evaluate-handler";
import { initPublishRefreshMetrics } from "./oauth-refresh/publish-metrics";
import { EVALUATE_OAUTH_REFRESH_ENV } from "./evaluate-oauth-refresh.env";

const env = readEnv(EVALUATE_OAUTH_REFRESH_ENV);

const outcomes = initDynamoRefreshOutcomes({ client: createDynamoDocumentClient(), tableName: env.DYNAMODB_OAUTH_OUTCOMES_TABLE });
const publish = initPublishRefreshMetrics(new CloudWatchClient({}));
const logger = Logger.from(consoleLogger);
export const handler = initRefreshEvaluationHandler({ evaluate: initEvaluateRefreshOutcomes({
	readDay: outcomes.readDay,
	publish: initPublishRefreshEvaluation({ publish, logger }),
}) });
