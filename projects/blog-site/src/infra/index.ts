import * as pulumi from "@pulumi/pulumi";
import {
	HutchAPIGatewayLambdaRoute,
	HutchLambda,
} from "@packages/hutch-infra-components/infra";

/**
 * blog-site is deployed as its own Lambda behind hutch's existing API Gateway:
 * more-specific routes (GET /blog, ANY /blog/{proxy+}) take precedence over
 * hutch's $default, so readplace.com/blog is served here while everything else
 * falls through to hutch. The coupling is deploy-time and one-way — this stack
 * reads hutch's API id/exec-arn via a StackReference and attaches its own
 * integration + routes + invoke permission. There is no runtime code edge.
 */
const config = new pulumi.Config();
const stage = config.require("stage");
const staticBaseUrl = config.require("staticBaseUrl");
const hutchStackName = config.require("hutchStack");

const hutchStack = new pulumi.StackReference(hutchStackName);
const apiGatewayId = hutchStack.requireOutput("apiGatewayId");
const apiGatewayExecutionArn = hutchStack.requireOutput("apiGatewayExecutionArn");

const lambda = new HutchLambda("blog-site", {
	entryPoint: "./src/runtime/lambda.main.ts",
	outputDir: ".lib/blog-site",
	assetDir: "./src/runtime",
	memorySize: 256,
	timeout: 10,
	environment: {
		NODE_ENV: stage === "production" ? "production" : "development",
		STATIC_BASE_URL: staticBaseUrl,
	},
	policies: [],
});

const blogRoutes = new HutchAPIGatewayLambdaRoute("blog-site", {
	apiGatewayId,
	apiGatewayExecutionArn,
	lambda,
	routeKeys: ["GET /blog", "ANY /blog/{proxy+}"],
});

export const functionName = lambda.functionName;
export const routeKeys = blogRoutes.routes.map((route) => route.routeKey);
