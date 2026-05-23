import assert from "node:assert/strict";
import type { UserId } from "@packages/domain/user";
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

const SAVED_AT = new Date("2026-05-20T00:00:00.000Z");
const EXPIRES_AT = new Date(
	SAVED_AT.getTime() + PUBLIC_VIEW_ACCESS_WINDOW_MS,
);

describe("shareUserIdPrefix", () => {
	it("returns the first 6 characters of the userId so the sharer can be traced without exposing the whole id", () => {
		const userId = "a3f1c2deadbeef0123456789abcdef01" as UserId;

		expect(shareUserIdPrefix(userId)).toBe("a3f1c2");
		expect(shareUserIdPrefix(userId).length).toBe(SHARED_USER_ID_PREFIX_LENGTH);
	});
});

describe("hasSharedUserIdPrefix", () => {
	it("matches utm_content that starts with 6 hex chars (a logged-in sharer's id prefix)", () => {
		expect(hasSharedUserIdPrefix("a3f1c2")).toBe(true);
		expect(hasSharedUserIdPrefix("a3f1c2-some-suffix")).toBe(true);
		expect(hasSharedUserIdPrefix("0000ff_more")).toBe(true);
	});

	it("rejects values that do not start with 6 hex chars so analytics-only utm_content like `paste-another-link` keeps the standard expiry", () => {
		expect(hasSharedUserIdPrefix("paste-another-link")).toBe(false);
		expect(hasSharedUserIdPrefix("a3f1c")).toBe(false);
		expect(hasSharedUserIdPrefix("ZZZZZZ")).toBe(false);
		expect(hasSharedUserIdPrefix("share-balloon-fallback")).toBe(false);
	});

	it("returns false when utm_content is undefined", () => {
		expect(hasSharedUserIdPrefix(undefined)).toBe(false);
	});
});

describe("computePublicViewExpiry", () => {
	it("returns savedAt + 3 days for an organic visit (no utm_source, no utm_content)", () => {
		const result = computePublicViewExpiry({
			savedAt: SAVED_AT,
			utmSource: undefined,
			utmContent: undefined,
		});

		assert(result.expiresAt, "expiresAt must be set for organic visits");
		expect(result.expiresAt.toISOString()).toBe(EXPIRES_AT.toISOString());
	});

	it("returns null (permanent) when utm_source = fagnerbrack.com so syndication from the founder's blog never expires", () => {
		const result = computePublicViewExpiry({
			savedAt: SAVED_AT,
			utmSource: PERMANENT_UTM_SOURCE,
			utmContent: undefined,
		});

		expect(result.expiresAt).toBeNull();
	});

	it("returns null (permanent) when utm_content carries a 6-hex-char userId prefix (share-balloon or /read redirect)", () => {
		const result = computePublicViewExpiry({
			savedAt: SAVED_AT,
			utmSource: "share-balloon",
			utmContent: "a3f1c2",
		});

		expect(result.expiresAt).toBeNull();
	});

	it("applies the standard expiry when utm_source is share-balloon but utm_content lacks the userId prefix (anonymous sharer fallback)", () => {
		const result = computePublicViewExpiry({
			savedAt: SAVED_AT,
			utmSource: "share-balloon",
			utmContent: "anonymous",
		});

		assert(result.expiresAt, "expiresAt must be set when no userId prefix");
		expect(result.expiresAt.toISOString()).toBe(EXPIRES_AT.toISOString());
	});
});

describe("decomposeTimeLeft", () => {
	it("splits a duration into days/hours/minutes/seconds", () => {
		const oneDayTenHoursFiveMinThirtyThreeSec =
			((24 + 10) * 3600 + 5 * 60 + 33) * 1000;

		expect(decomposeTimeLeft(oneDayTenHoursFiveMinThirtyThreeSec)).toEqual({
			days: 1,
			hours: 10,
			minutes: 5,
			seconds: 33,
		});
	});

	it("returns all zeros for a zero or negative duration so the counter shows `0d 0h 0m 0s` at expiry", () => {
		expect(decomposeTimeLeft(0)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
		});
		expect(decomposeTimeLeft(-1000)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
		});
	});
});

describe("formatCounter", () => {
	it("formats the full days/hours/minutes/seconds tuple as `Xd Yh Zm Ws`", () => {
		expect(
			formatCounter({ days: 1, hours: 10, minutes: 5, seconds: 33 }),
		).toBe("1d 10h 5m 33s");
	});
});

describe("formatSaveUtmContent", () => {
	it("formats as `Xd_Yh_left` at day/hour resolution so the analytics value is stable across short clicks", () => {
		expect(
			formatSaveUtmContent({ days: 2, hours: 4, minutes: 5, seconds: 33 }),
		).toBe("2d_4h_left");
		expect(
			formatSaveUtmContent({ days: 0, hours: 3, minutes: 0, seconds: 0 }),
		).toBe("0d_3h_left");
	});
});
