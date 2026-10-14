import { canonicalIdentityOf } from "@packages/article-resource-unique-id";
import {
	isWrapperUrl,
	type SaveableUrlResult,
	type ValidateSaveableUrl,
	stripRedirectAddedParams,
	unwrapWrapperUrl,
	validateSaveableUrl,
	withNewSavePreparation,
	type WrapperFamily,
	wrapperFamilyOf,
} from "@packages/domain/article";
import type { ClaimCanonicalAlias, FindIdentityRow } from "@packages/provider-contracts/article-store";
import type { SaveIdentityResult } from "@packages/provider-contracts/article-freshness";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";
import { initResolveWrapperOriginal } from "./resolve-wrapper-original";

export type ResolveSaveIdentity = (url: string) => Promise<SaveIdentityResult>;

const OWN_ORIGINAL_SAVE_FAMILIES: ReadonlySet<WrapperFamily> = new Set(["archive-snapshot"]);

export function cleanWrapperTarget(params: { wrapperUrl: string; targetUrl: string }): SaveableUrlResult {
	return withNewSavePreparation(validateSaveableUrl)(unwrapWrapperUrl(stripRedirectAddedParams(params)).url);
}

export interface ResolveSaveIdentityDependencies {
	validateUrl: ValidateSaveableUrl;
	findIdentityRow: FindIdentityRow;
	claimAlias: ClaimCanonicalAlias;
	resolveWrapperTarget: ResolveWrapperTarget;
	now: () => Date;
}

export function initResolveSaveIdentity(deps: ResolveSaveIdentityDependencies): ResolveSaveIdentity {
	const resolveOriginal = initResolveWrapperOriginal(deps);
	return async (submittedUrl) => {
		const recovered = await resolveOriginal({ url: submittedUrl, useStoredBinding: true });
		if (recovered.status === "unresolved") return recovered;
		if (
			recovered.status === "own-original" &&
			(!OWN_ORIGINAL_SAVE_FAMILIES.has(recovered.family) || canonicalIdentityOf(recovered.originalUrl) !== canonicalIdentityOf(submittedUrl))
		) {
			return { status: "unresolved" };
		}
		const row = await deps.findIdentityRow(recovered.originalUrl);
		const url = row.kind === "alias" ? row.targetUrl : recovered.originalUrl;
		const owner = row.kind === "alias" ? await deps.findIdentityRow(url) : row;
		if (owner.kind === "alias") return { status: "unresolved" };
		const originalUrl = owner.kind === "article" ? owner.originalUrl ?? url : url;
		const validated = withNewSavePreparation(deps.validateUrl)(originalUrl);
		if (validated.status === "ERROR" || (isWrapperUrl(originalUrl) && canonicalIdentityOf(originalUrl) !== canonicalIdentityOf(recovered.originalUrl))) {
			return { status: "unresolved" };
		}
		const sourceBinding =
			recovered.status === "resolved" && recovered.contentSourceUrl !== undefined && canonicalIdentityOf(recovered.originalUrl) === canonicalIdentityOf(originalUrl)
				? { contentSourceUrl: recovered.contentSourceUrl, sourceOriginalUrl: originalUrl }
				: undefined;
		if (wrapperFamilyOf(submittedUrl) !== undefined && submittedUrl !== url) {
			await deps.claimAlias({ aliasUrl: submittedUrl, targetOriginalUrl: url, sourceBinding, now: deps.now() });
		}
		const identity = { status: "resolved", url, originalUrl } as const;
		return sourceBinding === undefined ? identity : { ...identity, ...sourceBinding };
	};
}
