import assert from "node:assert/strict";
import { defaultQueueLabel } from "./default-queue-label";

describe("defaultQueueLabel", () => {
	it("names the first queue New Queue", () => {
		assert.equal(defaultQueueLabel(["My Queue"]), "New Queue");
	});

	it("counts past the default names already in use", () => {
		assert.equal(
			defaultQueueLabel(["My Queue", "New Queue", "New Queue 2"]),
			"New Queue 3",
		);
	});

	it("reuses a gap left by a renamed queue", () => {
		assert.equal(defaultQueueLabel(["My Queue", "New Queue", "New Queue 3"]), "New Queue 2");
	});

	it("counts past a default name however the reader recased it", () => {
		assert.equal(defaultQueueLabel(["My Queue", "new queue"]), "New Queue 2");
	});

	it("ignores names the reader chose themselves", () => {
		assert.equal(defaultQueueLabel(["My Queue", "Work Reading", "Deep Work"]), "New Queue");
	});
})
