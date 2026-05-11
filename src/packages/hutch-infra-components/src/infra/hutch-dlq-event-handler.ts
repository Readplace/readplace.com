import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { HutchEventBus } from "./event-bus";
import { HutchDynamoDBAccess } from "./hutch-dynamodb-access";
import { HutchLambda, type LambdaPolicy } from "./hutch-lambda";
import type { HutchSQS } from "./hutch-sqs";

/**
 * Attaches a Lambda to the DLQ of an existing `HutchSQS` so dead-lettered
 * messages drive a state transition on the articles table and publish a
 * domain failure event. Most configuration is fixed (256MB memory, 30s
 * timeout, DYNAMODB_ARTICLES_TABLE + EVENT_BUS_NAME env vars, entry point
 * derived from the component name); `batchSize` is required so every
 * callsite makes the choice explicit. The mapping always wires
 * ReportBatchItemFailures so a future `batchSize > 1` does not silently
 * drop sibling records on a partial failure.
 *
 * `additionalDynamoActions`, `additionalEnvironment`, and `additionalPolicies`
 * are escape hatches for callers whose transition needs richer access than
 * the default "UpdateItem only, no extra env". Phase 2 of the aggregate
 * migration uses them to add `dynamodb:GetItem` (the aggregate's
 * `store.load` reads before it writes) and to pass `GENERATE_SUMMARY_QUEUE_URL`
 * even though the migrated DLQ transition never dispatches a summary command —
 * the aggregate effect dispatcher is wired uniformly so a future transition
 * change at the same callsite cannot regress without re-wiring infra.
 */
export class HutchDLQEventHandler extends pulumi.ComponentResource {
	constructor(
		name: string,
		args: {
			sourceQueue: HutchSQS;
			tableArn: pulumi.Input<string>;
			tableName: pulumi.Input<string>;
			eventBus: HutchEventBus;
			/** Valid range: 1–10 (AWS SQS EventSourceMapping limit for standard queues). */
			batchSize: number;
			additionalDynamoActions?: readonly string[];
			additionalEnvironment?: Record<string, pulumi.Input<string>>;
			additionalPolicies?: readonly LambdaPolicy[];
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchDLQEventHandler", name, {}, opts);

		const dynamodb = new HutchDynamoDBAccess(`${name}-dynamodb`, {
			tables: [{ arn: args.tableArn, includeIndexes: false }],
			actions: ["dynamodb:UpdateItem", ...(args.additionalDynamoActions ?? [])],
		});

		const lambda = new HutchLambda(name, {
			entryPoint: `./src/runtime/${name}.main.ts`,
			outputDir: `.lib/${name}`,
			assetDir: "./src",
			memorySize: 256,
			timeout: 30,
			environment: {
				DYNAMODB_ARTICLES_TABLE: args.tableName,
				EVENT_BUS_NAME: args.eventBus.eventBusName,
				...args.additionalEnvironment,
			},
			policies: [...dynamodb.policies, ...(args.additionalPolicies ?? [])],
		}, { parent: this });

		args.eventBus.grantPublish(lambda);

		new aws.iam.RolePolicy(`${name}-sqs-recv`, {
			name: `${name}-sqs-recv`,
			role: lambda.role.name,
			policy: args.sourceQueue.dlqArn.apply((arn) =>
				JSON.stringify({
					Version: "2012-10-17",
					Statement: [{
						Effect: "Allow",
						Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
						Resource: [arn],
					}],
				}),
			),
		}, { parent: this });

		new aws.lambda.EventSourceMapping(`${name}-mapping`, {
			eventSourceArn: args.sourceQueue.dlqArn,
			functionName: lambda.arn,
			batchSize: args.batchSize,
			functionResponseTypes: ["ReportBatchItemFailures"],
		}, { parent: this });

		this.registerOutputs();
	}
}
