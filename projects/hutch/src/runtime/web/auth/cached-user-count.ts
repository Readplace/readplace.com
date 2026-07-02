import type { CountUsers } from "@packages/provider-contracts/auth";

export function initCachedUserCount(deps: {
	countUsers: CountUsers;
	now: () => number;
	ttlMs: number;
}): CountUsers {
	const { countUsers, now, ttlMs } = deps;
	let cached: { value: number; at: number } | undefined;
	let inFlight: Promise<number> | undefined;

	return async () => {
		const nowMs = now();
		if (cached !== undefined && nowMs - cached.at < ttlMs) {
			return cached.value;
		}
		if (inFlight) return inFlight;
		inFlight = countUsers()
			.then((value) => {
				cached = { value, at: nowMs };
				return value;
			})
			.finally(() => {
				inFlight = undefined;
			});
		return inFlight;
	};
}
