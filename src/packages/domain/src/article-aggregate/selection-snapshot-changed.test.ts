import assert from "node:assert/strict";
import { SelectionSnapshotChangedError } from "./selection-snapshot-changed";

describe("SelectionSnapshotChangedError", () => {
	it("names the conflict that refused the commit", () => {
		const error = new SelectionSnapshotChangedError("candidate-revoked");

		assert.ok(error instanceof Error);
		assert.equal(error.name, "SelectionSnapshotChangedError");
		assert.equal(error.conflict, "candidate-revoked");
		assert.match(error.message, /candidate-revoked/);
	});
});
