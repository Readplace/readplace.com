import * as pulumi from "@pulumi/pulumi";
import {
	HutchAPIGatewayLambdaRoute,
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
const stage = config.require("stage");
const hutchStackName = config.require("hutchStack");

const hutchStack = new pulumi.StackReference(hutchStackName);
const apiGatewayId = hutchStack.requireOutput("apiGatewayId");
const apiGatewayExecutionArn = hutchStack.requireOutput("apiGatewayExecutionArn");
const hutchApiUrl = hutchStack.requireOutput("apiUrl");
const appOrigin = hutchStack.requireOutput("appOrigin");

const lambda = new HutchLambda("web-embed", {
	entryPoint: "./src/lambda.main.ts",
	outputDir: ".lib/web-embed",
	assetDir: "./src/embed",
	memorySize: 256,
	timeout: 10,
	environment: {
		NODE_ENV: stage === "production" ? "production" : "development",
		APP_ORIGIN: appOrigin,
	},
	policies: [],
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
