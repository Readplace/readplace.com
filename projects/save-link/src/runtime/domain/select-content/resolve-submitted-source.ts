import assert from "node:assert";
import { canonicalIdentityOf } from "@packages/article-resource-unique-id";
import { isWrapperUrl } from "@packages/domain/article";
import type { VerifyWrapperSource } from "@packages/save-article";

export function initResolveSubmittedSource(deps: {
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
}) {
	return async (params: { url: string; sourceUrl: string; sourceOriginalUrl: string }) => {
		const originalUrl = await deps.resolveOriginalUrl(params.url);
		const captured = canonicalIdentityOf(params.sourceUrl);
		const ownLink = captured === canonicalIdentityOf(originalUrl) || captured === canonicalIdentityOf(params.url);
		if (!ownLink) {
			assert(isWrapperUrl(params.sourceUrl), "Captured source does not match article identity");
			const verified = await deps.verifyWrapperSource({ articleUrl: params.url, sourceUrl: params.sourceUrl, claimedOriginalUrl: params.sourceOriginalUrl });
			assert(verified, "Captured wrapper source does not match article identity");
		}
		return originalUrl;
	};
}
