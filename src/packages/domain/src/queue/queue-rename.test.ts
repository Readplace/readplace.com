import assert from "node:assert/strict";
import { DEFAULT_QUEUE_SLUG, QUEUE_LABEL_MAX_LENGTH, QueueSlugSchema } from "./queue-name.schema";
import { decideQueueRename } from "./queue-rename";

const slug = (value: string) => QueueSlugSchema.parse(value);
const queues = [
	{ slug: DEFAULT_QUEUE_SLUG, label: "My Queue" },
	{ slug: slug("a1b2c3d4"), label: "Work" },
	{ slug: slug("e5f6a7b8"), label: "Deep Work" },
];

describe("decideQueueRename", () => {
	it("keeps the queue's own id and takes the trimmed name", () => {
		assert.deepEqual(
			decideQueueRename({ slug: slug("a1b2c3d4"), label: "  Weekend Reads  ", queues }),
			{ ok: true, slug: "a1b2c3d4", label: "Weekend Reads" },
		);
	});

	it("numbers a name another queue already carries", () => {
		assert.deepEqual(decideQueueRename({ slug: slug("e5f6a7b8"), label: "Work", queues }), {
			ok: true,
			slug: "e5f6a7b8",
			label: "Work 2",
		});
	});

	it("lets a queue keep the name it already carries, rather than numbering it against itself", () => {
		assert.deepEqual(decideQueueRename({ slug: slug("a1b2c3d4"), label: "Work", queues }), {
			ok: true,
			slug: "a1b2c3d4",
			label: "Work",
		});
	});

	it("lets a reader recase their own queue's name", () => {
		assert.deepEqual(decideQueueRename({ slug: slug("a1b2c3d4"), label: "WORK", queues }), {
			ok: true,
			slug: "a1b2c3d4",
			label: "WORK",
		});
	});

	it("matches a taken name whatever it was capitalised as, and keeps the casing the reader typed", () => {
		assert.deepEqual(decideQueueRename({ slug: slug("e5f6a7b8"), label: "work", queues }), {
			ok: true,
			slug: "e5f6a7b8",
			label: "work 2",
		});
	});

	it("numbers a name the built-in queue carries", () => {
		assert.deepEqual(decideQueueRename({ slug: slug("a1b2c3d4"), label: "My Queue", queues }), {
			ok: true,
			slug: "a1b2c3d4",
			label: "My Queue 2",
		});
	});

	it("refuses a name with no room left for the number that tells it apart", () => {
		const longest = "a".repeat(QUEUE_LABEL_MAX_LENGTH);

		assert.deepEqual(
			decideQueueRename({
				slug: slug("a1b2c3d4"),
				label: longest,
				queues: [...queues, { slug: slug("ccccdddd"), label: longest }],
			}),
			{ ok: false, reason: "name-taken" },
		);
	});

	it("refuses a name too long to render in full", () => {
		assert.deepEqual(
			decideQueueRename({
				slug: slug("a1b2c3d4"),
				label: "a".repeat(QUEUE_LABEL_MAX_LENGTH + 1),
				queues,
			}),
			{ ok: false, reason: "invalid-name" },
		);
	});

	it("refuses a name emptied of everything but spaces", () => {
		assert.deepEqual(decideQueueRename({ slug: slug("a1b2c3d4"), label: "   ", queues }), {
			ok: false,
			reason: "invalid-name",
		});
	});

	it("refuses to rename the built-in queue, which has no stored name to change", () => {
		assert.deepEqual(decideQueueRename({ slug: slug("default"), label: "Everything", queues }), {
			ok: false,
			reason: "unknown-queue",
		});
	});

	it("refuses a queue the reader does not have", () => {
		assert.deepEqual(decideQueueRename({ slug: slug("ffffffff"), label: "Mine", queues }), {
			ok: false,
			reason: "unknown-queue",
		});
	});
});
