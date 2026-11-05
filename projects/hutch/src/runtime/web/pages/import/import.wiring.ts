import type { AppDependencies } from "../../../server";
import type { initImportSessionRoutes } from "./import.page";

export function importSessionDependenciesFrom(
	deps: Pick<AppDependencies, "importSessionStore" | "extractLinksFromPageUrl" | "recordEngagementActivity" | "updateArticleStatus" | "markCrawlPending" | "markSummaryPending" | "publishUpdateFetchTimestamp" | "publishLinkSaved" | "publishLinkQueued" | "publishQueueEntryCreated" | "refreshArticleIfStaleStored" | "publishSubmitLink" | "allocateSavedAtSequence" | "pinContentSource" | "logError" | "salt" | "now" | "consumeRateLimit" | "rateLimitRules">,
	built: Pick<
		Parameters<typeof initImportSessionRoutes>[0],
		"validateNewSaveUrl" | "secureCookies" | "recordAnalyticsEvent" | "recordUngatedAnalyticsEvent" | "buildBannerState" | "requireNotLocked" | "requireWriteAccess"
	> & { saveArticleWithoutActivity: Parameters<typeof initImportSessionRoutes>[0]["saveArticle"] },
): Parameters<typeof initImportSessionRoutes>[0] {
	const {
		validateNewSaveUrl,
		secureCookies,
		saveArticleWithoutActivity,
		recordAnalyticsEvent,
		recordUngatedAnalyticsEvent,
		buildBannerState,
		requireNotLocked,
		requireWriteAccess,
	} = built;
	return {
		validateNewSaveUrl,
		secureCookies,
		importSessionStore: deps.importSessionStore,
		extractLinksFromPageUrl: deps.extractLinksFromPageUrl,
		saveArticle: saveArticleWithoutActivity,
		recordEngagementActivity: deps.recordEngagementActivity,
		updateArticleStatus: deps.updateArticleStatus,
		markCrawlPending: deps.markCrawlPending,
		markSummaryPending: deps.markSummaryPending,
		publishUpdateFetchTimestamp: deps.publishUpdateFetchTimestamp,
		publishLinkSaved: deps.publishLinkSaved,
		publishLinkQueued: deps.publishLinkQueued,
		publishQueueEntryCreated: deps.publishQueueEntryCreated,
		refreshArticleIfStale: deps.refreshArticleIfStaleStored,
		publishSubmitLink: deps.publishSubmitLink,
		allocateSavedAtSequence: deps.allocateSavedAtSequence,
		pinContentSource: deps.pinContentSource,
		logError: deps.logError,
		recordAnalyticsEvent,
		recordUngatedAnalyticsEvent,
		salt: deps.salt,
		now: deps.now,
		buildBannerState,
		requireNotLocked,
		requireWriteAccess,
		consumeRateLimit: deps.consumeRateLimit,
		importRateLimit: deps.rateLimitRules.import,
		importFromUrlRateLimit: deps.rateLimitRules.importFromUrl,
	};
}
