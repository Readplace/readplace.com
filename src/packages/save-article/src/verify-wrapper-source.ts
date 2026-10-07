import { canonicalIdentityOf } from "@packages/article-resource-unique-id";
import { isWrapperUrl, validateSaveableUrl, withNewSavePreparation } from "@packages/domain/article";
import type { FindIdentityRow } from "@packages/provider-contracts/article-store";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";
import { initResolveWrapperOriginal } from "./resolve-wrapper-original";

export type VerifyWrapperSource = (params: {
	articleUrl: string;
	sourceUrl: string;
	claimedOriginalUrl?: string;
}) => Promise<{ originalUrl: string; sourceUrl: string } | undefined>;

export function initVerifyWrapperSource(deps: {
	findIdentityRow: FindIdentityRow;
	resolveWrapperTarget: ResolveWrapperTarget;
}): VerifyWrapperSource {
	const resolveOriginal = initResolveWrapperOriginal({ ...deps, validateUrl: validateSaveableUrl });
	return async ({ articleUrl, sourceUrl, claimedOriginalUrl }) => {
		const source = await resolveOriginal({ url: sourceUrl, useStoredBinding: false });
		if (source.status === "unresolved" || source.contentSourceUrl === undefined) return undefined;
		const row = await deps.findIdentityRow(articleUrl);
		if (row.kind !== "article") return undefined;
		const originalUrl = row.originalUrl ?? articleUrl;
		if (isWrapperUrl(originalUrl) || validateSaveableUrl(originalUrl).status === "ERROR") return undefined;
		const identity = canonicalIdentityOf(originalUrl);
		if (canonicalIdentityOf(source.originalUrl) !== identity) return undefined;
		if (claimedOriginalUrl !== undefined) {
			const claimed = withNewSavePreparation(validateSaveableUrl)(claimedOriginalUrl);
			if (claimed.status === "ERROR" || canonicalIdentityOf(claimed.url) !== identity) return undefined;
		}
		return { originalUrl, sourceUrl: source.contentSourceUrl };
	};
}
