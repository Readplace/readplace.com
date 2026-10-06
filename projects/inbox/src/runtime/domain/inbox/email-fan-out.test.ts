import assert from "node:assert/strict";
import { resolveEmailFanOut } from "./email-fan-out";

describe("resolveEmailFanOut", () => {
	it("saves the links of mail sent straight to an inbox address", () => {
		assert.deepEqual(resolveEmailFanOut({ kind: "inbox" }), { links: true, issue: false });
	});

	it("saves what the reader chose for a Gmail newsletter", () => {
		assert.deepEqual(
			resolveEmailFanOut({ kind: "gmail", destinationAddresses: ["work-abc123@read.place"], deliveryMode: "issue" }),
			{ links: false, issue: true },
		);
	});
});
