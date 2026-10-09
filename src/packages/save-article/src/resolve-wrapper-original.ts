import {
	isArchiveHost,
	stripRedirectAddedParams,
	unwrapWrapperUrl,
	type ValidateSaveableUrl,
	withNewSavePreparation,
	wrapperFamilyOf,
} from "@packages/domain/article";
import type { FindIdentityRow } from "@packages/provider-contracts/article-store";
import type { UnresolvedSaveIdentity } from "@packages/provider-contracts/article-freshness";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";

type OriginalResult =
	| { status: "resolved"; originalUrl: string; contentSourceUrl?: string }
	| { status: "own-original"; originalUrl: string }
	| UnresolvedSaveIdentity;

export function initResolveWrapperOriginal(deps: {
	validateUrl: ValidateSaveableUrl;
	findIdentityRow: FindIdentityRow;
	resolveWrapperTarget: ResolveWrapperTarget;
}) {
	return async (params: { url: string; useStoredBinding: boolean }): Promise<OriginalResult> => {
		let current = params.url;
		let contentSourceUrl: string | undefined;
		for (let depth = 0; depth < 8; depth += 1) {
			const prepared = withNewSavePreparation(deps.validateUrl)(current);
			if (prepared.status === "ERROR") {
				return { status: "unresolved" };
			}
			current = prepared.url;
			const family = wrapperFamilyOf(current);
			if (family === undefined) {
				return isArchiveHost(current)
					? { status: "unresolved" }
					: { status: "resolved", originalUrl: current, contentSourceUrl };
			}
			if (
				contentSourceUrl !== undefined &&
				(family === "share-intent" || family === "archive-outbound" || (family !== "archive-snapshot" && isArchiveHost(contentSourceUrl)))
			) contentSourceUrl = undefined;
			const unwrapped = unwrapWrapperUrl(current);
			if (unwrapped.url !== current) {
				contentSourceUrl ??= unwrapped.contentSourceUrl;
				current = unwrapped.url;
				continue;
			}
			if (family === "archive-outbound") return { status: "unresolved" };
			if (params.useStoredBinding) {
				const row = await deps.findIdentityRow(current);
				if (row.kind !== "absent" && row.sourceBinding !== undefined) {
					contentSourceUrl ??= row.sourceBinding.contentSourceUrl;
					current = row.sourceBinding.sourceOriginalUrl;
					continue;
				}
			}
			const target = await deps.resolveWrapperTarget(current);
			if (target === undefined) {
				return { status: "unresolved" };
			}
			if ("ownOriginal" in target) return { status: "own-original", originalUrl: current };
			contentSourceUrl ??= target.contentSourceUrl ?? current;
			current = stripRedirectAddedParams({ wrapperUrl: current, targetUrl: target.url });
		}
		return { status: "unresolved" };
	};
}
