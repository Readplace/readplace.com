import { noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubmitLinkDlqHandler } from "./submit-link-dlq-handler";

const POST_URL = "https://example.com/post";

function commandBody(detail: Record<string, unknown>): string {
	return JSON.stringify({ detail });
}

function createHandler(
	publishEvent = async () => {},
): {
	published: Array<{ detailType: string; detail: unknown }>;
	run: (bodies: string[]) => ReturnType<ReturnType<typeof initSubmitLinkDlqHandler>>;
} {
	const published: Array<{ detailType: string; detail: unknown }> = [];
	const handler = initSubmitLinkDlqHandler({
		publishEvent: async (event, detail) => {
			await publishEvent();
			published.push({ detailType: event.detailType, detail });
		},
		logger: noopLogger,
	});
	const run = (bodies: string[]) =>
		handler(
			buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))),
			buildLambdaContext(),
			() => {},
		);
	return { published, run };
}

describe("submitLinkDlqHandler", () => {
	it("publishes the save failure with the dead-lettered url and its receive count", async () => {
		const { published, run } = createHandler();

		const result = await run([commandBody({ url: POST_URL, userId: "user-1" })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toEqual([
			{
				detailType: "LinkQueueFailed",
				detail: {
					url: POST_URL,
					userId: "user-1",
					reason: "accept-retries-exhausted",
					receiveCount: 1,
				},
			},
		]);
	});

	it("publishes nothing for an anonymous command, which has no read model to correct", async () => {
		const { published, run } = createHandler();

		const result = await run([commandBody({ url: POST_URL })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toEqual([]);
	});

	it("fails a malformed record so its visibility is restored and the alarm can fire", async () => {
		const { published, run } = createHandler();

		const result = await run(["not json"]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(published).toEqual([]);
	});

	it("fails the record when publishing throws", async () => {
		const { run } = createHandler(async () => {
			throw new Error("event bus unavailable");
		});

		const result = await run([commandBody({ url: POST_URL, userId: "user-1" })]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});
