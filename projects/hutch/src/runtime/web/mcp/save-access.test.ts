import { UserIdSchema } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import { initResolveSaveAccess } from "./save-access";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const NOW = new Date("2026-06-16T00:00:00.000Z");
const DAY_MS = 86_400_000;

function findUser(
	user: { emailVerified: boolean; registeredAt?: string } | null,
): FindUserById {
	return async () => (user ? { userId, ...user } : null);
}

describe("initResolveSaveAccess", () => {
	it("refuses a save for a locked account (email unverified past its window)", async () => {
		const resolve = initResolveSaveAccess({
			findUserById: findUser({
				emailVerified: false,
				registeredAt: new Date(NOW.getTime() - 8 * DAY_MS).toISOString(),
			}),
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
			now: () => NOW,
		});
		expect(await resolve(userId)).toEqual({ allowed: true });
	});

	it("allows a save for a verified account", async () => {
		const resolve = initResolveSaveAccess({
			findUserById: findUser({ emailVerified: true }),
			now: () => NOW,
		});
		expect(await resolve(userId)).toEqual({ allowed: true });
	});

	it("allows a save when the token is valid but no user record is found", async () => {
		const resolve = initResolveSaveAccess({
			findUserById: findUser(null),
			now: () => NOW,
		});
		expect(await resolve(userId)).toEqual({ allowed: true });
	});
});
