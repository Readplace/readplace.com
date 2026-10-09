import { canonicalIdentityOf } from "@packages/article-resource-unique-id";
import { isArchiveHost, isWrapperUrl, validateSaveableUrl } from "@packages/domain/article";
import type { SaveIdentityResult } from "@packages/provider-contracts/article-freshness";
import type { FindIdentityRow, RepairWrapperIdentity } from "@packages/provider-contracts/article-store";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";
import { initResolveWrapperOriginal } from "./resolve-wrapper-original";

export type PrepareArticleIdentity = (articleUrl: string) => Promise<SaveIdentityResult>;

export function initPrepareArticleIdentity(deps: {
	findIdentityRow: FindIdentityRow;
	resolveWrapperTarget: ResolveWrapperTarget;
	repairWrapperIdentity: RepairWrapperIdentity;
}): PrepareArticleIdentity {
	const resolveOriginal = initResolveWrapperOriginal({ ...deps, validateUrl: validateSaveableUrl });
	return async (articleUrl) => {
		const row = await deps.findIdentityRow(articleUrl);
		if (row.kind !== "article") return { status: "unresolved" };
		const effective = row.originalUrl ?? articleUrl;
		if (validateSaveableUrl(effective).status === "ERROR") return { status: "unresolved" };
		if (!isWrapperUrl(effective)) {
			const identity = { status: "resolved", url: articleUrl, originalUrl: effective } as const;
			return row.sourceBinding === undefined ? identity : { ...identity, ...row.sourceBinding };
		}
		const recovered = await resolveOriginal({ url: effective, useStoredBinding: false });
		if (recovered.status === "unresolved") return recovered;
		if (recovered.status === "own-original") {
			return canonicalIdentityOf(recovered.originalUrl) === canonicalIdentityOf(effective)
				? { status: "resolved", url: articleUrl, originalUrl: effective }
				: { status: "unresolved" };
		}
		const repaired = await deps.repairWrapperIdentity({ articleUrl, expectedOriginalUrl: effective, originalUrl: recovered.originalUrl, contentSourceUrl: recovered.contentSourceUrl !== undefined && isArchiveHost(recovered.contentSourceUrl) ? recovered.contentSourceUrl : undefined });
		if (!repaired) return { status: "unresolved" };
		const identity = { status: "resolved", url: articleUrl, originalUrl: recovered.originalUrl } as const;
		return recovered.contentSourceUrl === undefined ? identity : { ...identity, contentSourceUrl: recovered.contentSourceUrl, sourceOriginalUrl: recovered.originalUrl };
	};
}
