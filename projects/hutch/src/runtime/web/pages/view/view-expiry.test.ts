import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import {
	PERMANENT_UTM_SOURCES,
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
	it("returns SharedUserId when utm_content starts with 6 hex chars", () => {
		const result = sharedUserIdFromQueryParams("abc123");
		assert(result !== null);
		assert.equal(result, "abc123");
	});

	it("returns SharedUserId when 6 hex chars are followed by more characters", () => {
		const result = sharedUserIdFromQueryParams("abc123-share");
		assert(result !== null);
		assert.equal(result, "abc123-share");
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
			utmSource: undefined,
			utmContent: undefined,
		});
		assert(result.expiresAt, "expiresAt must be set for organic visits");
		assert.equal(result.expiresAt.toISOString(), "2026-05-04T00:00:00.000Z");
		assert.equal(result.expiresAt.getTime() - savedAt.getTime(), PUBLIC_VIEW_ACCESS_WINDOW_MS);
	});

	it("returns null for utm_source=fagnerbrack.com", () => {
		const result = computePublicViewExpiry({
			savedAt,
			utmSource: PERMANENT_UTM_SOURCES[0],
			utmContent: undefined,
		});
		assert.equal(result.expiresAt, null);
	});

	it("returns null when utm_content carries a 6-hex-char prefix", () => {
		const result = computePublicViewExpiry({
			savedAt,
			utmSource: undefined,
			utmContent: "abc123-share",
		});
		assert.equal(result.expiresAt, null);
	});

	it("applies the standard expiry when utm_content is non-hex like 'paste-another-link'", () => {
		const result = computePublicViewExpiry({
			savedAt,
			utmSource: undefined,
			utmContent: "paste-another-link",
		});
		assert(result.expiresAt, "expiresAt must be set for analytics-only utm_content");
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
