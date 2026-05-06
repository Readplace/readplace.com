import type { CountUsers } from "@packages/test-fixtures/providers/auth";

export function initFetchUserCount(deps: {
	countUsers: CountUsers;
	logError: (message: string, error?: Error) => void;
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
