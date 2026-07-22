import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	PERMANENT_ARTICLE_DOMAINS,
	PERMANENT_REFERRER_DOMAINS,
	PUBLIC_VIEW_ACCESS_WINDOW_MS,
	PUBLIC_VIEW_PAYWALL_READ_MINUTES_THRESHOLD,
	computePublicViewExpiry,
	formatSaveUtmContent,
	isPermanentReferrer,
	sharedUserIdFrom,
	sharedUserIdFromQueryParams,
} from "./view-expiry";

describe("sharedUserIdFrom", () => {
	it("returns the first 6 chars of the user id, lowercased", () => {
		const userId = UserIdSchema.parse("abc123deadbeef1234567890abcdef01");
		const prefix = sharedUserIdFrom(userId);
		assert.equal(prefix, "abc123");
		assert.equal(prefix.length, 6);
	});

	it("normalises uppercase hex to lowercase", () => {
		const userId = UserIdSchema.parse("ABCDEF1234567890abcdef0123456789");
		const prefix = sharedUserIdFrom(userId);
		assert.equal(prefix, "abcdef");
	});
});

describe("sharedUserIdFromQueryParams", () => {
	it("returns SharedUserId when utm_content is exactly 6 hex chars", () => {
		const result = sharedUserIdFromQueryParams("abc123");
		assert(result !== null);
		assert.equal(result, "abc123");
	});

	it("returns null when utm_content has 6 hex chars followed by more characters", () => {
		const result = sharedUserIdFromQueryParams("abc123-share");
		assert.equal(result, null);
	});

	it("normalises uppercase hex in utm_content", () => {
		const result = sharedUserIdFromQueryParams("ABCDEF");
		assert(result !== null);
		assert.equal(result, "abcdef");
	});

	it("returns null for non-hex values like 'paste-another-link'", () => {
		assert.equal(sharedUserIdFromQueryParams("paste-another-link"), null);
	});

	it("returns null when fewer than 6 hex chars are present", () => {
		assert.equal(sharedUserIdFromQueryParams("abcde"), null);
	});

	it("returns null when utm_content is undefined", () => {
		assert.equal(sharedUserIdFromQueryParams(undefined), null);
	});
});

