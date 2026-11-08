import assert from "node:assert/strict";
import { initGenerateSummaryDispatch, summaryMessageGroupId } from "./generate-summary-dispatch";

const QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/123456789012/generate-summary-fifo-q.fifo";

function capturingDispatch() {
	const send = jest.fn().mockResolvedValue({});
	const dispatch = initGenerateSummaryDispatch({ sqsClient: { send }, generateSummaryQueueUrl: QUEUE_URL });
	const sentInputs = () => send.mock.calls.map(([command]) => command.input);
	return { dispatch, sentInputs };
}

describe("summaryMessageGroupId", () => {
	it("is a fixed-length SHA-256 hex digest", () => {
		assert.match(summaryMessageGroupId({ url: "https://example.com/a" }), /^[0-9a-f]{64}$/);
	});

	it("gives URLs that normalise to the same article identity the same group", () => {
		assert.equal(
			summaryMessageGroupId({ url: "https://example.com/post?utm_source=newsletter" }),
			summaryMessageGroupId({ url: "http://example.com/post" }),
		);
	});

	it("gives different articles different groups", () => {
		assert.notEqual(
			summaryMessageGroupId({ url: "https://example.com/post-a" }),
			summaryMessageGroupId({ url: "https://example.com/post-b" }),
		);
	});
});

describe("initGenerateSummaryDispatch", () => {
	it("sends the GenerateSummaryCommand body to the summary queue grouped by article identity", async () => {
		const { dispatch, sentInputs } = capturingDispatch();

		await dispatch({ url: "https://example.com/post" });

		const [input] = sentInputs();
		assert.equal(input.QueueUrl, QUEUE_URL);
		assert.equal(input.MessageBody, JSON.stringify({ detail: { url: "https://example.com/post" } }));
		assert.equal(input.MessageGroupId, summaryMessageGroupId({ url: "https://example.com/post" }));
		assert.equal(input.DelaySeconds, undefined);
	});

	it("keeps a second identical-body request deliverable by giving each dispatch its own deduplication ID", async () => {
		const { dispatch, sentInputs } = capturingDispatch();

		await dispatch({ url: "https://example.com/post" });
		await dispatch({ url: "https://example.com/post" });

		const [first, second] = sentInputs();
		assert.equal(first.MessageBody, second.MessageBody);
		assert.equal(first.MessageGroupId, second.MessageGroupId);
		assert.notEqual(first.MessageDeduplicationId, second.MessageDeduplicationId);
	});

});
