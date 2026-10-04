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
import { type StoredIdentity, locateStoredIdentity } from "./resolve-canonical-identity";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";

export type SaveIdentity = { url: string; contentSourceUrl?: string };

export type ResolveSaveIdentity = (url: string) => Promise<SaveIdentity>;

export function cleanWrapperTarget(params: { wrapperUrl: string; targetUrl: string }): SaveableUrlResult {
	return withNewSavePreparation(validateSaveableUrl)(unwrapWrapperUrl(stripRedirectAddedParams(params)).url);
}

async function locateSaveIdentity(findIdentityRow: FindIdentityRow, url: string): Promise<StoredIdentity> {
	const unwrapped = unwrapWrapperUrl(url);
	if (unwrapped.url === url) return locateStoredIdentity(findIdentityRow, url);
	const prepared = withNewSavePreparation(validateSaveableUrl)(unwrapped.url);
	if (prepared.status === "ERROR") {
		const direct = await findIdentityRow(url);
		return direct.kind === "alias" ? { url: direct.targetUrl, row: "alias-target" } : { url, row: direct.kind };
	}
	const original = await findIdentityRow(prepared.url);
	const { contentSourceUrl } = unwrapped;
	if (original.kind === "alias") return { url: original.targetUrl, row: "alias-target", contentSourceUrl };
	return { url: prepared.url, row: original.kind, contentSourceUrl };
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
		const stored = await locateSaveIdentity(deps.findIdentityRow, url);
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
