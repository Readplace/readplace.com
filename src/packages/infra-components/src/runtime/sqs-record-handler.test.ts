import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/article-state-types";
import type { Context, SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";
import {
	initRetryingSqsRecordHandler,
	initSqsRecordHandler,
	type MalformedRecordPolicy,
	type RecordContext,
	type RecordFailureReport,
	type RecordSettlement,
} from "./sqs-record-handler";

const definition = { detailSchema: z.object({ userId: UserIdSchema }) };

type Detail = z.infer<typeof definition.detailSchema>;

const lambdaContext: Context = {
	callbackWaitsForEmptyEventLoop: true,
	functionName: "test",
	functionVersion: "1",
	invokedFunctionArn: "arn:aws:lambda:ap-southeast-2:123456789:function:test",
	memoryLimitInMB: "128",
	awsRequestId: "test-request-id",
	logGroupName: "/aws/lambda/test",
	logStreamName: "test-stream",
	getRemainingTimeInMillis: () => 30000,
	done: () => {},
	fail: () => {},
	succeed: () => {},
};

function buildRecord(params: { messageId: string; body: string; receiveCount?: string }): SQSRecord {
	return {
		messageId: params.messageId,
		receiptHandle: `receipt-${params.messageId}`,
		body: params.body,
		attributes: {
			ApproximateReceiveCount: params.receiveCount ?? "1",
			SentTimestamp: "0",
			SenderId: "sender",
			ApproximateFirstReceiveTimestamp: "0",
		},
		messageAttributes: {},
		md5OfBody: "md5",
		eventSource: "aws:sqs",
		eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:queue",
		awsRegion: "ap-southeast-2",
	};
}

function envelope(detail: unknown): string {
	return JSON.stringify({ detail });
}

type LoggedError = { message: string; details: unknown };

function setup(params: {
	failure: RecordFailureReport<Detail>;
	malformed: MalformedRecordPolicy<Detail>;
	handle?: (detail: Detail, record: RecordContext) => Promise<void>;
}) {
	const logged: LoggedError[] = [];
	const handled: Array<{ detail: Detail; record: RecordContext }> = [];
	const handler = initSqsRecordHandler({
		definition,
		logger: { error: (message, details) => logged.push({ message, details }) },
		failure: params.failure,
		malformed: params.malformed,
		handle: async (detail, record) => {
			handled.push({ detail, record });
			if (params.handle) await params.handle(detail, record);
		},
	});
	const run = async (records: SQSRecord[]) => {
		const event: SQSEvent = { Records: records };
		const result = await handler(event, lambdaContext, () => {});
		assert(result, "the record handler must resolve a batch response");
		return result;
	};
	return { run, logged, handled };
}

const malformedBodies: Array<{ name: string; body: string; errorClass: new (...args: never[]) => Error }> = [
	{ name: "unparseable JSON", body: "{not json", errorClass: SyntaxError },
	{ name: "a body without detail", body: "[]", errorClass: z.ZodError },
	{ name: "a detail that misses the schema", body: envelope({ userId: 7 }), errorClass: z.ZodError },
];

describe("initSqsRecordHandler", () => {
	it("hands the parsed detail and the record context to handle", async () => {
		const { run, logged, handled } = setup({ failure: { message: "failed" }, malformed: { policy: "retry" } });

		const body = envelope({ userId: "alice" });

		const result = await run([buildRecord({ messageId: "m-1", body, receiveCount: "3" })]);

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(handled, [
			{ detail: { userId: UserIdSchema.parse("alice") }, record: { messageId: "m-1", receiveCount: 3, body } },
		]);
		assert.deepEqual(logged, []);
	});

	it("handles records in order", async () => {
		const { run, handled } = setup({ failure: { message: "failed" }, malformed: { policy: "retry" } });

		await run([
			buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }) }),
			buildRecord({ messageId: "m-2", body: envelope({ userId: "bob" }) }),
			buildRecord({ messageId: "m-3", body: envelope({ userId: "carol" }) }),
		]);

		assert.deepEqual(
			handled.map(({ record }) => record.messageId),
			["m-1", "m-2", "m-3"],
		);
	});

	it("logs the failure message and retries only the record whose handle throws", async () => {
		const error = new Error("boom");
		const { run, logged } = setup({
			failure: { message: "record failed" },
			malformed: { policy: "retry" },
			handle: async (detail) => {
				if (detail.userId === "bob") throw error;
			},
		});

		const result = await run([
			buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }) }),
			buildRecord({ messageId: "m-2", body: envelope({ userId: "bob" }) }),
		]);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-2" }] });
		assert.deepEqual(logged, [{ message: "record failed", details: { messageId: "m-2", error } }]);
	});

	it("awaits the failure report, with the parsed detail, instead of logging when handle throws", async () => {
		const error = new Error("boom");
		const reports: Array<{ record: RecordContext; error: unknown; detail: Detail | undefined }> = [];
		const { run, logged } = setup({
			failure: {
				report: async (params) => {
					await Promise.resolve();
					reports.push(params);
				},
			},
			malformed: { policy: "retry" },
			handle: async () => {
				throw error;
			},
		});

		const body = envelope({ userId: "alice" });

		const result = await run([buildRecord({ messageId: "m-1", body, receiveCount: "2" })]);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(reports, [
			{ record: { messageId: "m-1", receiveCount: 2, body }, error, detail: { userId: UserIdSchema.parse("alice") } },
		]);
		assert.deepEqual(logged, []);
	});

	describe.each(malformedBodies)("a malformed record: $name", ({ body, errorClass }) => {
		it("reports through the failure message and retries under a bare retry policy", async () => {
			const { run, logged, handled } = setup({ failure: { message: "record failed" }, malformed: { policy: "retry" } });

			const result = await run([buildRecord({ messageId: "m-1", body })]);

			assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
			assert.equal(logged.length, 1);
			assert.equal(logged[0]?.message, "record failed");
			const details = z.object({ messageId: z.string(), error: z.instanceof(errorClass) }).parse(logged[0]?.details);
			assert.equal(details.messageId, "m-1");
			assert.deepEqual(handled, []);
		});

		it("logs its own message and retries under a retry policy with a message", async () => {
			const { run, logged, handled } = setup({
				failure: { message: "record failed" },
				malformed: { policy: "retry", message: "malformed record" },
			});

			const result = await run([buildRecord({ messageId: "m-1", body })]);

			assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
			assert.equal(logged.length, 1);
			assert.equal(logged[0]?.message, "malformed record");
			const details = z.object({ messageId: z.string(), error: z.instanceof(errorClass) }).parse(logged[0]?.details);
			assert.equal(details.messageId, "m-1");
			assert.deepEqual(handled, []);
		});

		it("logs its own message and acknowledges under an acknowledge policy with a message", async () => {
			const { run, logged, handled } = setup({
				failure: { message: "record failed" },
				malformed: { policy: "acknowledge", message: "malformed record" },
			});

			const result = await run([buildRecord({ messageId: "m-1", body })]);

			assert.deepEqual(result, { batchItemFailures: [] });
			assert.equal(logged.length, 1);
			assert.equal(logged[0]?.message, "malformed record");
			assert.deepEqual(handled, []);
		});

		it("calls its report without a detail and acknowledges under an acknowledge policy with a report", async () => {
			const reports: Array<{ record: RecordContext; error: unknown; detail: Detail | undefined }> = [];
			const { run, logged, handled } = setup({
				failure: { message: "record failed" },
				malformed: { policy: "acknowledge", report: (params) => void reports.push(params) },
			});

			const result = await run([buildRecord({ messageId: "m-1", body, receiveCount: "4" })]);

			assert.deepEqual(result, { batchItemFailures: [] });
			assert.equal(reports.length, 1);
			assert.deepEqual(reports[0]?.record, { messageId: "m-1", receiveCount: 4, body });
			assert.ok(reports[0]?.error instanceof errorClass);
			assert.equal(reports[0]?.detail, undefined);
			assert.deepEqual(logged, []);
			assert.deepEqual(handled, []);
		});
	});
});