describe("computePublicViewExpiry", () => {
	const savedAt = new Date("2026-05-01T00:00:00.000Z");
	// A read time comfortably past the threshold, so the expiry window engages
	// for these cases and only the property under test decides the outcome.
	const longRead = MinutesSchema.parse(PUBLIC_VIEW_PAYWALL_READ_MINUTES_THRESHOLD + 5);

	it("returns savedAt + 3 days for organic visits", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
			isPermanentReferrer: false,
			estimatedReadTime: longRead,
		});
		assert(result.expiresAt, "expiresAt must be set for organic visits");
		assert.equal(result.expiresAt.toISOString(), "2026-05-04T00:00:00.000Z");
		assert.equal(result.expiresAt.getTime() - savedAt.getTime(), PUBLIC_VIEW_ACCESS_WINDOW_MS);
	});

	it("returns null when article domain matches a permanent domain", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "fagnerbrack.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
			isPermanentReferrer: false,
			estimatedReadTime: longRead,
		});
		assert.equal(result.expiresAt, null);
	});

	it("returns null when isValidSharer is true", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: true,
			isPermanentReferrer: false,
			estimatedReadTime: longRead,
		});
		assert.equal(result.expiresAt, null);
	});

	it("applies the standard expiry when isValidSharer is false and domain is not permanent", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
			isPermanentReferrer: false,
			estimatedReadTime: longRead,
		});
		assert(result.expiresAt, "expiresAt must be set for non-sharer, non-permanent visits");
		assert.equal(result.expiresAt.toISOString(), "2026-05-04T00:00:00.000Z");
	});

	it("returns null when article domain matches any of multiple permanent domains", () => {
		const multiDomains = ["first.com", "second.com", "third.com"];
		for (const domain of multiDomains) {
			const result = computePublicViewExpiry({
				savedAt,
				articleDomain: domain,
				permanentArticleDomains: multiDomains,
				isValidSharer: false,
				isPermanentReferrer: false,
				estimatedReadTime: longRead,
			});
			assert.equal(result.expiresAt, null, `expected permanent for ${domain}`);
		}
	});

	it("applies the standard expiry when article domain is not in a multi-domain permanent list", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "unknown.com",
			permanentArticleDomains: ["first.com", "second.com", "third.com"],
			isValidSharer: false,
			isPermanentReferrer: false,
			estimatedReadTime: longRead,
		});
		assert(result.expiresAt, "expiresAt must be set for non-permanent domain");
		assert.equal(result.expiresAt.toISOString(), "2026-05-04T00:00:00.000Z");
	});

	it("returns null for a short read even when the domain is not permanent and there is no sharer", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
			isPermanentReferrer: false,
			estimatedReadTime: MinutesSchema.parse(2),
		});
		assert.equal(result.expiresAt, null);
	});

	it("keeps a read exactly at the threshold permanently public", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
			isPermanentReferrer: false,
			estimatedReadTime: MinutesSchema.parse(PUBLIC_VIEW_PAYWALL_READ_MINUTES_THRESHOLD),
		});
		assert.equal(result.expiresAt, null);
	});

	it("applies the expiry one minute past the threshold", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
			isPermanentReferrer: false,
			estimatedReadTime: MinutesSchema.parse(PUBLIC_VIEW_PAYWALL_READ_MINUTES_THRESHOLD + 1),
		});
		assert(result.expiresAt, "a read past the threshold must carry an expiry");
		assert.equal(result.expiresAt.toISOString(), "2026-05-04T00:00:00.000Z");
	});

	it("returns null when the referrer is a founder-blog host, even for a long read on a non-permanent domain", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
			isPermanentReferrer: true,
			estimatedReadTime: longRead,
		});
		assert.equal(result.expiresAt, null);
	});
});

describe("isPermanentReferrer", () => {
	it("returns true when the referrer host is a founder-blog domain", () => {
		assert.equal(
			isPermanentReferrer({
				referrer: "https://fagnerbrack.com/what-is-docker",
				permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
			}),
			true,
		);
	});

	it("matches a subdomain of a founder-blog domain", () => {
		assert.equal(
			isPermanentReferrer({
				referrer: "https://www.fagnerbrack.com/",
				permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
			}),
			true,
		);
	});

	it("matches when the browser sends only the origin (referrer policy stripped the path)", () => {
		assert.equal(
			isPermanentReferrer({
				referrer: "https://fagnerbrack.com",
				permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
			}),
			true,
		);
	});

	it("is case-insensitive on the host", () => {
		assert.equal(
			isPermanentReferrer({
				referrer: "https://Fagnerbrack.COM/post",
				permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
			}),
			true,
		);
	});

	it("returns false for a lookalike suffix that is not a subdomain", () => {
		assert.equal(
			isPermanentReferrer({
				referrer: "https://notfagnerbrack.com/post",
				permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
			}),
			false,
		);
	});

	it("does not match bare medium.com — the bypass is the founder's readers, not all of Medium", () => {
		assert.equal(
			isPermanentReferrer({
				referrer: "https://medium.com/@fagnerbrack/what-is-docker",
				permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
			}),
			false,
		);
	});

	it("returns false when there is no referrer", () => {
		assert.equal(
			isPermanentReferrer({
				referrer: undefined,
				permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
			}),
			false,
		);
	});

	it("returns false for an unparseable referrer", () => {
		assert.equal(
			isPermanentReferrer({
				referrer: "not a url",
				permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
			}),
			false,
		);
	});
});

describe("formatSaveUtmContent", () => {
	it("renders '2d_4h_left' at day/hour resolution only", () => {
		assert.equal(
			formatSaveUtmContent({ days: 2, hours: 4, minutes: 30, seconds: 15 }),
			"2d_4h_left",
		);
	});
});
