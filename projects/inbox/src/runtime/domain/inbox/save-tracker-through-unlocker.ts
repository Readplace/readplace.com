import assert from "node:assert/strict";
import { validateSaveableUrl } from "@packages/domain/article";
import type { ClaimCanonicalAlias, FindIdentityRow } from "@packages/provider-contracts/article-store";
import { initResolveSaveIdentity } from "@packages/save-article";

export async function saveTrackerThroughUnlocker(params: {
	store: { findIdentityRow: FindIdentityRow; claimAlias: ClaimCanonicalAlias };
	tracker: string;
	destination: string;
}): Promise<void> {
	const save = initResolveSaveIdentity({
		validateUrl: validateSaveableUrl,
		findIdentityRow: params.store.findIdentityRow,
		claimAlias: params.store.claimAlias,
		resolveWrapperTarget: async (url) => {
			assert.equal(url, params.tracker, "the Unlocker is asked only for the saved tracker");
			return { url: params.destination, contentSourceUrl: params.tracker };
		},
		now: () => new Date("2026-11-18T10:00:00.000Z"),
	});
	const identity = await save(params.tracker);
	assert.equal(identity.status, "resolved", "the save must resolve the tracker");
}
