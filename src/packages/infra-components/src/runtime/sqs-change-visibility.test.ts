import assert from "node:assert/strict";
import { ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import { initSqsChangeVisibility } from "./sqs-change-visibility";

describe("initSqsChangeVisibility", () => {
	it("sends the receipt handle and timeout to the queue it was built for", async () => {
		const sent: ChangeMessageVisibilityCommand[] = [];
		const changeVisibility = initSqsChangeVisibility({
			client: {
				send: async (command) => {
					sent.push(command);
					return {};
				},
			},
			queueUrl: "https://sqs.ap-southeast-2.amazonaws.com/123456789/inbox-crawl-email-link-preview",
		});

		await changeVisibility({ receiptHandle: "receipt-1", visibilityTimeoutSeconds: 61 });

		assert.equal(sent.length, 1);
		assert.ok(sent[0] instanceof ChangeMessageVisibilityCommand);
		assert.deepEqual(sent[0].input, {
			QueueUrl: "https://sqs.ap-southeast-2.amazonaws.com/123456789/inbox-crawl-email-link-preview",
			ReceiptHandle: "receipt-1",
			VisibilityTimeout: 61,
		});
	});
});