type VisibilityChange = { receiptHandle: string; visibilityTimeoutSeconds: number };

function setupRetrying(params: {
	failure: RecordFailureReport<Detail>;
	malformed: MalformedRecordPolicy<Detail>;
	handle: (detail: Detail, record: RecordContext) => Promise<RecordSettlement>;
	random?: () => number;
	changeVisibility?: (change: VisibilityChange) => Promise<void>;
}) {
	const logged: LoggedError[] = [];
	const handled: Array<{ detail: Detail; record: RecordContext }> = [];
	const visibilityChanges: VisibilityChange[] = [];
	const handler = initRetryingSqsRecordHandler({
		definition,
		logger: { error: (message, details) => logged.push({ message, details }) },
		failure: params.failure,
		malformed: params.malformed,
		retryScheduleSeconds: [60, 600],
		random: params.random ?? (() => 0.5),
		visibilityFailureMessage: "visibility change failed",
		changeVisibility: async (change) => {
			visibilityChanges.push(change);
			if (params.changeVisibility) await params.changeVisibility(change);
		},
		handle: async (detail, record) => {
			handled.push({ detail, record });
			return params.handle(detail, record);
		},
	});
	const run = async (records: SQSRecord[]) => {
		const event: SQSEvent = { Records: records };
		const result = await handler(event, lambdaContext, () => {});
		assert(result, "the record handler must resolve a batch response");
		return result;
	};
	return { run, logged, handled, visibilityChanges };
}

const retryLater = async (): Promise<RecordSettlement> => ({ kind: "retry-later" });

