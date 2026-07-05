import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
	HutchAPIGatewayLambdaRoute,
	HutchDynamoDBAccess,
	HutchLambda,
} from "@packages/hutch-infra-components/infra";
import { BLOG_SITE_LAMBDA_NAME } from "@packages/hutch-infra-components";
import { requireEnv } from "@packages/require-env";

/**
 * blog-site is deployed as its own Lambda behind hutch's existing API Gateway:
 * more-specific routes (GET /blog, ANY /blog/{proxy+}) take precedence over
 * hutch's $default, so readplace.com/blog is served here while everything else
 * falls through to hutch. The coupling is deploy-time and one-way — this stack
 * reads hutch's API id/exec-arn via a StackReference and attaches its own
 * integration + routes + invoke permission. There is no runtime code edge.
 */
const config = new pulumi.Config();
const nodeEnv = config.require("nodeEnv");
const staticBaseUrl = config.require("staticBaseUrl");
const hutchStackName = config.require("hutchStack");

const hutchStack = new pulumi.StackReference(hutchStackName);
const apiGatewayId = hutchStack.requireOutput("apiGatewayId");
const apiGatewayExecutionArn = hutchStack.requireOutput("apiGatewayExecutionArn");
const hutchApiUrl = hutchStack.requireOutput("apiUrl");

// The sessions table name is a config constant (identical across envs), so this
// stack reads it from its own config rather than via a StackReference — a
// cross-stack read of a value you could put in config couples deploy order and
// breaks the first deploy after any new hutch output (infrastructure-design:
// "Don't StackReference a Value You Could Put in Config"). The ARN is derived
// from account + region rather than read back.
const awsRegion = new pulumi.Config("aws").require("region");
const awsAccountId = pulumi.output(aws.getCallerIdentity({})).accountId;
const sessionsTableName = config.require("dynamodbSessionsTable");
const sessionsTableArn = pulumi.interpolate`arn:aws:dynamodb:${awsRegion}:${awsAccountId}:table/${sessionsTableName}`;

/** Least-privilege: the blog only reads a single session row per logged-in page
 * view to flip the header nav, so it gets GetItem on the sessions table and
 * nothing else (no indexes, no write actions). */
const sessionsRead = new HutchDynamoDBAccess("blog-site-sessions-read", {
	tables: [{ arn: sessionsTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem"],
});

const lambda = new HutchLambda(BLOG_SITE_LAMBDA_NAME, {
	entryPoint: "./src/runtime/lambda.main.ts",
	outputDir: ".lib/blog-site",
	assetDir: "./src/runtime",
	memorySize: 256,
	timeout: 10,
	environment: {
		NODE_ENV: nodeEnv,
		STATIC_BASE_URL: staticBaseUrl,
		DYNAMODB_SESSIONS_TABLE: sessionsTableName,
		// Same deploy-env secret hutch's infra reads: visitor_hash must match
		// across blog + app so the dashboard's owner-exclusion list applies to both.
		ANALYTICS_SALT: requireEnv("ANALYTICS_SALT"),
		// Only the scheme is consumed (isHttpsOrigin) to decide Secure cookies.
		APP_ORIGIN: hutchApiUrl,
	},
	policies: [...sessionsRead.policies],
});

const blogRoutes = new HutchAPIGatewayLambdaRoute("blog-site", {
	apiGatewayId,
	apiGatewayExecutionArn,
	lambda,
	routeKeys: ["GET /blog", "ANY /blog/{proxy+}"],
});

export const functionName = lambda.functionName;
export const routeKeys = blogRoutes.routes.map((route) => route.routeKey);

/** The blog Lambda has no URL of its own — it answers on hutch's API Gateway
 * under /blog. Re-export hutch's apiUrl so post-deploy can smoke-test the live
 * routes without a second StackReference at verification time. */
export const apiUrl = hutchApiUrl;
