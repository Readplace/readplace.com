import type { NextFunction, Request, Response } from "express";
import {
	VISITOR_COOKIE_NAME,
	createVisitorIdMiddleware,
	readVisitorId,
} from "./visitor-id.middleware";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

function createReq(cookies?: Record<string, unknown>): Request {
	return { cookies } as unknown as Request;
}

function createRes(): {
	res: Response;
	cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>;
} {
	const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
	const res = {
		cookie(name: string, value: string, options: Record<string, unknown>) {
			cookies.push({ name, value, options });
			return res;
		},
	} as unknown as Response;
	return { res, cookies };
}

describe("readVisitorId", () => {
	it("returns undefined when no cookie jar / no visitor cookie is present", () => {
		expect(readVisitorId(createReq())).toBeUndefined();
		expect(readVisitorId(createReq({}))).toBeUndefined();
	});

	it("returns undefined when the cookie value is not a string", () => {
		expect(readVisitorId(createReq({ [VISITOR_COOKIE_NAME]: 123 }))).toBeUndefined();
	});

	it("treats a tampered/corrupt (non-uuid) cookie as absent so a fresh id is minted", () => {
		expect(readVisitorId(createReq({ [VISITOR_COOKIE_NAME]: "not-a-uuid" }))).toBeUndefined();
	});

	it("returns the validated id when the cookie holds a valid uuid", () => {
		expect(readVisitorId(createReq({ [VISITOR_COOKIE_NAME]: VALID_UUID }))).toBe(VALID_UUID);
	});
});

describe("createVisitorIdMiddleware", () => {
	it("reuses an existing valid visitor id without re-issuing the cookie", () => {
		const { res, cookies } = createRes();
		const req = createReq({ [VISITOR_COOKIE_NAME]: VALID_UUID });
		let nexted = false;
		const next: NextFunction = () => {
			nexted = true;
		};

		createVisitorIdMiddleware({ generateVisitorId: () => "unused", secure: false })(req, res, next);

		expect(req.visitorId).toBe(VALID_UUID);
		expect(cookies).toEqual([]);
		expect(nexted).toBe(true);
	});

	it("mints a new id and sets the long-lived first-party hutch_vid cookie when none is present", () => {
		const { res, cookies } = createRes();
		const req = createReq();
		let nexted = false;
		const next: NextFunction = () => {
			nexted = true;
		};

		createVisitorIdMiddleware({ generateVisitorId: () => VALID_UUID, secure: false })(req, res, next);

		expect(req.visitorId).toBe(VALID_UUID);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]).toMatchObject({
			name: VISITOR_COOKIE_NAME,
			value: VALID_UUID,
			options: expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", secure: false }),
		});
		expect(nexted).toBe(true);
	});

	it("marks the cookie Secure when the app serves over https, leaving the other attributes unchanged", () => {
		const { res, cookies } = createRes();
		const req = createReq();

		createVisitorIdMiddleware({ generateVisitorId: () => VALID_UUID, secure: true })(req, res, () => {});

		expect(cookies).toHaveLength(1);
		expect(cookies[0].options).toMatchObject({
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			secure: true,
		});
	});

	it("re-mints when the existing cookie is corrupt rather than propagating a tampered value", () => {
		const { res, cookies } = createRes();
		const req = createReq({ [VISITOR_COOKIE_NAME]: "corrupt" });

		createVisitorIdMiddleware({ generateVisitorId: () => VALID_UUID, secure: false })(req, res, () => {});

		expect(req.visitorId).toBe(VALID_UUID);
		expect(cookies).toHaveLength(1);
	});
});
