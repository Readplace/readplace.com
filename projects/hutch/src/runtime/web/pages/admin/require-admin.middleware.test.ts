import type { NextFunction, Request, Response } from "express";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { FindUserByEmail } from "@packages/test-fixtures/providers/auth";
import type { RefuseAdminAccess } from "./admin-forbidden.page";
import { initRequireAdmin } from "./require-admin.middleware";

interface RecordedRes {
	redirectCalledWith?: [number, string];
	statusCalledWith?: number;
}

function makeReq(partial: Partial<Request>): Request {
	return { headers: {}, ...partial } as Request;
}

function makeRes(): { res: Response; recorded: RecordedRes } {
	const recorded: RecordedRes = {};
	const stub: Partial<Response> & { recorded?: RecordedRes } = {};
	stub.redirect = ((...args: unknown[]) => {
		const [code, url] = args as [number, string];
		recorded.redirectCalledWith = [code, url];
		return stub as Response;
	}) as Response["redirect"];
	stub.status = ((code: number) => {
		recorded.statusCalledWith = code;
		return stub as Response;
	}) as Response["status"];
	return { res: stub as Response, recorded };
}

describe("initRequireAdmin", () => {
	const ADMIN_ID = authenticatedUserIdFrom("user-alice");
	const OTHER_ID = authenticatedUserIdFrom("user-bob");
	const SERVICE_TOKEN = "test-service-token-abc123";
	const adminEmails = ["alice@example.com", "carol@example.com"];
	let refusedRequests: Request[] = [];
	const refuse: RefuseAdminAccess = async (req) => {
		refusedRequests.push(req);
	};
	beforeEach(() => {
		refusedRequests = [];
	});
	const findUserByEmail: FindUserByEmail = async (email) => {
		if (email === "alice@example.com") {
			return { userId: ADMIN_ID, emailVerified: true };
		}
		return null;
	};

	it("redirects to /login when there is no session", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN, refuse });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		await middleware(makeReq({}), res, next);

		expect(recorded.redirectCalledWith).toEqual([303, "/login"]);
		expect(nextCalls).toBe(0);
	});

	it("refuses the session user who is not in the admin allowlist", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN, refuse });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		const req = makeReq({ userId: OTHER_ID });
		await middleware(req, res, next);

		expect(refusedRequests).toEqual([req]);
		expect(recorded.redirectCalledWith).toBeUndefined();
		expect(nextCalls).toBe(0);
	});

	it("calls next() when the session user matches one of the allowlisted emails", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN, refuse });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		await middleware(makeReq({ userId: ADMIN_ID }), res, next);

		expect(nextCalls).toBe(1);
		expect(recorded.statusCalledWith).toBeUndefined();
		expect(recorded.redirectCalledWith).toBeUndefined();
	});

	it("refuses a logged-in user when the allowlist is empty", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails: [], serviceToken: SERVICE_TOKEN, refuse });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		const req = makeReq({ userId: ADMIN_ID });
		await middleware(req, res, next);

		expect(refusedRequests).toEqual([req]);
		expect(recorded.redirectCalledWith).toBeUndefined();
		expect(nextCalls).toBe(0);
	});

	it("calls next() when x-service-token header matches the configured token (no session required)", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN, refuse });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		await middleware(
			makeReq({ headers: { "x-service-token": SERVICE_TOKEN } }),
			res,
			next,
		);

		expect(nextCalls).toBe(1);
		expect(recorded.statusCalledWith).toBeUndefined();
		expect(recorded.redirectCalledWith).toBeUndefined();
	});

	it("falls through to session auth when x-service-token header is wrong", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN, refuse });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		await middleware(
			makeReq({ headers: { "x-service-token": "wrong-token-wrong-token-ab" } }),
			res,
			next,
		);

		expect(recorded.redirectCalledWith).toEqual([303, "/login"]);
		expect(nextCalls).toBe(0);
	});

	it("never auto-accepts when serviceToken is empty (fail-closed)", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: "", refuse });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		await middleware(
			makeReq({ headers: { "x-service-token": "" } }),
			res,
			next,
		);

		expect(recorded.redirectCalledWith).toEqual([303, "/login"]);
		expect(nextCalls).toBe(0);
	});
});
