import { unwrapWrapperUrl } from "@packages/domain/article";
import type { FindIdentityRow, ResolveCanonicalIdentity } from "@packages/provider-contracts/article-store";

export function initResolveCanonicalIdentity(deps: { findIdentityRow: FindIdentityRow }): ResolveCanonicalIdentity {
	return async (url) => {
		const direct = await deps.findIdentityRow(url);
		if (direct.kind === "article") return url;
		if (direct.kind === "alias") return direct.targetUrl;
		const unwrapped = unwrapWrapperUrl(url).url;
		if (unwrapped === url) return url;
		const original = await deps.findIdentityRow(unwrapped);
		return original.kind === "alias" ? original.targetUrl : unwrapped;
	};
}
