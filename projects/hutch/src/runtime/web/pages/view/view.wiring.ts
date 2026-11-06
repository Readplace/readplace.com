import type { AppDependencies } from "../../../server";
import type { initViewRoutes } from "./view.page";

export function viewDependenciesFrom(
	deps: Pick<AppDependencies, "validateSaveableUrl" | "findArticleByUrl" | "findItemOwner" | "findArticleFreshness" | "findArticleCrawlVersions" | "readArticleContent" | "readArticleImage" | "logError" | "findGeneratedSummary" | "markSummaryPending" | "findArticleCrawlStatus" | "markCrawlPending" | "saveArticleGlobally" | "resolveCanonicalIdentity" | "findIdentityRow" | "resolveFirstVisitIdentity" | "pinContentSource" | "findContentSourceUrl" | "publishSaveAnonymousLink" | "publishStaleCheckRequested" | "consumeRateLimit" | "rateLimitRules" | "now" | "salt">,
	built: Pick<Parameters<typeof initViewRoutes>[0], "appOrigin" | "ownHost" | "secureCookies" | "buildBannerState" | "recordAnalyticsEvent">,
): Parameters<typeof initViewRoutes>[0] {
	const {
		appOrigin,
		ownHost,
		secureCookies,
		buildBannerState,
		recordAnalyticsEvent,
	} = built;
	return {
		validateSaveableUrl: deps.validateSaveableUrl,
		appOrigin,
		ownHost,
		secureCookies,
		findArticleByUrl: deps.findArticleByUrl,
		findItemOwner: deps.findItemOwner,
		findArticleFreshness: deps.findArticleFreshness,
		findArticleCrawlVersions: deps.findArticleCrawlVersions,
		readArticleContent: deps.readArticleContent,
		readArticleImage: deps.readArticleImage,
		logError: deps.logError,
		findGeneratedSummary: deps.findGeneratedSummary,
		markSummaryPending: deps.markSummaryPending,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		saveArticleGlobally: deps.saveArticleGlobally,
		resolveCanonicalIdentity: deps.resolveCanonicalIdentity,
		findIdentityRow: deps.findIdentityRow,
		resolveSaveIdentity: deps.resolveFirstVisitIdentity,
		pinContentSource: deps.pinContentSource,
		findContentSourceUrl: deps.findContentSourceUrl,
		publishSaveAnonymousLink: deps.publishSaveAnonymousLink,
		publishStaleCheckRequested: deps.publishStaleCheckRequested,
		consumeRateLimit: deps.consumeRateLimit,
		viewCrawlRateLimit: deps.rateLimitRules.viewCrawl,
		viewCrawlSignedInRateLimit: deps.rateLimitRules.viewCrawlSignedIn,
		now: deps.now,
		buildBannerState,
		recordAnalyticsEvent,
		salt: deps.salt,
	};
}
