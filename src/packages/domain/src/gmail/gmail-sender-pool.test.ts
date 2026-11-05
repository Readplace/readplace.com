import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";
import type { DiscoveredGmailSender } from "./gmail-discovery.types";
import { gmailSenderPool } from "./gmail-sender-pool";

function sender(email: string, name?: string): DiscoveredGmailSender {
	return { email: ForwardableSenderSchema.parse(email), name };
}

const IN_FILTER = "2026-11-01T00:00:00.000Z";

describe("gmailSenderPool", () => {
	it("lists senders seen arriving before senders a scan found, once each", () => {
		const pool = gmailSenderPool({
			observed: [sender("weekly@news.example", "Seen"), sender("daily@news.example")],
			discovered: [sender("weekly@news.example", "Scanned"), sender("monthly@news.example")],
			sameMailbox: true,
			mappings: [],
		});

		assert.deepEqual(pool.senders, [
			sender("weekly@news.example", "Scanned"),
			sender("daily@news.example"),
			sender("monthly@news.example"),
		]);
		assert.deepEqual([...pool.known], ["weekly@news.example", "daily@news.example", "monthly@news.example"]);
	});

	it("leaves out senders a scan of another mailbox found", () => {
		const pool = gmailSenderPool({
			observed: [sender("daily@news.example")],
			discovered: [sender("monthly@news.example")],
			sameMailbox: false,
			mappings: [],
		});

		assert.deepEqual(pool.senders, [sender("daily@news.example")]);
		assert.equal(pool.known.has(ForwardableSenderSchema.parse("monthly@news.example")), false);
	});

	it("knows a sender already in the filter though nothing lists it", () => {
		const pool = gmailSenderPool({
			observed: [],
			discovered: [],
			sameMailbox: true,
			mappings: [{ senderEmail: ForwardableSenderSchema.parse("filtered@news.example"), addedToFilterAt: IN_FILTER }],
		});

		assert.deepEqual(pool.senders, []);
		assert.deepEqual([...pool.known], ["filtered@news.example"]);
	});

	it("does not know a mapped sender that never reached the filter", () => {
		const pool = gmailSenderPool({
			observed: [],
			discovered: [],
			sameMailbox: true,
			mappings: [{ senderEmail: ForwardableSenderSchema.parse("pending@news.example"), addedToFilterAt: undefined }],
		});

		assert.equal(pool.known.size, 0);
	});
});
