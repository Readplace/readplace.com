import type { NextFunction, Request, Response } from "express";
import type { UserId } from "@packages/domain/user";
import type { FindUserByEmail } from "@packages/test-fixtures/providers/auth";
import { initRequireAdmin } from "./require-admin.middleware";

interface RecordedRes {
	redirectCalledWith?: [number, string];
	statusCalledWith?: number;
	sentBody?: string;
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
	stub.type = ((() => stub) as unknown) as Response["type"];
	stub.send = ((body: string) => {
		recorded.sentBody = body;
		return stub as Response;
	}) as Response["send"];
	return { res: stub as Response, recorded };
}

describe("initRequireAdmin", () => {
	const ADMIN_ID = "user-alice" as UserId;
	const OTHER_ID = "user-bob" as UserId;
	const SERVICE_TOKEN = "test-service-token-abc123";
	const adminEmails = ["alice@example.com", "carol@example.com"];
	const findUserByEmail: FindUserByEmail = async (email) => {
		if (email === "alice@example.com") {
			return { userId: ADMIN_ID, emailVerified: true };
		}
		return null;
	};

	it("redirects to /login when there is no session", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		await middleware(makeReq({}), res, next);

		expect(recorded.redirectCalledWith).toEqual([303, "/login"]);
		expect(nextCalls).toBe(0);
	});

	it("responds 403 when the session user is not in the admin allowlist", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		await middleware(makeReq({ userId: OTHER_ID }), res, next);

		expect(recorded.statusCalledWith).toBe(403);
		expect(recorded.sentBody).toContain("Admin access required");
		expect(nextCalls).toBe(0);
	});

	it("calls next() when the session user matches one of the allowlisted emails", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN });
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

	it("responds 403 when the allowlist is empty even if the user is logged in", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails: [], serviceToken: SERVICE_TOKEN });
		const { res, recorded } = makeRes();
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		await middleware(makeReq({ userId: ADMIN_ID }), res, next);

		expect(recorded.statusCalledWith).toBe(403);
		expect(nextCalls).toBe(0);
	});

	it("calls next() when x-service-token header matches the configured token (no session required)", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN });
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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: SERVICE_TOKEN });
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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: "" });
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
