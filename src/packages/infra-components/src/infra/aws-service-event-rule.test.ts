import assert from "node:assert/strict";
import * as pulumi from "@pulumi/pulumi";
import { AwsServiceEventRule } from "./aws-service-event-rule";

type RecordedResource = { type: string; name: string; inputs: Record<string, unknown> };

function recordResources(): RecordedResource[] {
	const resources: RecordedResource[] = [];
	pulumi.runtime.setMocks(
		{
			newResource: (args) => {
				resources.push({ type: args.type, name: args.name, inputs: args.inputs });
				return {
					id: `${args.name}-id`,
					state: { ...args.inputs, name: `${args.name}-generated`, arn: `arn:aws:events:ap-southeast-2:123456789012:rule/${args.name}` },
				};
			},
			call: (args) => args.inputs,
		},
		"project",
		"stack",
		true,
	);
	return resources;
}

async function resourcesRegistered(resources: RecordedResource[], count: number): Promise<void> {
	for (let turn = 0; turn < 100 && resources.length < count; turn++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.equal(resources.length, count);
}

function inputsOf(resources: RecordedResource[], name: string): Record<string, unknown> {
	const resource = resources.find((candidate) => candidate.name === name);
	assert(resource, `no resource named ${name}`);
	return resource.inputs;
}

const queueArn = "arn:aws:sqs:ap-southeast-2:123456789012:media-audio-render-transcript-q";
const dlqArn = "arn:aws:sqs:ap-southeast-2:123456789012:hutch-shared-dlq";
const ruleArn = "arn:aws:events:ap-southeast-2:123456789012:rule/transcribe-done-rule";

const target = {
	queueArn: pulumi.output(queueArn),
	queueUrl: pulumi.output("https://sqs.ap-southeast-2.amazonaws.com/123456789012/media-audio-render-transcript-q"),
	dlqArn: pulumi.output(dlqArn),
	ownDlq: undefined,
};

describe("AwsServiceEventRule", () => {
	it("matches the AWS event on the default bus with no bus name", async () => {
		const resources = recordResources();

		AwsServiceEventRule.create("transcribe-done", {
			event: { source: "aws.transcribe", detailType: "Transcribe Job State Change" },
			detail: {
				TranscriptionJobStatus: ["COMPLETED", "FAILED"],
				TranscriptionJobName: [{ prefix: "rp-" }],
			},
			target,
		});
		await resourcesRegistered(resources, 3);

		assert.deepEqual(inputsOf(resources, "transcribe-done-rule"), {
			eventPattern: JSON.stringify({
				source: ["aws.transcribe"],
				"detail-type": ["Transcribe Job State Change"],
				detail: {
					TranscriptionJobStatus: ["COMPLETED", "FAILED"],
					TranscriptionJobName: [{ prefix: "rp-" }],
				},
			}),
		});
	});

	it("sends matched events to the queue and failed deliveries to its dead-letter queue", async () => {
		const resources = recordResources();

		AwsServiceEventRule.create("transcribe-done", {
			event: { source: "aws.transcribe", detailType: "Transcribe Job State Change" },
			target,
		});
		await resourcesRegistered(resources, 3);

		assert.deepEqual(inputsOf(resources, "transcribe-done-target"), {
			rule: "transcribe-done-rule-generated",
			arn: queueArn,
			deadLetterConfig: { arn: dlqArn },
		});
	});

	it("lets only this rule send to the queue", async () => {
		const resources = recordResources();

		AwsServiceEventRule.create("transcribe-done", {
			event: { source: "aws.transcribe", detailType: "Transcribe Job State Change" },
			target,
		});
		await resourcesRegistered(resources, 3);

		const policy = inputsOf(resources, "transcribe-done-queue-policy").policy;
		assert.equal(typeof policy, "string");
		assert.deepEqual(JSON.parse(String(policy)).Statement, [
			{
				Effect: "Allow",
				Principal: { Service: "events.amazonaws.com" },
				Action: "sqs:SendMessage",
				Resource: queueArn,
				Condition: { ArnEquals: { "aws:SourceArn": ruleArn } },
			},
		]);
	});

	it("lets the rule send to the target's own dead-letter queue when it has one", async () => {
		const resources = recordResources();
		const ownDlqArn = "arn:aws:sqs:ap-southeast-2:123456789012:media-audio-render-transcript-dlq";

		AwsServiceEventRule.create("transcribe-done", {
			event: { source: "aws.transcribe", detailType: "Transcribe Job State Change" },
			target: {
				...target,
				dlqArn: pulumi.output(ownDlqArn),
				ownDlq: {
					arn: pulumi.output(ownDlqArn),
					url: pulumi.output("https://sqs.ap-southeast-2.amazonaws.com/123456789012/media-audio-render-transcript-dlq"),
					name: pulumi.output("media-audio-render-transcript-dlq"),
					alarmTopicArn: pulumi.output("arn:aws:sns:ap-southeast-2:123456789012:dlq-alerts"),
				},
			},
		});
		await resourcesRegistered(resources, 4);

		const policy = inputsOf(resources, "transcribe-done-dlq-policy").policy;
		assert.equal(JSON.parse(String(policy)).Statement[0].Resource, ownDlqArn);
	});
});