describe("initRetryingSqsRecordHandler", () => {
	it.each([
		{ random: 0, expectedSeconds: 48 },
		{ random: 1, expectedSeconds: 72 },
	])(
		"moves the record's visibility to 60 s scaled by jitter $random and fails the record when handle asks to retry on receive 1",
		async ({ random, expectedSeconds }) => {
			const { run, logged, visibilityChanges } = setupRetrying({
				failure: { message: "record failed" },
				malformed: { policy: "retry" },
				handle: retryLater,
				random: () => random,
			});

			const result = await run([buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }), receiveCount: "1" })]);

			assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
			assert.deepEqual(visibilityChanges, [{ receiptHandle: "receipt-m-1", visibilityTimeoutSeconds: expectedSeconds }]);
			assert.deepEqual(logged, []);
		},
	);

	it("uses 600 s on receive 2", async () => {
		const { run, visibilityChanges } = setupRetrying({
			failure: { message: "record failed" },
			malformed: { policy: "retry" },
			handle: retryLater,
			random: () => 0.5,
		});

		const result = await run([buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }), receiveCount: "2" })]);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(visibilityChanges, [{ receiptHandle: "receipt-m-1", visibilityTimeoutSeconds: 600 }]);
	});

	it("acknowledges the record and makes no visibility call when handle settles", async () => {
		const { run, logged, visibilityChanges } = setupRetrying({
			failure: { message: "record failed" },
			malformed: { policy: "retry" },
			handle: async () => ({ kind: "settled" }),
		});

		const result = await run([buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }) })]);

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(visibilityChanges, []);
		assert.deepEqual(logged, []);
	});

	it("logs an error and still fails the record when the visibility change rejects", async () => {
		const error = new Error("sqs unavailable");
		const { run, logged } = setupRetrying({
			failure: { message: "record failed" },
			malformed: { policy: "retry" },
			handle: retryLater,
			changeVisibility: async () => {
				throw error;
			},
		});

		const result = await run([buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }) })]);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(logged, [{ message: "visibility change failed", details: { messageId: "m-1", error } }]);
	});

	it("reports the record through the failure message when handle asks to retry past the schedule", async () => {
		const { run, logged, visibilityChanges } = setupRetrying({
			failure: { message: "record failed" },
			malformed: { policy: "retry" },
			handle: retryLater,
		});

		const result = await run([buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }), receiveCount: "3" })]);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(visibilityChanges, []);
		assert.equal(logged.length, 1);
		assert.equal(logged[0]?.message, "record failed");
	});

	it("passes the receipt handle only to the visibility port, never to the logger or to handle", async () => {
		const { run, logged, handled, visibilityChanges } = setupRetrying({
			failure: { message: "record failed" },
			malformed: { policy: "retry", message: "malformed record" },
			handle: retryLater,
			changeVisibility: async () => {
				throw new Error("sqs unavailable");
			},
		});

		await run([
			buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }) }),
			buildRecord({ messageId: "m-2", body: "{not json" }),
		]);

		assert.deepEqual(
			visibilityChanges.map(({ receiptHandle }) => receiptHandle),
			["receipt-m-1"],
		);
		assert.deepEqual(handled, [
			{ detail: { userId: UserIdSchema.parse("alice") }, record: { messageId: "m-1", receiveCount: 1, body: envelope({ userId: "alice" }) } },
		]);
		const loggedText = logged.map((entry) => `${entry.message} ${JSON.stringify(entry.details)}`).join("\n");
		assert.equal(loggedText.includes("receipt-m-1"), false);
		assert.equal(loggedText.includes("receipt-m-2"), false);
	});

	it("logs the failure message and retries the record whose handle throws", async () => {
		const error = new Error("boom");
		const { run, logged, visibilityChanges } = setupRetrying({
			failure: { message: "record failed" },
			malformed: { policy: "retry" },
			handle: async () => {
				throw error;
			},
		});

		const result = await run([buildRecord({ messageId: "m-1", body: envelope({ userId: "alice" }) })]);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(logged, [{ message: "record failed", details: { messageId: "m-1", error } }]);
		assert.deepEqual(visibilityChanges, []);
	});

	describe.each(malformedBodies)("a malformed record: $name", ({ body }) => {
		it("logs its own message and retries under a retry policy with a message", async () => {
			const { run, logged, handled } = setupRetrying({
				failure: { message: "record failed" },
				malformed: { policy: "retry", message: "malformed record" },
				handle: retryLater,
			});

			const result = await run([buildRecord({ messageId: "m-1", body })]);

			assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-1" }] });
			assert.equal(logged[0]?.message, "malformed record");
			assert.deepEqual(handled, []);
		});

		it("acknowledges under an acknowledge policy", async () => {
			const { run, handled } = setupRetrying({
				failure: { message: "record failed" },
				malformed: { policy: "acknowledge", message: "malformed record" },
				handle: retryLater,
			});

			const result = await run([buildRecord({ messageId: "m-1", body })]);

			assert.deepEqual(result, { batchItemFailures: [] });
			assert.deepEqual(handled, []);
		});
	});
});
