import assert from "node:assert/strict";
import type { Request } from "express";

import { resolveHomepageArm } from "./homepage-arm";
import { EXPERIMENT_COOKIE_NAME } from "./homepage-assignment";
import { HOMEPAGE_SPLIT } from "./homepage-split";

const [VARIANT_A, VARIANT_B] = HOMEPAGE_SPLIT.variants;

function reqWithCookie(raw?: string): Request {
	return { cookies: raw === undefined ? {} : { [EXPERIMENT_COOKIE_NAME]: raw } } as unknown as Request;
}

function resolve(input: { cookie?: string; eligible?: boolean; byte?: number; active?: boolean }) {
	return resolveHomepageArm({
		req: reqWithCookie(input.cookie),
		config: { ...HOMEPAGE_SPLIT, active: input.active ?? true },
		eligible: input.eligible ?? true,
		drawRandomByte: () => input.byte ?? 0,
	});
}

describe("resolveHomepageArm", () => {
	it("draws the first arm for the low half of the byte range and the second for the high half", () => {
		assert.equal(resolve({ byte: 0 }).variant, VARIANT_A);
		assert.equal(resolve({ byte: 127 }).variant, VARIANT_A);
		assert.equal(resolve({ byte: 128 }).variant, VARIANT_B);
		assert.equal(resolve({ byte: 255 }).variant, VARIANT_B);
	});

	it("counts a freshly drawn arm as an exposure so the caller records it", () => {
		expect(resolve({ byte: 200 }).participating).toBe(true);
	});

	it("reuses the recorded assignment instead of drawing again, so the arm survives across visits", () => {
		const arm = resolve({ cookie: "homepage-split:3:variant-b", byte: 0 });

		assert.equal(arm.variant, VARIANT_B);
		expect(arm.participating).toBe(true);
	});

	it("re-draws when the recorded assignment is from a bumped epoch", () => {
		const arm = resolve({ cookie: "homepage-split:1:variant-b", byte: 0 });

		assert.equal(arm.variant, VARIANT_A);
		expect(arm.participating).toBe(true);
	});

	it("re-draws when the recorded assignment is from another campaign", () => {
		const arm = resolve({ cookie: "other-campaign:3:variant-b", byte: 200 });

		assert.equal(arm.variant, VARIANT_B);
		expect(arm.participating).toBe(true);
	});

	it("keeps an ineligible visitor on the incumbent arm and out of the measurement", () => {
		const arm = resolve({ eligible: false, byte: 255 });

		assert.equal(arm.variant, VARIANT_A);
		expect(arm.participating).toBe(false);
	});

	it("ignores a recorded assignment for an ineligible visitor, so a crawler carrying a cookie still gets the incumbent", () => {
		const arm = resolve({ eligible: false, cookie: "homepage-split:3:variant-b" });

		assert.equal(arm.variant, VARIANT_A);
		expect(arm.participating).toBe(false);
	});

	it("serves the incumbent arm to everyone once the kill switch is off", () => {
		const arm = resolve({ active: false, cookie: "homepage-split:3:variant-b", byte: 255 });

		assert.equal(arm.variant, VARIANT_A);
		expect(arm.participating).toBe(false);
	});
});
