import assert from "node:assert/strict";
import { nextAvailableQueueLabel } from "./next-available-queue-label";

describe("nextAvailableQueueLabel", () => {
	it("keeps the name the reader typed when no other queue carries it", () => {
		assert.equal(
			nextAvailableQueueLabel({ label: "Work", takenLabels: ["My Queue", "Deep Work"] }),
			"Work",
		);
	});

	it("numbers a name another queue already carries, starting at 2", () => {
		assert.equal(nextAvailableQueueLabel({ label: "Work", takenLabels: ["Work"] }), "Work 2");
	});

	it("counts past every number already in use", () => {
		assert.equal(
			nextAvailableQueueLabel({ label: "Work", takenLabels: ["Work", "Work 2"] }),
			"Work 3",
		);
	});

	it("reuses a gap left by a renamed queue", () => {
		assert.equal(
			nextAvailableQueueLabel({ label: "Work", takenLabels: ["Work", "Work 3"] }),
			"Work 2",
		);
	});

	it("leaves an unclaimed name alone even when a numbered cousin exists", () => {
		assert.equal(nextAvailableQueueLabel({ label: "Work", takenLabels: ["Work 2"] }), "Work");
	});

	it("matches a name whatever it was capitalised as, and keeps the casing the reader typed", () => {
		assert.equal(nextAvailableQueueLabel({ label: "work", takenLabels: ["Work"] }), "work 2");
		assert.equal(
			nextAvailableQueueLabel({ label: "work", takenLabels: ["WORK", "Work 2"] }),
			"work 3",
		);
	});

	it("treats a name that already ends in a number as the whole name", () => {
		assert.equal(nextAvailableQueueLabel({ label: "Work 2", takenLabels: ["Work 2"] }), "Work 2 2");
	});
});
