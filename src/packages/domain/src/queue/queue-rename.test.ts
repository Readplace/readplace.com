import assert from "node:assert/strict";
import { QUEUE_LABEL_MAX_LENGTH, QueueSlugSchema } from "./queue-name.schema";
import { decideQueueRename } from "./queue-rename";

const slug = (value: string) => QueueSlugSchema.parse(value);
const ownedSlugs = ["a1b2c3d4", "e5f6a7b8"].map(slug);

describe("decideQueueRename", () => {
	it("keeps the queue's own id and takes the trimmed name", () => {
		assert.deepEqual(
			decideQueueRename({ slug: slug("a1b2c3d4"), label: "  Deep Work  ", ownedSlugs }),
			{ ok: true, slug: "a1b2c3d4", label: "Deep Work" },
		);
	});

	it("lets two queues carry the same name, because the id tells them apart", () => {
		assert.deepEqual(
			decideQueueRename({ slug: slug("a1b2c3d4"), label: "Work", ownedSlugs }),
			{ ok: true, slug: "a1b2c3d4", label: "Work" },
		);
		assert.deepEqual(
			decideQueueRename({ slug: slug("e5f6a7b8"), label: "Work", ownedSlugs }),
			{ ok: true, slug: "e5f6a7b8", label: "Work" },
		);
	});

	it("refuses a name too long to render in full", () => {
		assert.deepEqual(
			decideQueueRename({
				slug: slug("a1b2c3d4"),
				label: "a".repeat(QUEUE_LABEL_MAX_LENGTH + 1),
				ownedSlugs,
			}),
			{ ok: false, reason: "invalid-name" },
		);
	});

	it("refuses a name emptied of everything but spaces", () => {
		assert.deepEqual(
			decideQueueRename({ slug: slug("a1b2c3d4"), label: "   ", ownedSlugs }),
			{ ok: false, reason: "invalid-name" },
		);
	});

	it("refuses to rename the built-in queue, which has no stored name to change", () => {
		assert.deepEqual(
			decideQueueRename({ slug: slug("default"), label: "Everything", ownedSlugs }),
			{ ok: false, reason: "unknown-queue" },
		);
	});

	it("refuses a queue the reader does not have", () => {
		assert.deepEqual(
			decideQueueRename({ slug: slug("ffffffff"), label: "Mine", ownedSlugs }),
			{ ok: false, reason: "unknown-queue" },
		);
	});
});
