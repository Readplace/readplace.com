import { validateSaveableUrl } from "@packages/domain/article";
import type { FindIdentityRow } from "@packages/provider-contracts/article-store";
import { initResolveSaveIdentity, neverResolveWrapperTarget } from "@packages/save-article";

export type FindSavedTrackerDestination = (url: string) => Promise<string | undefined>;

export function initFindSavedTrackerDestination(deps: { findIdentityRow: FindIdentityRow }): FindSavedTrackerDestination {
	const replaySaveIdentity = initResolveSaveIdentity({
		validateUrl: validateSaveableUrl,
		findIdentityRow: deps.findIdentityRow,
		claimAlias: async () => {},
		resolveWrapperTarget: neverResolveWrapperTarget,
		now: () => new Date(),
	});

	return async (url) => {
		const replayed = await replaySaveIdentity(url);
		if (replayed.status !== "resolved" || replayed.originalUrl === url) return undefined;
		return replayed.originalUrl;
	};
}
