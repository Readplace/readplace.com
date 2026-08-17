import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { SAVE_TIP_COOKIE_NAME } from "./save-tip-cookie";
import { markSaveTipSeen, saveTipState } from "./save-tip";

/** Minimal request carrying only the cookie jar the function under test reads.
 * A bare `{}` (no key) models the request shape before cookie-parser has run. */
function requestWithCookies(cookies?: Record<string, string>): Request {
	return (cookies === undefined ? {} : { cookies }) as Request;
}

interface RecordedCookie {
	name: string;
	value: string;
	options: Record<string, unknown>;
}

function recordingResponse(): { res: Response; cookies: RecordedCookie[] } {
	const cookies: RecordedCookie[] = [];
	const res = {
		cookie(name: string, value: string, options: Record<string, unknown>) {
			cookies.push({ name, value, options });
		},
	} as Response;
	return { res, cookies };
}

describe("saveTipState", () => {
	it("owes the warning to a visitor who has not been given it this session", () => {
		expect(saveTipState(requestWithCookies({}))).toBe("due");
	});

	it("owes the warning before cookie-parser has populated a jar at all", () => {
		expect(saveTipState(requestWithCookies())).toBe("due");
	});

	it("stops owing it once the session carries the marker", () => {
		expect(saveTipState(requestWithCookies({ [SAVE_TIP_COOKIE_NAME]: "seen" }))).toBe("seen");
	});

	it("still owes it when the cookie carries a value this server never wrote", () => {
		expect(saveTipState(requestWithCookies({ [SAVE_TIP_COOKIE_NAME]: "yes" }))).toBe("due");
	});
});

describe("markSaveTipSeen", () => {
	it("writes a session cookie with no expiry, so the warning returns next session", () => {
		const { res, cookies } = recordingResponse();

		markSaveTipSeen(res, { secureCookies: true });

		const [written] = cookies;
		assert(written, "marking the tip seen must write a cookie");
		expect(written.name).toBe(SAVE_TIP_COOKIE_NAME);
		expect(saveTipState(requestWithCookies({ [written.name]: written.value }))).toBe("seen");
		expect(Object.keys(written.options)).not.toContain("maxAge");
		expect(Object.keys(written.options)).not.toContain("expires");
	});

	it("follows the serving transport rather than pinning Secure, so http dev still records it", () => {
		const { res, cookies } = recordingResponse();

		markSaveTipSeen(res, { secureCookies: false });

		const [written] = cookies;
		assert(written, "marking the tip seen must write a cookie");
		expect(written.options.secure).toBe(false);
		expect(written.options.path).toBe("/");
	});

	it("stays readable by the page's own script, which records the warning as it shows it", () => {
		const { res, cookies } = recordingResponse();

		markSaveTipSeen(res, { secureCookies: true });

		const [written] = cookies;
		assert(written, "marking the tip seen must write a cookie");
		expect(written.options.httpOnly).toBe(false);
		expect(written.options.sameSite).toBe("lax");
	});
});
