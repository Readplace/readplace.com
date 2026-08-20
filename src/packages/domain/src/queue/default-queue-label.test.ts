import assert from "node:assert/strict";
import { defaultQueueLabel } from "./default-queue-label";

describe("defaultQueueLabel", () => {
	it("names the first queue New Queue 1", () => {
		assert.equal(defaultQueueLabel(["My Queue"]), "New Queue 1");
	});

	it("counts past the default names already in use", () => {
		assert.equal(
			defaultQueueLabel(["My Queue", "New Queue 1", "New Queue 2"]),
			"New Queue 3",
		);
	});

	it("reuses a gap left by a renamed queue", () => {
		assert.equal(defaultQueueLabel(["My Queue", "New Queue 1", "New Queue 3"]), "New Queue 2");
	});

	it("ignores names the reader chose themselves", () => {
		assert.equal(defaultQueueLabel(["My Queue", "Work Reading", "Deep Work"]), "New Queue 1");
	});
})
