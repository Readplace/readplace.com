import assert from "node:assert/strict";
import {
	classifyResponse,
	normalizeHostname,
	ROUTING_POLICY_VERSION,
	routingPolicyFor,
	TEN_SECOND_SPACING_HOSTS,
} from "./routing-policy";

describe("normalizeHostname", () => {
	it("lowercases, trims and drops a trailing root dot", () => {
		assert.equal(normalizeHostname(" WWW.CoinDesk.com. "), "www.coindesk.com");
	});

	it("refuses a value that is not a hostname", () => {
		assert.throws(() => normalizeHostname("example.com/path"));
	});
});

describe("routingPolicyFor", () => {
	it("gives every listed 429 host ten-second start spacing with its evidence and review date", () => {
		assert.equal(TEN_SECOND_SPACING_HOSTS.length, 22);
		for (const listed of TEN_SECOND_SPACING_HOSTS) {
			const policy = routingPolicyFor(normalizeHostname(listed));
			assert.equal(policy.source, "override");
			assert.equal(policy.startSpacingMs, 10_000);
			assert.equal(policy.policyVersion, ROUTING_POLICY_VERSION);
			assert.deepEqual(policy.routeOrder, ["direct", "paid-fetch", "paid-browser"]);
			assert.match(policy.evidence, /429/);
			assert.equal(policy.reviewBy, "2027-02-08");
		}
	});

	it("falls back to the explicit two-second default for an unlisted host", () => {
		const policy = routingPolicyFor(normalizeHostname("www.telegraph.co.uk"));
		assert.equal(policy.source, "default");
		assert.equal(policy.startSpacingMs, 2_000);
		assert.equal(policy.host, "www.telegraph.co.uk");
		assert.deepEqual(policy.routeOrder, ["direct", "paid-fetch", "paid-browser"]);
	});

	it("matches hosts exactly and never by suffix", () => {
		assert.equal(routingPolicyFor(normalizeHostname("mirror.archive.ph")).source, "default");
		assert.equal(routingPolicyFor(normalizeHostname("coindesk.com")).source, "default");
	});
});

describe("classifyResponse", () => {
	const host = (value: string) => normalizeHostname(value);

	it("treats a 429 from any host as terminal for the ladder with a cooldown", () => {
		const classification = classifyResponse({ host: host("example.com"), status: 429 });
		assert.equal(classification.kind, "rate-limited");
		assert.ok(classification.kind === "rate-limited" && classification.stopsLadder);
		assert.ok(classification.recordsCooldown);
		assert.equal(classification.alternateEgress, false);
	});

	it("treats a 401 as authentication with no retry or paid promotion", () => {
		const classification = classifyResponse({ host: host("www.reuters.com"), status: 401 });
		assert.equal(classification.kind, "authentication");
		assert.ok(classification.kind === "authentication");
		assert.equal(classification.sameRouteRetry, false);
		assert.equal(classification.paidPromotion, false);
	});

	it.each([
		["www.linkedin.com", 999],
		["www.linkedin.com", 403],
		["br.linkedin.com", 999],
		["br.linkedin.com", 403],
		["archiveofourown.org", 418],
	])("classifies %s answering %d as a publisher restriction", (restricted, status) => {
		const classification = classifyResponse({ host: host(restricted), status });
		assert.equal(classification.kind, "publisher-restriction");
		assert.ok(classification.kind === "publisher-restriction");
		assert.equal(classification.sameRouteRetry, false);
		assert.equal(classification.paidPromotion, false);
	});

	it("classifies the sendibm 451 as terminal with no alternate egress", () => {
		const classification = classifyResponse({ host: host("4yrke.r.a.d.sendibm1.com"), status: 451 });
		assert.equal(classification.kind, "terminal-restriction");
		assert.ok(classification.kind === "terminal-restriction");
		assert.equal(classification.alternateEgress, false);
	});

	it.each([
		["www.linkedin.com", 418],
		["archiveofourown.org", 403],
		["example.com", 999],
		["example.com", 451],
	])("leaves %s answering %d unclassified", (other, status) => {
		assert.deepEqual(classifyResponse({ host: host(other), status }), { kind: "unclassified" });
	});
});
