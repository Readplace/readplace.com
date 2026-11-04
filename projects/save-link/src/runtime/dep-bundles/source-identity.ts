import assert from "node:assert";
import {
	DEFAULT_CRAWL_HEADERS,
	fallbackLinkTarget,
	initFetchRedirectHop,
	initFetchTrackerHop,
	initResolveAppleNewsStoryUrl,
	type CrawlFetch,
} from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import type { FindIdentityRow, RepairWrapperIdentity } from "@packages/provider-contracts/article-store";
import {
	WRAPPER_RESOLVE_BUDGETS,
	initResolveWrapperTarget,
	initVerifyWrapperSource,
	initPrepareArticleIdentity,
	type ResolveChallengedTracker,
	type VerifyWrapperSource,
} from "@packages/save-article";
import type { Logger } from "@packages/logger";
import { initResolveCandidateOriginal } from "../domain/select-content/resolve-candidate-original";

export function initSourceIdentityDepBundle(deps: {
	findIdentityRow: FindIdentityRow;
	repairWrapperIdentity: RepairWrapperIdentity;
	crawlFetch: CrawlFetch;
	resolveChallengedTracker: ResolveChallengedTracker;
	logger: Logger;
}) {
	const resolveWrapperTarget = initResolveWrapperTarget({
		fetchRedirectHop: initFetchRedirectHop({ fetch: globalThis.fetch, isBlocked: isBlockedIpAddress }),
		fetchTrackerHop: initFetchTrackerHop({ fetch: globalThis.fetch, isBlocked: isBlockedIpAddress, pageTarget: fallbackLinkTarget }),
		resolveChallengedTracker: deps.resolveChallengedTracker,
		resolveAppleNewsStoryUrl: initResolveAppleNewsStoryUrl({ crawlFetch: deps.crawlFetch, logError: deps.logger.error.bind(deps.logger) }),
		headers: DEFAULT_CRAWL_HEADERS,
		...WRAPPER_RESOLVE_BUDGETS,
		logger: deps.logger,
	});
	const prepareArticleIdentity = initPrepareArticleIdentity({ findIdentityRow: deps.findIdentityRow, resolveWrapperTarget, repairWrapperIdentity: deps.repairWrapperIdentity });
	return {
		resolveWrapperTarget,
		verifyWrapperSource: initVerifyWrapperSource({ findIdentityRow: deps.findIdentityRow, resolveWrapperTarget }),
		prepareArticleIdentity,
		resolveOriginalUrl: async (url: string) => {
			const identity = await prepareArticleIdentity(url);
			assert(identity.status === "resolved", "candidate original identity is unresolved");
			return identity.originalUrl;
		},
	};
}

export function initSelectionSourceIdentity(deps: {
	findIdentityRow: FindIdentityRow;
}): { verifyWrapperSource: VerifyWrapperSource; resolveOriginalUrl: (url: string) => Promise<string> } {
	const verifyWrapperSource: VerifyWrapperSource = (params) => initVerifyWrapperSource({
		findIdentityRow: deps.findIdentityRow,
		resolveWrapperTarget: async () => params.claimedOriginalUrl === undefined ? undefined : { url: params.claimedOriginalUrl },
	})(params);
	return { verifyWrapperSource, resolveOriginalUrl: initResolveCandidateOriginal({ findIdentityRow: deps.findIdentityRow }) };
}
