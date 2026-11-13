import type { NextFunction, Request, Response } from "express";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import type { FindUserByEmail } from "@packages/test-fixtures/providers/auth";
import type { RefuseAdminAccess } from "./admin-forbidden.page";
import { initRequireAdmin, serviceTokenPolicy } from "./require-admin.middleware";

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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: { kind: "accepted", token: SERVICE_TOKEN }, secondFactor: { kind: "being-challenged" }, refuse });
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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: { kind: "accepted", token: SERVICE_TOKEN }, secondFactor: { kind: "being-challenged" }, refuse });
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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: { kind: "accepted", token: SERVICE_TOKEN }, secondFactor: { kind: "being-challenged" }, refuse });
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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails: [], serviceToken: { kind: "accepted", token: SERVICE_TOKEN }, secondFactor: { kind: "being-challenged" }, refuse });
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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: { kind: "accepted", token: SERVICE_TOKEN }, secondFactor: { kind: "being-challenged" }, refuse });
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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: { kind: "accepted", token: SERVICE_TOKEN }, secondFactor: { kind: "being-challenged" }, refuse });
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
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: serviceTokenPolicy(""), secondFactor: { kind: "being-challenged" }, refuse });
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

	it("treats a request that carries the token header as unauthenticated when the policy is refused", async () => {
		const middleware = initRequireAdmin({ findUserByEmail, adminEmails, serviceToken: { kind: "refused" }, secondFactor: { kind: "being-challenged" }, refuse });
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

		expect(recorded.redirectCalledWith).toEqual([303, "/login"]);
		expect(nextCalls).toBe(0);
	});
});

describe("initRequireAdmin second factor", () => {
	const ADMIN_ID = authenticatedUserIdFrom("user-alice");
	const OTHER_ID = authenticatedUserIdFrom("user-bob");
	const SERVICE_TOKEN = "test-service-token-abc123";
	const SESSION_ID = "session-alice";
	const NOW = new Date("2026-11-13T10:00:00.000Z");
	const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
	const TWELVE_HOURS_SECONDS = 12 * 60 * 60;
	const adminEmails = ["alice@example.com"];
	const sessionCookie = `${SESSION_COOKIE_NAME}=${SESSION_ID}`;
	const findUserByEmail: FindUserByEmail = async (email) =>
		email === "alice@example.com" ? { userId: ADMIN_ID, emailVerified: true } : null;

	function harness(input: { secondFactor: "enforced" | "being-challenged"; markedAt?: number }) {
		const refused: Request[] = [];
		const lookups: string[] = [];
		let nextCalls = 0;
		const middleware = initRequireAdmin({
			findUserByEmail,
			adminEmails,
			serviceToken: { kind: "accepted", token: SERVICE_TOKEN },
			secondFactor:
				input.secondFactor === "enforced"
					? {
							kind: "enforced",
							findSessionAdminMfaVerifiedAt: async (sessionId) => {
								lookups.push(sessionId);
								return input.markedAt;
							},
							now: () => NOW,
						}
					: { kind: "being-challenged" },
			refuse: async (req) => {
				refused.push(req);
			},
		});
		const { res, recorded } = makeRes();
		const next: NextFunction = () => {
			nextCalls += 1;
		};
		return {
			refused,
			lookups,
			recorded,
			nextCalls: () => nextCalls,
			run: (req: Request) => middleware(req, res, next),
		};
	}

	it("sends an allowlisted session that never passed the challenge to /admin/mfa", async () => {
		const gate = harness({ secondFactor: "enforced" });

		await gate.run(makeReq({ userId: ADMIN_ID, headers: { cookie: sessionCookie } }));

		expect(gate.recorded.redirectCalledWith).toEqual([303, "/admin/mfa"]);
		expect(gate.nextCalls()).toBe(0);
		expect(gate.lookups).toEqual([SESSION_ID]);
	});

	it("sends an allowlisted session whose challenge is older than 12 hours to /admin/mfa", async () => {
		const gate = harness({ secondFactor: "enforced", markedAt: NOW_SECONDS - TWELVE_HOURS_SECONDS - 1 });

		await gate.run(makeReq({ userId: ADMIN_ID, headers: { cookie: sessionCookie } }));

		expect(gate.recorded.redirectCalledWith).toEqual([303, "/admin/mfa"]);
		expect(gate.nextCalls()).toBe(0);
	});

	it("lets an allowlisted session through when it passed the challenge within 12 hours", async () => {
		const gate = harness({ secondFactor: "enforced", markedAt: NOW_SECONDS - TWELVE_HOURS_SECONDS + 1 });

		await gate.run(makeReq({ userId: ADMIN_ID, headers: { cookie: sessionCookie } }));

		expect(gate.nextCalls()).toBe(1);
		expect(gate.recorded.redirectCalledWith).toBeUndefined();
	});

	it("sends an allowlisted user with no session cookie to /admin/mfa", async () => {
		const gate = harness({ secondFactor: "enforced", markedAt: NOW_SECONDS });

		await gate.run(makeReq({ userId: ADMIN_ID }));

		expect(gate.recorded.redirectCalledWith).toEqual([303, "/admin/mfa"]);
		expect(gate.nextCalls()).toBe(0);
		expect(gate.lookups).toEqual([]);
	});

	it("lets an accepted service token through without reading the mark", async () => {
		const gate = harness({ secondFactor: "enforced" });

		await gate.run(makeReq({ headers: { "x-service-token": SERVICE_TOKEN } }));

		expect(gate.nextCalls()).toBe(1);
		expect(gate.lookups).toEqual([]);
	});

	it("lets an allowlisted session with no mark reach the challenge", async () => {
		const gate = harness({ secondFactor: "being-challenged" });

		await gate.run(makeReq({ userId: ADMIN_ID, headers: { cookie: sessionCookie } }));

		expect(gate.nextCalls()).toBe(1);
		expect(gate.recorded.redirectCalledWith).toBeUndefined();
	});

	it("refuses a user who is not allowlisted the challenge", async () => {
		const gate = harness({ secondFactor: "being-challenged" });
		const req = makeReq({ userId: OTHER_ID, headers: { cookie: sessionCookie } });

		await gate.run(req);

		expect(gate.refused).toEqual([req]);
		expect(gate.nextCalls()).toBe(0);
	});

	it("sends a request with no session to /login instead of the challenge", async () => {
		const gate = harness({ secondFactor: "being-challenged" });

		await gate.run(makeReq({}));

		expect(gate.recorded.redirectCalledWith).toEqual([303, "/login"]);
		expect(gate.nextCalls()).toBe(0);
	});
});

describe("serviceTokenPolicy", () => {
	it("refuses the service token when it is empty", () => {
		expect(serviceTokenPolicy("")).toEqual({ kind: "refused" });
	});

	it("accepts the given service token when it is set", () => {
		expect(serviceTokenPolicy("t")).toEqual({ kind: "accepted", token: "t" });
	});
});
