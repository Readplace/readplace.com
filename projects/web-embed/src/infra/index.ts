import * as pulumi from "@pulumi/pulumi";
import {
	HutchAPIGatewayLambdaRoute,
	HutchDynamoDBAccess,
	HutchLambda,
} from "@packages/hutch-infra-components/infra";

/**
 * web-embed is deployed as its own Lambda behind hutch's existing API Gateway:
 * more-specific routes (GET /embed, ANY /embed/{proxy+}) take precedence over
 * hutch's $default, so readplace.com/embed is served here while everything else
 * falls through to hutch. The coupling is deploy-time and one-way — this stack
 * reads hutch's API id / exec-arn / appOrigin via a StackReference and attaches
 * its own integration + routes + invoke permission. There is no runtime edge,
 * so embed code changes never invalidate hutch's check or e2e cache.
 */
const config = new pulumi.Config();
const nodeEnv = config.require("nodeEnv");
const hutchStackName = config.require("hutchStack");

const hutchStack = new pulumi.StackReference(hutchStackName);
const apiGatewayId = hutchStack.requireOutput("apiGatewayId");
const apiGatewayExecutionArn = hutchStack.requireOutput("apiGatewayExecutionArn");
const hutchApiUrl = hutchStack.requireOutput("apiUrl");
const appOrigin = hutchStack.requireOutput("appOrigin");
const staticBaseUrl = hutchStack.requireOutput("staticBaseUrl");
const sessionsTableName = hutchStack.requireOutput("sessionsTableName");
const sessionsTableArn = hutchStack.requireOutput("sessionsTableArn");

/** Least-privilege: the embed only reads a single session row per logged-in page
 * view to flip the header nav, so it gets GetItem on the sessions table and
 * nothing else (no indexes, no write actions). */
const sessionsRead = new HutchDynamoDBAccess("web-embed-sessions-read", {
	tables: [{ arn: sessionsTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem"],
});

const lambda = new HutchLambda("web-embed", {
	entryPoint: "./src/runtime/lambda.main.ts",
	outputDir: ".lib/web-embed",
	assetDir: "./src/runtime/embed",
	memorySize: 256,
	timeout: 10,
	environment: {
		NODE_ENV: nodeEnv,
		APP_ORIGIN: appOrigin,
		STATIC_BASE_URL: staticBaseUrl,
		DYNAMODB_SESSIONS_TABLE: sessionsTableName,
	},
	policies: [...sessionsRead.policies],
});

const embedRoutes = new HutchAPIGatewayLambdaRoute("web-embed", {
	apiGatewayId,
	apiGatewayExecutionArn,
	lambda,
	routeKeys: ["GET /embed", "ANY /embed/{proxy+}"],
});

export const functionName = lambda.functionName;
export const routeKeys = embedRoutes.routes.map((route) => route.routeKey);

/** The embed Lambda has no URL of its own — it answers on hutch's API Gateway
 * under /embed. Re-export hutch's apiUrl so post-deploy can smoke-test the live
 * routes without a second StackReference at verification time. */
export const apiUrl = hutchApiUrl;
