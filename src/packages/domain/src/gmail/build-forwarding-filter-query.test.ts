import assert from "node:assert/strict";
import {
	GMAIL_FILTER_QUERY_MAX_LENGTH,
	buildForwardingFilterQuery,
	parseForwardableSender,
} from "./build-forwarding-filter-query";

describe("buildForwardingFilterQuery", () => {
	it("refuses to build a query when every sender was rejected", () => {
		const result = buildForwardingFilterQuery({ senders: ["not an address"] });
		assert.deepEqual(result.query, { ok: false, reason: "no-senders" });
		assert.deepEqual(result.refused, ["not an address"]);
	});

	it("builds a single-sender query", () => {
		const result = buildForwardingFilterQuery({ senders: ["dan@tldr.tech"] });
		assert.deepEqual(result.query, {
			ok: true,
			query: "from:(dan@tldr.tech)",
			senders: ["dan@tldr.tech"],
		});
	});

	it("lower-cases, trims, and de-duplicates senders", () => {
		const result = buildForwardingFilterQuery({
			senders: ["  Dan@TLDR.tech ", "dan@tldr.tech"],
		});
		assert.deepEqual(result.query, {
			ok: true,
			query: "from:(dan@tldr.tech)",
			senders: ["dan@tldr.tech"],
		});
	});

	it("sorts senders so an unchanged set always produces a byte-identical query", () => {
		const forward = buildForwardingFilterQuery({
			senders: ["zoe@example.com", "amy@example.com"],
		});
		const reversed = buildForwardingFilterQuery({
			senders: ["amy@example.com", "zoe@example.com"],
		});
		assert.deepEqual(forward.query, reversed.query);
		assert.equal(
			forward.query.ok && forward.query.query,
			"from:(amy@example.com OR zoe@example.com)",
		);
	});

	it("refuses a sender whose local part begins with the Gmail negation operator", () => {
		const result = buildForwardingFilterQuery({ senders: ["-dan@tldr.tech"] });
		assert.deepEqual(result.query, { ok: false, reason: "no-senders" });
		assert.deepEqual(result.refused, ["-dan@tldr.tech"]);
	});

	it("keeps the valid senders and reports only the refused ones", () => {
		const result = buildForwardingFilterQuery({
			senders: ["dan@tldr.tech", 'quote"@example.com', "crew@morningbrew.com"],
		});
		assert.equal(
			result.query.ok && result.query.query,
			"from:(crew@morningbrew.com OR dan@tldr.tech)",
		);
		assert.deepEqual(result.refused, ['quote"@example.com']);
	});

	it("accepts a query that lands exactly on the length limit", () => {
		const senders = buildSendersForQueryLength(GMAIL_FILTER_QUERY_MAX_LENGTH);
		const result = buildForwardingFilterQuery({ senders });
		assert.equal(result.query.ok, true);
		assert.equal(result.query.ok && result.query.query.length, GMAIL_FILTER_QUERY_MAX_LENGTH);
	});

	it("refuses a query one character past the length limit", () => {
		const senders = buildSendersForQueryLength(GMAIL_FILTER_QUERY_MAX_LENGTH + 1);
		const result = buildForwardingFilterQuery({ senders });
		assert.equal(result.query.ok, false);
		assert.equal(
			result.query.ok === false && result.query.reason === "too-long" && result.query.length,
			GMAIL_FILTER_QUERY_MAX_LENGTH + 1,
		);
	});
});

describe("parseForwardableSender", () => {
	it("rejects an address with no top-level domain", () => {
		assert.equal(parseForwardableSender("dan@localhost"), undefined);
	});

	it("normalises surrounding whitespace and case into the branded sender", () => {
		assert.equal(parseForwardableSender(" Dan@TLDR.tech "), "dan@tldr.tech");
	});
});

const QUERY_WRAPPER_LENGTH = "from:()".length;
const SENDER_DOMAIN = "@example.com";

function buildSendersForQueryLength(targetLength: number): string[] {
	const localPartLength = targetLength - QUERY_WRAPPER_LENGTH - SENDER_DOMAIN.length;
	return [`${"a".repeat(localPartLength)}${SENDER_DOMAIN}`];
}
