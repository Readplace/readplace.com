import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { StripeEventType } from "../stripe-events";
import type { HutchEventBus } from "./event-bus";
import { HutchAPIGatewayLambdaRoute } from "./hutch-api-gateway-lambda-route";
import { HutchDynamoDBAccess } from "./hutch-dynamodb-access";
import { HutchLambda } from "./hutch-lambda";

/**
 * Receives Stripe HTTP webhooks via API Gateway, verifies the HMAC
 * signature, looks up the affected subscription row, and publishes a
 * domain event onto the shared EventBridge bus. Unknown Stripe event
 * types throw at the runtime dispatcher and surface as a Lambda error →
 * CloudWatch alarm → SNS email, so drift between the Stripe Dashboard
 * configuration and the deployed code is detected loudly rather than
 * being silently swallowed.
 *
 * `events` declares the Stripe event types the runtime is wired to
 * handle; it is informational for AWS (exposed via the
 * `STRIPE_EVENT_TYPES` env var so `aws lambda
 * get-function-configuration` answers "what does this Lambda listen
 * to?") and the TypeScript `StripeEventType` union is the binding
 * source of truth.
 */
export class HutchStripeWebhookReceiver extends pulumi.ComponentResource {
	constructor(
		name: string,
		args: {
			apiGatewayId: pulumi.Input<string>;
			apiGatewayExecutionArn: pulumi.Input<string>;
			routeKey: string;
			eventBus: HutchEventBus;
			subscriptionProvidersTable: {
				arn: pulumi.Input<string>;
				name: pulumi.Input<string>;
			};
			webhookSecret: pulumi.Input<string>;
			events: readonly StripeEventType[];
			alertEmail: string;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchStripeWebhookReceiver", name, {}, opts);

		const dynamodb = new HutchDynamoDBAccess(`${name}-dynamodb`, {
			tables: [{ arn: args.subscriptionProvidersTable.arn, includeIndexes: true }],
			actions: ["dynamodb:GetItem", "dynamodb:Query"],
		});

		const lambda = new HutchLambda(name, {
			entryPoint: `./src/runtime/${name}.main.ts`,
			outputDir: `.lib/${name}`,
			assetDir: "./src/runtime",
			memorySize: 128,
			timeout: 10,
			environment: {
				STRIPE_WEBHOOK_SECRET: args.webhookSecret,
				EVENT_BUS_NAME: args.eventBus.eventBusName,
				DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: args.subscriptionProvidersTable.name,
				STRIPE_EVENT_TYPES: JSON.stringify(args.events),
			},
			policies: [...dynamodb.policies],
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		args.eventBus.grantPublish(lambda);

		new HutchAPIGatewayLambdaRoute(`${name}-route`, {
			apiGatewayId: args.apiGatewayId,
			apiGatewayExecutionArn: args.apiGatewayExecutionArn,
			lambda,
			routeKeys: [args.routeKey],
		}, { parent: this, aliases: [{ name: "stripe-webhook", parent: pulumi.rootStackResource }] });

		const topic = new aws.sns.Topic(`${name}-alarm-topic`, {
			name: `${name}-alarm-topic`,
		}, { parent: this });

		new aws.sns.TopicSubscription(`${name}-alarm-email`, {
			topic: topic.arn,
			protocol: "email",
			endpoint: args.alertEmail,
		}, { parent: this });

		new aws.cloudwatch.MetricAlarm(`${name}-error-alarm`, {
			name: `${name}-error-alarm`,
			comparisonOperator: "GreaterThanOrEqualToThreshold",
			evaluationPeriods: 1,
			metricName: "Errors",
			namespace: "AWS/Lambda",
			period: 300,
			statistic: "Sum",
			threshold: 1,
			alarmDescription: `Stripe webhook receiver ${name} raised a Lambda error — likely an unconfigured Stripe event type or downstream failure`,
			dimensions: {
				FunctionName: lambda.functionName,
			},
			alarmActions: [topic.arn],
		}, { parent: this });

		this.registerOutputs();
	}
}
