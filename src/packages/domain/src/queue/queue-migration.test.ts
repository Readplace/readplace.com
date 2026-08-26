import assert from "node:assert/strict";
import { decideQueueMigration } from "./queue-migration";
import { DEFAULT_QUEUE_SLUG, QueueSlugSchema } from "./queue-name.schema";

const slug = (value: string) => QueueSlugSchema.parse(value);
const queues = [
	{ slug: DEFAULT_QUEUE_SLUG, label: "My Queue" },
	{ slug: slug("a1b2c3d4"), label: "Work" },
	{ slug: slug("e5f6a7b8"), label: "Personal" },
];

describe("decideQueueMigration", () => {
	it("hands one queue's articles to another the reader owns", () => {
		assert.deepEqual(
			decideQueueMigration({ from: slug("a1b2c3d4"), to: slug("e5f6a7b8"), queues }),
			{ ok: true, from: "a1b2c3d4", to: "e5f6a7b8" },
		);
	});

	it("refuses the queue every reader is given as a destination, which already holds every article", () => {
		assert.deepEqual(
			decideQueueMigration({ from: slug("a1b2c3d4"), to: DEFAULT_QUEUE_SLUG, queues }),
			{ ok: false, reason: "unknown-queue" },
		);
	});

	it("refuses to empty the queue every reader is given", () => {
		assert.deepEqual(
			decideQueueMigration({ from: DEFAULT_QUEUE_SLUG, to: slug("a1b2c3d4"), queues }),
			{ ok: false, reason: "unknown-queue" },
		);
	});

	it("refuses a queue handing its articles to itself", () => {
		assert.deepEqual(
			decideQueueMigration({ from: slug("a1b2c3d4"), to: slug("a1b2c3d4"), queues }),
			{ ok: false, reason: "same-queue" },
		);
	});

	it("refuses a source the reader does not own", () => {
		assert.deepEqual(
			decideQueueMigration({ from: slug("ffffffff"), to: slug("a1b2c3d4"), queues }),
			{ ok: false, reason: "unknown-queue" },
		);
	});

	it("refuses a destination the reader does not own", () => {
		assert.deepEqual(
			decideQueueMigration({ from: slug("a1b2c3d4"), to: slug("ffffffff"), queues }),
			{ ok: false, reason: "unknown-queue" },
		);
	});
});
