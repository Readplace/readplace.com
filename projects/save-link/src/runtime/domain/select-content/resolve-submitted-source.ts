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
		if (isWrapperUrl(params.sourceUrl)) {
			const verified = await deps.verifyWrapperSource({ articleUrl: params.url, sourceUrl: params.sourceUrl, claimedOriginalUrl: params.sourceOriginalUrl });
			assert(verified, "Captured wrapper source does not match article identity");
		} else {
			const captured = canonicalIdentityOf(params.sourceUrl);
			assert(captured === canonicalIdentityOf(originalUrl) || captured === canonicalIdentityOf(params.url), "Captured source does not match article identity");
		}
		return originalUrl;
	};
}
