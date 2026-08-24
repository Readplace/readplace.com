import assert from "node:assert/strict";
import { decideQueueDelete } from "./queue-delete";
import { DEFAULT_QUEUE_SLUG, QueueSlugSchema } from "./queue-name.schema";

const slug = (value: string) => QueueSlugSchema.parse(value);
const queues = [
	{ slug: DEFAULT_QUEUE_SLUG, label: "My Queue" },
	{ slug: slug("a1b2c3d4"), label: "Work" },
];

describe("decideQueueDelete", () => {
	it("takes a queue the reader owns", () => {
		assert.deepEqual(decideQueueDelete({ slug: slug("a1b2c3d4"), queues }), {
			ok: true,
			slug: "a1b2c3d4",
		});
	});

	it("refuses the queue every reader is given, which holds no row to delete", () => {
		assert.deepEqual(decideQueueDelete({ slug: DEFAULT_QUEUE_SLUG, queues }), {
			ok: false,
			reason: "unknown-queue",
		});
	});

	it("refuses a queue the reader does not own", () => {
		assert.deepEqual(decideQueueDelete({ slug: slug("ffffffff"), queues }), {
			ok: false,
			reason: "unknown-queue",
		});
	});
});
