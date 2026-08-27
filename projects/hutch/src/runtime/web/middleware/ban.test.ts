import type { NextFunction, Request, Response } from "express";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { createBanMiddleware, type HashIp } from "./ban";

/** First entry in banned-visitors.txt — see that file for known banned hashes. */
const KNOWN_BANNED_HASH = "836d77f3df16e15f";

function run(hashIp: HashIp): { status?: number; nextCalled: boolean } {
	let status: number | undefined;
	const res: Partial<Response> = {
		status: (code: number) => {
			status = code;
			return res as Response;
		},
		end: jest.fn(),
	};
	const req: Partial<Request> = { ip: "1.2.3.4", headers: {} };
	createViewerIdentityMiddleware({ edgeSecret: "" })(req as Request, res as Response, jest.fn());
	const next = jest.fn();
	createBanMiddleware({ salt: "salt", hashIp })(req as Request, res as Response, next as NextFunction);
	return { status, nextCalled: next.mock.calls.length > 0 };
}

describe("createBanMiddleware", () => {
	it("calls next() when the hashed ip is not in the banned list", () => {
		const result = run(() => "unbannedhashxxxx");
		expect(result.nextCalled).toBe(true);
		expect(result.status).toBeUndefined();
	});

	it("calls next() when hashIp returns null (no ip)", () => {
		const result = run(() => null);
		expect(result.nextCalled).toBe(true);
		expect(result.status).toBeUndefined();
	});

	it("responds 403 when the hashed ip matches a banned entry", () => {
		const result = run(() => KNOWN_BANNED_HASH);
		expect(result.status).toBe(403);
		expect(result.nextCalled).toBe(false);
	});
});
