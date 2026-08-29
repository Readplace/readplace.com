import assert from "node:assert/strict";
import { nextAvailableReadlistLabel } from "./next-available-readlist-label";

describe("nextAvailableReadlistLabel", () => {
	it("keeps the name the reader typed when no other readlist carries it", () => {
		assert.equal(
			nextAvailableReadlistLabel({ label: "Work", takenLabels: ["Weekend Reads", "Deep Work"] }),
			"Work",
		);
	});

	it("numbers a name another readlist already carries, starting at 2", () => {
		assert.equal(nextAvailableReadlistLabel({ label: "Work", takenLabels: ["Work"] }), "Work 2");
	});

	it("counts past every number already in use", () => {
		assert.equal(
			nextAvailableReadlistLabel({ label: "Work", takenLabels: ["Work", "Work 2"] }),
			"Work 3",
		);
	});

	it("reuses a gap left by a renamed readlist", () => {
		assert.equal(
			nextAvailableReadlistLabel({ label: "Work", takenLabels: ["Work", "Work 3"] }),
			"Work 2",
		);
	});

	it("leaves an unclaimed name alone even when a numbered cousin exists", () => {
		assert.equal(nextAvailableReadlistLabel({ label: "Work", takenLabels: ["Work 2"] }), "Work");
	});

	it("matches a name whatever it was capitalised as, and keeps the casing the reader typed", () => {
		assert.equal(nextAvailableReadlistLabel({ label: "work", takenLabels: ["Work"] }), "work 2");
		assert.equal(
			nextAvailableReadlistLabel({ label: "work", takenLabels: ["WORK", "Work 2"] }),
			"work 3",
		);
	});

	it("treats a name that already ends in a number as the whole name", () => {
		assert.equal(nextAvailableReadlistLabel({ label: "Work 2", takenLabels: ["Work 2"] }), "Work 2 2");
	});
});
