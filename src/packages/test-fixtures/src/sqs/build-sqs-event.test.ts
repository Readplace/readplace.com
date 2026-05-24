import assert from "node:assert/strict";
import { buildSqsEvent } from "./build-sqs-event";

describe("buildSqsEvent", () => {
	it("wraps records into an SQS-shaped event", () => {
		const event = buildSqsEvent([{ messageId: "msg-1", body: '{"key":"val"}' }]);

		assert.equal(event.Records.length, 1);
		assert.equal(event.Records[0].messageId, "msg-1");
		assert.equal(event.Records[0].body, '{"key":"val"}');
		assert.equal(event.Records[0].eventSource, "aws:sqs");
	});
});
