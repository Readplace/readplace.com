import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { HutchEventBus } from "./event-bus";
import { HutchDynamoDBAccess } from "./hutch-dynamodb-access";
import { HutchLambda } from "./hutch-lambda";
import type { HutchSQS } from "./hutch-sqs";

/**
 * Attaches a Lambda to the DLQ of an existing `HutchSQS` so dead-lettered
 * messages drive a state transition on the articles table and publish a
 * domain failure event. Most configuration is fixed (256MB memory, 30s
 * timeout, dynamodb:UpdateItem only, DYNAMODB_ARTICLES_TABLE +
 * EVENT_BUS_NAME env vars, entry point derived from the component name);
 * `batchSize` is required so every callsite makes the choice explicit. The
 * mapping always wires ReportBatchItemFailures so a future `batchSize > 1`
 * does not silently drop sibling records on a partial failure.
 */
export class HutchDLQEventHandler extends pulumi.ComponentResource {
	constructor(
		name: string,
		args: {
			sourceQueue: HutchSQS;
			tableArn: pulumi.Input<string>;
			tableName: pulumi.Input<string>;
			eventBus: HutchEventBus;
			batchSize: number;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchDLQEventHandler", name, {}, opts);

		const dynamodb = new HutchDynamoDBAccess(`${name}-dynamodb`, {
			tables: [{ arn: args.tableArn, includeIndexes: false }],
			actions: ["dynamodb:UpdateItem"],
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
			},
			policies: [...dynamodb.policies],
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
