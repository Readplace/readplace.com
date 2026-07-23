import assert from "node:assert/strict";
import type { Request, Response } from "express";

import {
	EXPERIMENT_COOKIE_NAME,
	readHomepageAssignment,
	readHomepageVariantSlug,
	writeHomepageAssignment,
} from "./homepage-assignment";
import { HOMEPAGE_SPLIT } from "./homepage-split";

const [VARIANT_A, VARIANT_B] = HOMEPAGE_SPLIT.variants;

function reqWithCookie(raw: string | undefined): Request {
	return { cookies: raw === undefined ? {} : { [EXPERIMENT_COOKIE_NAME]: raw } } as unknown as Request;
}

function capturingRes(): { res: Response; cookies: { name: string; value: string; options: unknown }[] } {
	const cookies: { name: string; value: string; options: unknown }[] = [];
	const res = {
		cookie: (name: string, value: string, options: unknown) => {
			cookies.push({ name, value, options });
		},
	} as unknown as Response;
	return { res, cookies };
}

describe("writeHomepageAssignment", () => {
	it("writes campaign:epoch:slug as an httpOnly cookie the signup path can read back", () => {
		const { res, cookies } = capturingRes();

		writeHomepageAssignment(res, { config: HOMEPAGE_SPLIT, variant: VARIANT_B, secure: true });

		expect(cookies).toHaveLength(1);
		expect(cookies[0].name).toBe(EXPERIMENT_COOKIE_NAME);
		expect(cookies[0].value).toBe("homepage-split:2:variant-b");
		expect(cookies[0].options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
	});

	it("round-trips through readHomepageAssignment", () => {
		const { res, cookies } = capturingRes();
		writeHomepageAssignment(res, { config: HOMEPAGE_SPLIT, variant: VARIANT_A, secure: false });

		assert.equal(readHomepageAssignment(reqWithCookie(cookies[0].value), HOMEPAGE_SPLIT), VARIANT_A);
		expect(cookies[0].options).toMatchObject({ secure: false });
	});
});

describe("readHomepageAssignment", () => {
	it("resolves a current campaign+epoch cookie to its variant", () => {
		assert.equal(
			readHomepageAssignment(reqWithCookie("homepage-split:2:variant-a"), HOMEPAGE_SPLIT),
			VARIANT_A,
		);
		assert.equal(
			readHomepageAssignment(reqWithCookie("homepage-split:2:variant-b"), HOMEPAGE_SPLIT),
			VARIANT_B,
		);
	});

	it("returns undefined when the cookie is absent", () => {
		expect(readHomepageAssignment(reqWithCookie(undefined), HOMEPAGE_SPLIT)).toBeUndefined();
	});

	it("returns undefined when the cookie value is not a string", () => {
		const req = { cookies: { [EXPERIMENT_COOKIE_NAME]: { not: "a string" } } } as unknown as Request;
		expect(readHomepageAssignment(req, HOMEPAGE_SPLIT)).toBeUndefined();
	});

	it("returns undefined for a value without exactly three parts", () => {
		expect(readHomepageAssignment(reqWithCookie("homepage-split:1"), HOMEPAGE_SPLIT)).toBeUndefined();
		expect(
			readHomepageAssignment(reqWithCookie("homepage-split:1:variant-a:extra"), HOMEPAGE_SPLIT),
		).toBeUndefined();
	});

	it("returns undefined when the campaign no longer matches, so a renamed experiment discards it", () => {
		expect(
			readHomepageAssignment(reqWithCookie("other-campaign:1:variant-a"), HOMEPAGE_SPLIT),
		).toBeUndefined();
	});

	it("returns undefined for a stale epoch, so a re-bucket discards it", () => {
		expect(
			readHomepageAssignment(reqWithCookie("homepage-split:1:variant-a"), HOMEPAGE_SPLIT),
		).toBeUndefined();
	});

	it("returns undefined when the epoch matches but the slug is unknown", () => {
		expect(
			readHomepageAssignment(reqWithCookie("homepage-split:2:variant-z"), HOMEPAGE_SPLIT),
		).toBeUndefined();
	});
});

describe("readHomepageVariantSlug", () => {
	it("returns the arm slug against the live config", () => {
		expect(readHomepageVariantSlug(reqWithCookie("homepage-split:2:variant-b"))).toBe("variant-b");
	});

	it("returns undefined when no valid assignment is present", () => {
		expect(readHomepageVariantSlug(reqWithCookie(undefined))).toBeUndefined();
	});
});
