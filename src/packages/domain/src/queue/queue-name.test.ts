import assert from "node:assert/strict";
import {
	DEFAULT_QUEUE_SLUG,
	QUEUE_LABEL_MAX_LENGTH,
	QUEUE_MAX_PER_USER,
	QueueLimitReachedError,
	parseQueueLabel,
} from "./queue-name.schema";

describe("parseQueueLabel", () => {
	it("keeps the name as typed", () => {
		assert.equal(parseQueueLabel("Work Reading"), "Work Reading");
	});

	it("trims the name the reader typed", () => {
		assert.equal(parseQueueLabel("  Deep Work  "), "Deep Work");
	});

	it("accepts a name at the visible-width cap", () => {
		const label = "a".repeat(QUEUE_LABEL_MAX_LENGTH);
		assert.equal(parseQueueLabel(label), label);
	});

	it("rejects a name past the cap rather than truncating it to one the reader never typed", () => {
		assert.equal(parseQueueLabel("a".repeat(QUEUE_LABEL_MAX_LENGTH + 1)), undefined);
	});

	it("rejects a name with no characters in it", () => {
		assert.equal(parseQueueLabel(""), undefined);
		assert.equal(parseQueueLabel("   "), undefined);
	});

	it("takes a name made only of emoji, which the queue's own id addresses", () => {
		assert.equal(parseQueueLabel("🎉🎉"), "🎉🎉");
	});
});

describe("DEFAULT_QUEUE_SLUG", () => {
	it("is the slug every queue-less save and every unflagged view resolves to", () => {
		assert.equal(DEFAULT_QUEUE_SLUG, "default");
	});
});

describe("QueueLimitReachedError", () => {
	it("carries the cap it was raised against and names it in the message", () => {
		const error = new QueueLimitReachedError(QUEUE_MAX_PER_USER);
		assert.ok(error instanceof Error);
		assert.equal(error.name, "QueueLimitReachedError");
		assert.equal(error.limit, QUEUE_MAX_PER_USER);
		assert.match(error.message, new RegExp(String(QUEUE_MAX_PER_USER)));
	});
});
