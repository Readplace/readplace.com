import assert from "node:assert";
import {
	DEFAULT_CRAWL_HEADERS,
	initFetchRedirectHop,
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
	type VerifyWrapperSource,
} from "@packages/save-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { initResolveCandidateOriginal } from "../domain/select-content/candidate-provenance";

export function initSourceIdentityDepBundle(deps: {
	findIdentityRow: FindIdentityRow;
	repairWrapperIdentity: RepairWrapperIdentity;
	crawlFetch: CrawlFetch;
	logger: HutchLogger;
}) {
	const resolveWrapperTarget = initResolveWrapperTarget({
		fetchRedirectHop: initFetchRedirectHop({ fetch: globalThis.fetch, isBlocked: isBlockedIpAddress }),
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
