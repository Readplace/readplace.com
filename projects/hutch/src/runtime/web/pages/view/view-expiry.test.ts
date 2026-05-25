import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import {
	PERMANENT_ARTICLE_DOMAINS,
	PUBLIC_VIEW_ACCESS_WINDOW_MS,
	computePublicViewExpiry,
	formatSaveUtmContent,
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

	it("returns savedAt + 3 days for organic visits", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
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
		});
		assert.equal(result.expiresAt, null);
	});

	it("returns null when isValidSharer is true", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: true,
		});
		assert.equal(result.expiresAt, null);
	});

	it("applies the standard expiry when isValidSharer is false and domain is not permanent", () => {
		const result = computePublicViewExpiry({
			savedAt,
			articleDomain: "example.com",
			permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
			isValidSharer: false,
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
		});
		assert(result.expiresAt, "expiresAt must be set for non-permanent domain");
		assert.equal(result.expiresAt.toISOString(), "2026-05-04T00:00:00.000Z");
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
