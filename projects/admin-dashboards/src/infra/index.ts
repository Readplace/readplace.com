import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
	APIGatewayLambdaRoute,
	DynamoDBAccess,
	Lambda,
	ssrEdgeSecretFromPlatformStack,
} from "@packages/infra-components/infra";
import {
	ANALYTICS_LOG_GROUP,
	AUTH_DIAGNOSTICS_LOG_GROUP,
	EXCLUDED_IDENTITIES_PARAMETER_NAME,
} from "@packages/dashboard-widgets";
import { requireEnv } from "@packages/require-env";
import { ADMIN_DASHBOARDS_ENV } from "../runtime/lambda.env";

const config = new pulumi.Config();
const nodeEnv = config.require("nodeEnv");
const hutchStackName = config.require("hutchStack");

const hutchStack = new pulumi.StackReference(hutchStackName);
const apiGatewayId = hutchStack.requireOutput("apiGatewayId");
const apiGatewayExecutionArn = hutchStack.requireOutput("apiGatewayExecutionArn");
const hutchApiUrl = hutchStack.requireOutput("apiUrl");
const appOrigin = hutchStack.requireOutput("appOrigin");
const staticBaseUrl = hutchStack.requireOutput("staticBaseUrl");

const awsRegion = new pulumi.Config("aws").require("region");
const awsAccountId = pulumi.output(aws.getCallerIdentity({})).accountId;
const sessionsTableName = config.require("dynamodbSessionsTable");
const usersTableName = config.require("dynamodbUsersTable");
const sessionsTableArn = pulumi.interpolate`arn:aws:dynamodb:${awsRegion}:${awsAccountId}:table/${sessionsTableName}`;
const usersTableArn = pulumi.interpolate`arn:aws:dynamodb:${awsRegion}:${awsAccountId}:table/${usersTableName}`;
const analyticsLogGroupArn = pulumi.interpolate`arn:aws:logs:${awsRegion}:${awsAccountId}:log-group:${ANALYTICS_LOG_GROUP}`;
const authDiagnosticsLogGroupArn = pulumi.interpolate`arn:aws:logs:${awsRegion}:${awsAccountId}:log-group:${AUTH_DIAGNOSTICS_LOG_GROUP}`;
const excludedIdentitiesParameterArn = pulumi.interpolate`arn:aws:ssm:${awsRegion}:${awsAccountId}:parameter${EXCLUDED_IDENTITIES_PARAMETER_NAME}`;

const gateReads = new DynamoDBAccess("admin-dashboards-gate-read", {
	tables: [
		{ arn: sessionsTableArn, includeIndexes: false },
		{ arn: usersTableArn, includeIndexes: false },
	],
	actions: ["dynamodb:GetItem"],
});

const lambda = new Lambda("admin-dashboards", {
	entryPoint: "./src/runtime/lambda.main.ts",
	outputDir: ".lib/admin-dashboards",
	assetDir: "./src/runtime/dashboards",
	memorySize: 1769,
	timeout: 30,
	environmentNames: ADMIN_DASHBOARDS_ENV,
	environment: {
		NODE_ENV: nodeEnv,
		APP_ORIGIN: appOrigin,
		STATIC_BASE_URL: staticBaseUrl,
		DYNAMODB_SESSIONS_TABLE: sessionsTableName,
		DYNAMODB_USERS_TABLE: usersTableName,
		ADMIN_EMAILS: requireEnv("ADMIN_EMAILS"),
		ANALYTICS_SALT: pulumi.secret(requireEnv("ANALYTICS_SALT")),
		SSR_EDGE_SECRET: ssrEdgeSecretFromPlatformStack(config),
	},
	policies: [...gateReads.policies],
});

new aws.iam.RolePolicy("admin-dashboards-read", {
	role: lambda.role.name,
	policy: pulumi
		.all([analyticsLogGroupArn, authDiagnosticsLogGroupArn, excludedIdentitiesParameterArn])
		.apply(([analyticsArn, authDiagnosticsArn, parameterArn]) =>
			JSON.stringify({
				Version: "2012-10-17",
				Statement: [
					{
						Effect: "Allow",
						Action: ["logs:StartQuery"],
						Resource: [analyticsArn, `${analyticsArn}:*`, authDiagnosticsArn, `${authDiagnosticsArn}:*`],
					},
					{
						Effect: "Allow",
						Action: ["logs:GetQueryResults", "logs:StopQuery"],
						Resource: ["*"],
					},
					{
						Effect: "Allow",
						Action: ["ssm:GetParameter"],
						Resource: [parameterArn],
					},
				],
			}),
		),
});

const dashboardRoutes = new APIGatewayLambdaRoute("admin-dashboards", {
	apiGatewayId,
	apiGatewayExecutionArn,
	lambda,
	routeKeys: ["GET /admin/dashboards", "ANY /admin/dashboards/{proxy+}"],
});

export const routeKeys = dashboardRoutes.routes.map((route) => route.routeKey);

export const apiUrl = hutchApiUrl;
