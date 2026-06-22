import type { Request, Response } from "express";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type {
	FindUserById,
	MarkSessionEmailVerified,
} from "@packages/test-fixtures/providers/auth";
import { initResolveVerificationStatus } from "./resolve-verification-status.middleware";
import { SESSION_COOKIE_NAME } from "../auth/session-cookie";

const USER_ID = authenticatedUserIdFrom("user-1");
const NOW = new Date("2026-01-08T00:00:00.000Z");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Wraps a finder so a test can assert whether the lookup actually fired —
 * the middleware must skip it for guests, verified sessions, and a request
 * already resolved upstream. */
function countingFinder(impl: FindUserById): {
	findUserById: FindUserById;
	calls: () => number;
} {
	let calls = 0;
	return {
		findUserById: async (userId) => {
			calls += 1;
			return impl(userId);
		},
		calls: () => calls,
	};
}

/** Records the sessions the middleware healed, so the persistence path is
 * observable. Reset before each test. */
const markedSessions: string[] = [];
const markSessionEmailVerified: MarkSessionEmailVerified = async (sessionId) => {
	markedSessions.push(sessionId);
};

beforeEach(() => {
	markedSessions.length = 0;
});

async function run(
	req: Partial<Request>,
	findUserById: FindUserById,
): Promise<number> {
	const middleware = initResolveVerificationStatus({
		findUserById,
		markSessionEmailVerified,
		now: () => NOW,
	});
	let nextCalls = 0;
	// The middleware only ever calls next() for the cases it owns; it never
	// touches the response, so an empty Response stand-in is sufficient.
	await middleware(req as Request, {} as Response, () => {
		nextCalls += 1;
	});
	return nextCalls;
}

describe("initResolveVerificationStatus", () => {
	it("passes a guest through without a lookup", async () => {
		const finder = countingFinder(async () => null);
		const nextCalls = await run({}, finder.findUserById);
		expect(nextCalls).toBe(1);
		expect(finder.calls()).toBe(0);
	});

	it("passes a verified session through without a lookup", async () => {
		const finder = countingFinder(async () => null);
		const nextCalls = await run(
			{ userId: USER_ID, emailVerified: true },
			finder.findUserById,
		);
		expect(nextCalls).toBe(1);
		expect(finder.calls()).toBe(0);
	});

	it("skips the lookup when a status was already resolved upstream", async () => {
		const finder = countingFinder(async () => null);
		const req: Partial<Request> = {
			userId: USER_ID,
			emailVerified: false,
			verificationStatus: { state: "counting-down", daysLeft: 3 },
		};
		const nextCalls = await run(req, finder.findUserById);
		expect(nextCalls).toBe(1);
		expect(finder.calls()).toBe(0);
		expect(req.verificationStatus).toEqual({ state: "counting-down", daysLeft: 3 });
	});

	it("leaves status unset for an orphaned session whose user no longer exists", async () => {
		const req: Partial<Request> = { userId: USER_ID, emailVerified: false };
		const nextCalls = await run(req, async () => null);
		expect(nextCalls).toBe(1);
		expect(req.verificationStatus).toBeUndefined();
	});

	it("self-heals a stale session when the user record is already verified", async () => {
		const req: Partial<Request> = { userId: USER_ID, emailVerified: false };
		const nextCalls = await run(req, async () => ({
			userId: USER_ID,
			emailVerified: true,
			registeredAt: "2020-01-01T00:00:00.000Z",
		}));
		expect(nextCalls).toBe(1);
		expect(req.emailVerified).toBe(true);
		expect(req.verificationStatus).toBeUndefined();
		// No session cookie on this request, so there is nothing to persist.
		expect(markedSessions).toEqual([]);
	});

	it("persists the heal to the session when a session cookie is present", async () => {
		const req: Partial<Request> = {
			userId: USER_ID,
			emailVerified: false,
			cookies: { [SESSION_COOKIE_NAME]: "session-abc" },
		};
		await run(req, async () => ({
			userId: USER_ID,
			emailVerified: true,
			registeredAt: "2020-01-01T00:00:00.000Z",
		}));
		expect(req.emailVerified).toBe(true);
		expect(markedSessions).toEqual(["session-abc"]);
	});

	it("sets a counting-down status within the verification window", async () => {
		const registeredAt = new Date(NOW.getTime() - 2 * ONE_DAY_MS).toISOString();
		const req: Partial<Request> = { userId: USER_ID, emailVerified: false };
		await run(req, async () => ({ userId: USER_ID, emailVerified: false, registeredAt }));
		expect(req.verificationStatus).toEqual({ state: "counting-down", daysLeft: 5 });
	});

	it("sets a locked status once the window has lapsed", async () => {
		const registeredAt = new Date(NOW.getTime() - 8 * ONE_DAY_MS).toISOString();
		const req: Partial<Request> = { userId: USER_ID, emailVerified: false };
		await run(req, async () => ({ userId: USER_ID, emailVerified: false, registeredAt }));
		expect(req.verificationStatus).toEqual({ state: "locked" });
	});

	it("resolves the lockout for a bearer request whose session emailVerified is unknown", async () => {
		const registeredAt = new Date(NOW.getTime() - 8 * ONE_DAY_MS).toISOString();
		// Bearer/Siren requests carry no session cookie and so reach this step with
		// `emailVerified` undefined; the lock must still resolve from the record.
		const req: Partial<Request> = { userId: USER_ID };
		const finder = countingFinder(async () => ({
			userId: USER_ID,
			emailVerified: false,
			registeredAt,
		}));
		await run(req, finder.findUserById);
		expect(finder.calls()).toBe(1);
		expect(req.verificationStatus).toEqual({ state: "locked" });
	});
});
