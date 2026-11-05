import assert from "node:assert/strict";
import type { CookieOptions } from "express";
import { z } from "zod";
import { defineCookie } from "./define-cookie";

function recordingResponse() {
	const cookieCalls: [string, string, CookieOptions][] = [];
	const clearCookieCalls: [string, { path: string }][] = [];
	return {
		cookieCalls,
		clearCookieCalls,
		cookie(name: string, value: string, options: CookieOptions) {
			cookieCalls.push([name, value, options]);
		},
		clearCookie(name: string, options: { path: string }) {
			clearCookieCalls.push([name, options]);
		},
	};
}

const laxHttpOnlyCookie = defineCookie({
	name: "c",
	maxAgeMs: 1000,
	sameSite: "lax",
	httpOnly: true,
	schema: z.string(),
});

describe("defineCookie options", () => {
	it("carries every declared attribute with Secure for an HTTPS deployment", () => {
		assert.deepEqual(laxHttpOnlyCookie.options(true), {
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			secure: true,
			maxAge: 1000,
		});
	});

	it("drops Secure for plain-http local dev", () => {
		assert.deepEqual(laxHttpOnlyCookie.options(false), {
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			secure: false,
			maxAge: 1000,
		});
	});

	it("sets no maxAge for a browser-session cookie", () => {
		const browserSessionCookie = defineCookie({
			name: "s",
			maxAgeMs: "browser-session",
			sameSite: "lax",
			httpOnly: true,
			schema: z.string(),
		});
		assert.equal("maxAge" in browserSessionCookie.options(true), false);
	});

	it("carries sameSite none and httpOnly false through", () => {
		const crossSiteScriptReadableCookie = defineCookie({
			name: "x",
			maxAgeMs: 500,
			sameSite: "none",
			httpOnly: false,
			schema: z.string(),
		});
		assert.deepEqual(crossSiteScriptReadableCookie.options(true), {
			httpOnly: false,
			sameSite: "none",
			path: "/",
			secure: true,
			maxAge: 500,
		});
	});

	it("still works when options is detached from its definition", () => {
		const { options } = laxHttpOnlyCookie;
		assert.deepEqual(options(true), laxHttpOnlyCookie.options(true));
	});
});

describe("defineCookie set", () => {
	it("writes the value under the declared name with the declared options", () => {
		const res = recordingResponse();
		laxHttpOnlyCookie.set({ res, value: "v", secure: true });
		assert.deepEqual(res.cookieCalls, [["c", "v", laxHttpOnlyCookie.options(true)]]);
	});
});

describe("defineCookie read", () => {
	it("returns the cookie value when it passes the schema", () => {
		assert.equal(laxHttpOnlyCookie.read({ cookies: { c: "v" } }), "v");
	});

	it("returns undefined when the request has no cookies object", () => {
		assert.equal(laxHttpOnlyCookie.read({}), undefined);
	});

	it("returns undefined when the cookie is absent", () => {
		assert.equal(laxHttpOnlyCookie.read({ cookies: {} }), undefined);
	});

	it("returns undefined when the cookie is not a string", () => {
		assert.equal(laxHttpOnlyCookie.read({ cookies: { c: 42 } }), undefined);
	});

	it("returns undefined when the schema rejects the value", () => {
		const providerCookie = defineCookie({
			name: "p",
			maxAgeMs: 1000,
			sameSite: "lax",
			httpOnly: true,
			schema: z.enum(["google", "apple"]),
		});
		assert.equal(providerCookie.read({ cookies: { p: "github" } }), undefined);
	});

	it("validates against a uuid schema", () => {
		const uuidCookie = defineCookie({
			name: "u",
			maxAgeMs: 1000,
			sameSite: "lax",
			httpOnly: true,
			schema: z.string().uuid(),
		});
		const visitorUuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
		assert.equal(uuidCookie.read({ cookies: { u: visitorUuid } }), visitorUuid);
		assert.equal(uuidCookie.read({ cookies: { u: "not-a-uuid" } }), undefined);
	});
});

describe("defineCookie consume", () => {
	it("returns the read value and clears the cookie when it is present", () => {
		const res = recordingResponse();
		const consumed = laxHttpOnlyCookie.consume({ req: { cookies: { c: "v" } }, res });
		assert.equal(consumed, "v");
		assert.deepEqual(res.clearCookieCalls, [["c", { path: "/" }]]);
	});

	it("returns undefined and still clears the cookie when it is absent", () => {
		const res = recordingResponse();
		const consumed = laxHttpOnlyCookie.consume({ req: { cookies: {} }, res });
		assert.equal(consumed, undefined);
		assert.deepEqual(res.clearCookieCalls, [["c", { path: "/" }]]);
	});
});
