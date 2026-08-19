import assert from "node:assert/strict";
import {
	DEFAULT_QUEUE_SLUG,
	QUEUE_LABEL_MAX_LENGTH,
	QUEUE_MAX_PER_USER,
	QueueLimitReachedError,
	QueueSlugSchema,
	parseQueueLabel,
} from "./queue-name.schema";

describe("parseQueueLabel", () => {
	it("keeps the label as typed and derives a lowercase-dashed slug", () => {
		assert.deepEqual(parseQueueLabel("Work Reading"), {
			label: "Work Reading",
			slug: "work-reading",
		});
	});

	it("trims the label before deriving the slug", () => {
		assert.deepEqual(parseQueueLabel("  Deep Work  "), {
			label: "Deep Work",
			slug: "deep-work",
		});
	});

	it("collapses runs of non-alphanumerics into a single hyphen and trims the edges", () => {
		assert.deepEqual(parseQueueLabel("Q&A   reads!!"), {
			label: "Q&A   reads!!",
			slug: "q-a-reads",
		});
		assert.deepEqual(parseQueueLabel("--weird__name--"), {
			label: "--weird__name--",
			slug: "weird-name",
		});
	});

	it("accepts a label at the visible-width cap", () => {
		const label = "a".repeat(QUEUE_LABEL_MAX_LENGTH);
		assert.deepEqual(parseQueueLabel(label), { label, slug: label });
	});

	it("rejects a label past the cap rather than truncating it to a name the reader never typed", () => {
		assert.equal(parseQueueLabel("a".repeat(QUEUE_LABEL_MAX_LENGTH + 1)), undefined);
	});

	it("rejects a label that carries no characters a slug can be built from", () => {
		assert.equal(parseQueueLabel(""), undefined);
		assert.equal(parseQueueLabel("   "), undefined);
		assert.equal(parseQueueLabel("🎉🎉"), undefined);
		assert.equal(parseQueueLabel("!!!"), undefined);
	});

	it("produces a slug the slug schema accepts", () => {
		const named = parseQueueLabel("Morning Reads");
		assert.ok(named);
		assert.equal(QueueSlugSchema.parse(named.slug), named.slug);
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
