import { authenticatedUserIdFrom } from "@packages/domain/user";
import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import type { GetSessionUserId } from "@packages/provider-contracts/auth";
import { initResolveLogin } from "./resolve-login";

const USER = authenticatedUserIdFrom("user-1");

function resolverWith(getSessionUserId: GetSessionUserId, logger: HutchLogger = noopLogger) {
	return initResolveLogin({ getSessionUserId, logger });
}

describe("initResolveLogin", () => {
	it("short-circuits to guest without a DB call when no session cookie is present", async () => {
		let called = false;
		const getSessionUserId: GetSessionUserId = async () => {
			called = true;
			return null;
		};

		const state = await resolverWith(getSessionUserId)("theme=dark");

		expect(state).toEqual({ isAuthenticated: false });
		expect(called).toBe(false);
	});

	it("short-circuits to guest when the cookie header is absent entirely", async () => {
		const getSessionUserId: GetSessionUserId = async () => {
			throw new Error("must not be called");
		};

		expect(await resolverWith(getSessionUserId)(undefined)).toEqual({ isAuthenticated: false });
	});

	it("resolves to authenticated for a valid session cookie", async () => {
		const getSessionUserId: GetSessionUserId = async (sessionId) => {
			expect(sessionId).toBe("valid");
			return { userId: USER, emailVerified: true };
		};

		const state = await resolverWith(getSessionUserId)("hutch_sid=valid");

		expect(state).toEqual({ isAuthenticated: true, userId: USER, emailVerified: true });
	});

	it("resolves to guest when the session is missing or expired", async () => {
		const getSessionUserId: GetSessionUserId = async () => null;

		expect(await resolverWith(getSessionUserId)("hutch_sid=stale")).toEqual({
			isAuthenticated: false,
		});
	});

	it("degrades to guest and logs when the lookup throws", async () => {
		const errors: unknown[][] = [];
		const logger: HutchLogger = {
			...noopLogger,
			error: (...args: unknown[]) => errors.push(args),
		};
		const getSessionUserId: GetSessionUserId = async () => {
			throw new Error("dynamo unavailable");
		};

		const state = await resolverWith(getSessionUserId, logger)("hutch_sid=valid");

		expect(state).toEqual({ isAuthenticated: false });
		expect(errors).toHaveLength(1);
	});
});
