import assert from "node:assert/strict";
import { defaultReadlistLabel } from "./default-readlist-label";

describe("defaultReadlistLabel", () => {
	it("names the first readlist New Readlist", () => {
		assert.equal(defaultReadlistLabel(["Weekend Reads"]), "New Readlist");
	});

	it("counts past the default names already in use", () => {
		assert.equal(
			defaultReadlistLabel(["Weekend Reads", "New Readlist", "New Readlist 2"]),
			"New Readlist 3",
		);
	});

	it("reuses a gap left by a renamed readlist", () => {
		assert.equal(defaultReadlistLabel(["Weekend Reads", "New Readlist", "New Readlist 3"]), "New Readlist 2");
	});

	it("counts past a default name however the reader recased it", () => {
		assert.equal(defaultReadlistLabel(["Weekend Reads", "new readlist"]), "New Readlist 2");
	});

	it("ignores names the reader chose themselves", () => {
		assert.equal(defaultReadlistLabel(["Weekend Reads", "Work Reading", "Deep Work"]), "New Readlist");
	});
})
