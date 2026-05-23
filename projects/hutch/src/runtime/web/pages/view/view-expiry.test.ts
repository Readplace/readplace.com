import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import {
	PERMANENT_UTM_SOURCE,
	PUBLIC_VIEW_ACCESS_WINDOW_MS,
	SHARED_USER_ID_PREFIX_LENGTH,
	computePublicViewExpiry,
	decomposeTimeLeft,
	formatCounter,
	formatSaveUtmContent,
	hasSharedUserIdPrefix,
	shareUserIdPrefix,
} from "./view-expiry";

describe("shareUserIdPrefix", () => {
	it("returns the first SHARED_USER_ID_PREFIX_LENGTH chars of the user id", () => {
		const userId = UserIdSchema.parse("abc123deadbeef1234567890abcdef01");
		const prefix = shareUserIdPrefix(userId);
		expect(prefix).toBe("abc123");
		expect(prefix.length).toBe(SHARED_USER_ID_PREFIX_LENGTH);
	});
});

describe("hasSharedUserIdPrefix", () => {
	it("returns true when utm_content starts with 6 hex chars", () => {
		expect(hasSharedUserIdPrefix("abc123")).toBe(true);
	});

	it("returns true when 6 hex chars are followed by more characters", () => {
		expect(hasSharedUserIdPrefix("abc123-share")).toBe(true);
	});

	it("returns false for non-hex values like 'paste-another-link'", () => {
		expect(hasSharedUserIdPrefix("paste-another-link")).toBe(false);
	});

	it("returns false when fewer than 6 hex chars are present", () => {
		expect(hasSharedUserIdPrefix("abcde")).toBe(false);
	});

	it("returns false when utm_content is undefined", () => {
		expect(hasSharedUserIdPrefix(undefined)).toBe(false);
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
		expect(result.expiresAt.toISOString()).toBe("2026-05-04T00:00:00.000Z");
		expect(result.expiresAt.getTime() - savedAt.getTime()).toBe(
			PUBLIC_VIEW_ACCESS_WINDOW_MS,
		);
	});

	it("returns null for utm_source=fagnerbrack.com", () => {
		const result = computePublicViewExpiry({
			savedAt,
			utmSource: PERMANENT_UTM_SOURCE,
			utmContent: undefined,
		});
		expect(result.expiresAt).toBeNull();
	});

	it("returns null when utm_content carries a 6-hex-char prefix", () => {
		const result = computePublicViewExpiry({
			savedAt,
			utmSource: undefined,
			utmContent: "abc123-share",
		});
		expect(result.expiresAt).toBeNull();
	});

	it("applies the standard expiry when utm_content is non-hex like 'paste-another-link'", () => {
		const result = computePublicViewExpiry({
			savedAt,
			utmSource: undefined,
			utmContent: "paste-another-link",
		});
		assert(result.expiresAt, "expiresAt must be set for analytics-only utm_content");
		expect(result.expiresAt.toISOString()).toBe("2026-05-04T00:00:00.000Z");
	});
});

describe("decomposeTimeLeft", () => {
	it("splits 1d 10h 5m 33s into components", () => {
		const ms =
			1 * 24 * 60 * 60 * 1000 +
			10 * 60 * 60 * 1000 +
			5 * 60 * 1000 +
			33 * 1000;
		expect(decomposeTimeLeft(ms)).toEqual({
			days: 1,
			hours: 10,
			minutes: 5,
			seconds: 33,
		});
	});

	it("returns all zeros for zero input", () => {
		expect(decomposeTimeLeft(0)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
		});
	});

	it("clamps negative input to zero", () => {
		expect(decomposeTimeLeft(-1000)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
		});
	});
});

describe("formatCounter", () => {
	it("renders '1d 10h 5m 33s'", () => {
		expect(
			formatCounter({ days: 1, hours: 10, minutes: 5, seconds: 33 }),
		).toBe("1d 10h 5m 33s");
	});
});

describe("formatSaveUtmContent", () => {
	it("renders '2d_4h_left' at day/hour resolution only", () => {
		expect(
			formatSaveUtmContent({ days: 2, hours: 4, minutes: 30, seconds: 15 }),
		).toBe("2d_4h_left");
	});
});
