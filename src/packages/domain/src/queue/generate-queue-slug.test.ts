import assert from "node:assert/strict";
import { generateQueueSlug } from "./generate-queue-slug";
import { QUEUE_LABEL_MAX_LENGTH, QueueSlugSchema } from "./queue-name.schema";

describe("generateQueueSlug", () => {
	it("addresses a queue by an opaque id, never by what it is called", () => {
		const slug = generateQueueSlug();

		assert.equal(QueueSlugSchema.parse(slug), slug);
		assert.ok(slug.length <= QUEUE_LABEL_MAX_LENGTH);
	});

	it("gives every queue its own id, which is how a queue is addressed", () => {
		const slugs = new Set(Array.from({ length: 50 }, () => generateQueueSlug()));

		assert.equal(slugs.size, 50);
	});
});
