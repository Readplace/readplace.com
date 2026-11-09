import assert from "node:assert/strict";
import { buildCommandMessage } from "./command-message";

const STANDARD_QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/123456789012/page-q";
const FIFO_QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/123456789012/generate-summary-fifo-q.fifo";
const DETAIL = { url: "https://example.com/a" };

describe("buildCommandMessage", () => {
	it("keeps the standard message shape: body and delay, no FIFO parameters", () => {
		const message = buildCommandMessage({
			queueUrl: STANDARD_QUEUE_URL,
			detail: DETAIL,
			delivery: { delaySeconds: 10 },
		});

		assert.deepEqual(message, {
			QueueUrl: STANDARD_QUEUE_URL,
			MessageBody: JSON.stringify({ detail: DETAIL }),
			DelaySeconds: 10,
		});
	});

	it("serialises an absent delay identically to omitting it", () => {
		const message = buildCommandMessage({ queueUrl: STANDARD_QUEUE_URL, detail: DETAIL, delivery: {} });

		assert.equal(
			JSON.stringify(message),
			JSON.stringify({ QueueUrl: STANDARD_QUEUE_URL, MessageBody: JSON.stringify({ detail: DETAIL }) }),
		);
	});

	it("groups a FIFO message by the caller's group key and carries no delay", () => {
		const message = buildCommandMessage({
			queueUrl: FIFO_QUEUE_URL,
			detail: DETAIL,
			delivery: { fifo: { messageGroupId: (detail) => `group:${detail.url}` } },
		});

		assert.equal(message.MessageGroupId, "group:https://example.com/a");
		assert.equal(message.DelaySeconds, undefined);
		assert.equal(message.MessageBody, JSON.stringify({ detail: DETAIL }));
	});

	it("gives two dispatches of an identical body different deduplication IDs, so the later one is not dropped", () => {
		const delivery = { fifo: { messageGroupId: () => "group" } };
		const first = buildCommandMessage({ queueUrl: FIFO_QUEUE_URL, detail: DETAIL, delivery });
		const second = buildCommandMessage({ queueUrl: FIFO_QUEUE_URL, detail: DETAIL, delivery });

		assert.ok(first.MessageDeduplicationId);
		assert.notEqual(first.MessageDeduplicationId, second.MessageDeduplicationId);
		assert.equal(first.MessageBody, second.MessageBody);
	});

	it("takes the caller's deduplication key when one is given, so a redelivered forward of the same work is dropped", () => {
		const delivery = { fifo: { messageGroupId: () => "group", deduplicationId: (detail: { url: string }) => `work:${detail.url}` } };
		const first = buildCommandMessage({ queueUrl: FIFO_QUEUE_URL, detail: DETAIL, delivery });
		const second = buildCommandMessage({ queueUrl: FIFO_QUEUE_URL, detail: DETAIL, delivery });

		assert.equal(first.MessageDeduplicationId, "work:https://example.com/a");
		assert.equal(second.MessageDeduplicationId, first.MessageDeduplicationId);
	});
});
