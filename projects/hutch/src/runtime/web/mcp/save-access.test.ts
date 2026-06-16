import { UserIdSchema } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { GetEffectiveAccess } from "../../domain/access/effective-access";
import { initResolveSaveAccess } from "./save-access";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const NOW = new Date("2026-06-16T00:00:00.000Z");
const DAY_MS = 86_400_000;

function findUser(
	user: { emailVerified: boolean; registeredAt?: string } | null,
): FindUserById {
	return async () => (user ? { userId, ...user } : null);
}

const fullAccess: GetEffectiveAccess = async () => ({
	tier: "founding",
	access: "full",
	banner: "none",
});

const inactiveAccess: GetEffectiveAccess = async () => ({
	tier: "inactive",
	access: "read-only",
	banner: "inactive",
	reason: "trial-expired",
});

describe("initResolveSaveAccess", () => {
	it("refuses a save for a locked account (email unverified past its window)", async () => {
		const resolve = initResolveSaveAccess({
			findUserById: findUser({
				emailVerified: false,
				registeredAt: new Date(NOW.getTime() - 8 * DAY_MS).toISOString(),
			}),
			getEffectiveAccess: fullAccess,
			now: () => NOW,
		});
		expect(await resolve(userId)).toMatchObject({
			allowed: false,
			message: expect.stringContaining("locked"),
		});
	});

	it("allows a save for an unverified account still inside its countdown window", async () => {
		const resolve = initResolveSaveAccess({
			findUserById: findUser({
				emailVerified: false,
				registeredAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
			}),
			getEffectiveAccess: fullAccess,
			now: () => NOW,
		});
		expect(await resolve(userId)).toEqual({ allowed: true });
	});

	it("refuses a save when the caller's subscription is inactive", async () => {
		const resolve = initResolveSaveAccess({
			findUserById: findUser({ emailVerified: true }),
			getEffectiveAccess: inactiveAccess,
			now: () => NOW,
		});
		expect(await resolve(userId)).toMatchObject({
			allowed: false,
			message: expect.stringContaining("subscription"),
		});
	});

	it("allows a save for a verified account with full access", async () => {
		const resolve = initResolveSaveAccess({
			findUserById: findUser({ emailVerified: true }),
			getEffectiveAccess: fullAccess,
			now: () => NOW,
		});
		expect(await resolve(userId)).toEqual({ allowed: true });
	});

	it("allows a save when the token is valid but no user record is found", async () => {
		const resolve = initResolveSaveAccess({
			findUserById: findUser(null),
			getEffectiveAccess: fullAccess,
			now: () => NOW,
		});
		expect(await resolve(userId)).toEqual({ allowed: true });
	});
});
