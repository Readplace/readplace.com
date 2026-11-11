import type { CountUsers } from "@packages/provider-contracts/auth";
import type { LogError } from "@packages/logger";

export function initFetchUserCount(deps: {
	countUsers: CountUsers;
	logError: LogError;
	logPrefix: string;
}): () => Promise<number> {
	return () =>
		deps.countUsers().catch((err) => {
			deps.logError(
				`${deps.logPrefix} countUsers failed`,
				err instanceof Error ? err : new Error(String(err)),
			);
			return 0;
		});
}
