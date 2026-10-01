import {
	type SaveableUrlResult,
	stripRedirectAddedParams,
	unwrapWrapperUrl,
	validateSaveableUrl,
	withNewSavePreparation,
	wrapperFamilyOf,
} from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ClaimCanonicalAlias, FindIdentityRow } from "@packages/provider-contracts/article-store";
import { locateStoredIdentity } from "./resolve-canonical-identity";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";

export type SaveIdentity = { url: string; contentSourceUrl?: string };

/** The identity a save must be keyed on. Unlike the read-side resolver this may
 * reach the network (through `resolveWrapperTarget`) for a wrapper nothing is
 * stored for yet, and claims `id(wrapper) → identity` so every later lookup of
 * the wrapper lands on the same article. `contentSourceUrl` is the snapshot an
 * archive save keeps reading its content from. */
export type ResolveSaveIdentity = (url: string) => Promise<SaveIdentity>;

export function cleanWrapperTarget(params: { wrapperUrl: string; targetUrl: string }): SaveableUrlResult {
	return withNewSavePreparation(validateSaveableUrl)(unwrapWrapperUrl(stripRedirectAddedParams(params)).url);
}

export interface ResolveSaveIdentityDependencies {
	findIdentityRow: FindIdentityRow;
	claimAlias: ClaimCanonicalAlias;
	resolveWrapperTarget: ResolveWrapperTarget;
	now: () => Date;
	logger: HutchLogger;
}

export function initResolveSaveIdentity(deps: ResolveSaveIdentityDependencies): ResolveSaveIdentity {
	return async (url) => {
		const stored = await locateStoredIdentity(deps.findIdentityRow, url);
		const family = wrapperFamilyOf(stored.url);
		if (stored.row !== "absent" || family === undefined) {
			return { url: stored.url, contentSourceUrl: stored.contentSourceUrl };
		}
		const wrapper = stored.url;
		const target = await deps.resolveWrapperTarget(wrapper);
		if (target === undefined) return { url: wrapper };
		const cleaned = cleanWrapperTarget({ wrapperUrl: wrapper, targetUrl: target });
		if (cleaned.status === "ERROR") {
			deps.logger.warn(
				JSON.stringify({
					stream: "wrapper-resolve",
					family,
					wrapperHost: new URL(wrapper).hostname,
					outcome: "target-rejected",
					code: cleaned.error.code,
				}),
			);
			return { url: wrapper };
		}
		const targetRow = await deps.findIdentityRow(cleaned.url);
		const identity = targetRow.kind === "alias" ? targetRow.targetUrl : cleaned.url;
		const contentSourceUrl = family === "archive-snapshot" ? wrapper : undefined;
		const claim = await deps.claimAlias({ aliasUrl: wrapper, targetOriginalUrl: identity, now: deps.now() });
		if (claim === "claimed") return { url: identity, contentSourceUrl };
		const occupant = await deps.findIdentityRow(wrapper);
		if (occupant.kind === "alias") return { url: occupant.targetUrl, contentSourceUrl };
		return { url: wrapper };
	};
}
