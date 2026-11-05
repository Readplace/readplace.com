import assert from "node:assert/strict";
import { resolveEmailFanOut } from "./email-fan-out";

describe("resolveEmailFanOut", () => {
	it("saves the links of mail sent to an inbox address routed to All", () => {
		assert.deepEqual(
			resolveEmailFanOut({ routing: { kind: "inbox" }, inboxReadlist: undefined }),
			{ links: true, issue: false },
		);
	});

	it("saves the email itself when the routed readlist chose it", () => {
		assert.deepEqual(
			resolveEmailFanOut({ routing: { kind: "inbox" }, inboxReadlist: { emailDelivery: "issue" } }),
			{ links: false, issue: true },
		);
	});

	it("saves the email and its links when the routed readlist chose both", () => {
		assert.deepEqual(
			resolveEmailFanOut({ routing: { kind: "inbox" }, inboxReadlist: { emailDelivery: "both" } }),
			{ links: true, issue: true },
		);
	});

	it("saves what the reader chose for a Gmail newsletter, whatever the readlist chose", () => {
		assert.deepEqual(
			resolveEmailFanOut({
				routing: { kind: "gmail", destinationAddresses: ["work-abc123@read.place"], deliveryMode: "issue" },
				inboxReadlist: { emailDelivery: "links" },
			}),
			{ links: false, issue: true },
		);
	});
});
