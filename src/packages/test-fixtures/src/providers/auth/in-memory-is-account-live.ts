import type { FindUserById, IsAccountLive } from "@packages/provider-contracts/auth";

export function initInMemoryIsAccountLive(deps: { findUserById: FindUserById }): IsAccountLive {
	return async (userId) => {
		const user = await deps.findUserById(userId);
		return user !== null && user.deletedAt === undefined;
	};
}
