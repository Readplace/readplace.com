import assert from "node:assert/strict";
import type {
	Handler,
	SQSBatchResponse,
	SQSEvent,
	SQSMessageAttributes,
	SQSRecord,
	SQSRecordAttributes,
} from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initDeadLetterRouter } from "./dead-letter-router";

const SHARED_DLQ_ARN = "arn:aws:sqs:ap-southeast-2:123456789:save-link-failures-dlq";

function attributes(sourceQueueName?: string): SQSRecordAttributes {
	return {
		ApproximateReceiveCount: "3",
		SentTimestamp: "1620000000000",
		SenderId: "TESTID",
		ApproximateFirstReceiveTimestamp: "1620000000001",
		...(sourceQueueName === undefined
			? {}
			: {
					DeadLetterQueueSourceArn: `arn:aws:sqs:ap-southeast-2:123456789:${sourceQueueName}`,
				}),
	};
}

function eventBridgeAttributes(targetQueueName: string): SQSMessageAttributes {
	return {
		RULE_ARN: {
			stringValue: `arn:aws:events:ap-southeast-2:123456789:rule/${targetQueueName}-rule`,
			dataType: "String",
		},
		TARGET_ARN: {
			stringValue: `arn:aws:sqs:ap-southeast-2:123456789:${targetQueueName}`,
			dataType: "String",
		},
		ERROR_CODE: { stringValue: "NO_PERMISSIONS", dataType: "String" },
	};
}

function record(
	messageId: string,
	sourceQueueName?: string,
	messageAttributes: SQSMessageAttributes = {},
): SQSRecord {
	return {
		messageId,
		receiptHandle: `receipt-${messageId}`,
		body: JSON.stringify({ detail: { url: `https://example.com/${messageId}` } }),
		attributes: attributes(sourceQueueName),
		messageAttributes,
		md5OfBody: "",
		eventSource: "aws:sqs",
		eventSourceARN: SHARED_DLQ_ARN,
		awsRegion: "ap-southeast-2",
	};
}

function event(...records: SQSRecord[]): SQSEvent {
	return { Records: records };
}

function routeReturning(
	batchItemFailures: SQSBatchResponse["batchItemFailures"] = [],
): jest.MockedFunction<Handler<SQSEvent, SQSBatchResponse>> {
	return jest.fn().mockResolvedValue({ batchItemFailures });
}

describe("initDeadLetterRouter", () => {
	it("hands a dead letter to the route registered for the queue it was redriven from", async () => {
		const saveLink = routeReturning();
		const generateSummary = routeReturning();
		const router = initDeadLetterRouter({
			routes: { "save-link-command-q": saveLink, "generate-summary-q": generateSummary },
		});

		const deadLetter = record("msg-1", "save-link-command-q");
		await router(event(deadLetter), buildLambdaContext(), () => {});

		expect(saveLink).toHaveBeenCalledTimes(1);
		expect(saveLink.mock.calls[0]?.[0]).toEqual({ Records: [deadLetter] });
		expect(generateSummary).not.toHaveBeenCalled();
	});

	it("gives each source queue's records to its own route in one batch", async () => {
		const saveLink = routeReturning();
		const generateSummary = routeReturning();
		const router = initDeadLetterRouter({
			routes: { "save-link-command-q": saveLink, "generate-summary-q": generateSummary },
		});

		const first = record("msg-1", "save-link-command-q");
		const second = record("msg-2", "generate-summary-q");
		const third = record("msg-3", "save-link-command-q");
		await router(event(first, second, third), buildLambdaContext(), () => {});

		expect(saveLink.mock.calls[0]?.[0]).toEqual({ Records: [first, third] });
		expect(generateSummary.mock.calls[0]?.[0]).toEqual({ Records: [second] });
	});

	it("merges the batch item failures reported by every route", async () => {
		const router = initDeadLetterRouter({
			routes: {
				"save-link-command-q": routeReturning([{ itemIdentifier: "msg-1" }]),
				"generate-summary-q": routeReturning([{ itemIdentifier: "msg-2" }]),
			},
		});

		const result = await router(
			event(record("msg-1", "save-link-command-q"), record("msg-2", "generate-summary-q")),
			buildLambdaContext(),
			() => {},
		);

		assert.deepEqual(result, {
			batchItemFailures: [{ itemIdentifier: "msg-1" }, { itemIdentifier: "msg-2" }],
		});
	});

	it("passes the Lambda context and callback through to the route", async () => {
		const saveLink = routeReturning();
		const router = initDeadLetterRouter({ routes: { "save-link-command-q": saveLink } });
		const context = buildLambdaContext();
		const callback = () => {};

		await router(event(record("msg-1", "save-link-command-q")), context, callback);

		expect(saveLink.mock.calls[0]?.[1]).toBe(context);
		expect(saveLink.mock.calls[0]?.[2]).toBe(callback);
	});

	it("reports no failures for an empty batch", async () => {
		const router = initDeadLetterRouter({ routes: { "save-link-command-q": routeReturning() } });

		const result = await router(event(), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
	});

	it("routes an EventBridge delivery failure on the target queue it could not reach", async () => {
		const saveLink = routeReturning();
		const router = initDeadLetterRouter({ routes: { "save-link-command-q": saveLink } });

		const deadLetter = record(
			"msg-1",
			undefined,
			eventBridgeAttributes("save-link-command-q"),
		);
		await router(event(deadLetter), buildLambdaContext(), () => {});

		expect(saveLink).toHaveBeenCalledTimes(1);
		expect(saveLink.mock.calls[0]?.[0]).toEqual({ Records: [deadLetter] });
	});

	it("refuses a dead letter that names no source queue at all", async () => {
		const saveLink = routeReturning();
		const router = initDeadLetterRouter({ routes: { "save-link-command-q": saveLink } });

		await expect(
			router(event(record("msg-1")), buildLambdaContext(), () => {}),
		).rejects.toThrow("names no source queue");
		expect(saveLink).not.toHaveBeenCalled();
	});

	it("refuses a dead letter from a source queue that has no registered route", async () => {
		const saveLink = routeReturning();
		const router = initDeadLetterRouter({ routes: { "save-link-command-q": saveLink } });

		await expect(
			router(event(record("msg-1", "unmapped-q")), buildLambdaContext(), () => {}),
		).rejects.toThrow("No dead-letter route registered for source queue unmapped-q");
		expect(saveLink).not.toHaveBeenCalled();
	});

	it("refuses a route that answers without a batch response", async () => {
		const router = initDeadLetterRouter({
			routes: { "save-link-command-q": jest.fn().mockResolvedValue(undefined) },
		});

		await expect(
			router(event(record("msg-1", "save-link-command-q")), buildLambdaContext(), () => {}),
		).rejects.toThrow("returned no batch response");
	});
});
