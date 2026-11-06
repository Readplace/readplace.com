import assert from "node:assert/strict";
import { resolveEmailFanOut } from "./email-fan-out";

describe("resolveEmailFanOut", () => {
	it("saves only the links of mail sent to a custom email", () => {
		assert.deepEqual(resolveEmailFanOut({ routing: { kind: "inbox" } }), { links: true, issue: false });
	});

	it("saves what the reader chose for a Gmail newsletter", () => {
		assert.deepEqual(
			resolveEmailFanOut({
				routing: { kind: "gmail", destinationAddresses: ["work-abc123@read.place"], deliveryMode: "issue" },
			}),
			{ links: false, issue: true },
		);
	});
});
