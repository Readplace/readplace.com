import type { AuthenticatedUserId } from "@packages/domain/user";
import type { AppDependencies } from "../../server";
import type { McpServerDeps } from "./mcp-ports.types";
import { initMcpSaveLink } from "./mcp-save-link";
import { initRecordMcpHandshake, initRecordMcpToolCall } from "./mcp-analytics";
import { initMcpArticleOperations } from "./article-operations";
import type { initMcpReadlistOperations } from "./readlist-operations";
import type { initMcpHighlightOperations } from "./highlight-operations";

interface AccessDenied {
	readonly status: "access_denied";
	readonly message: string;
}

export function mcpServerDependenciesFrom(
	deps: Pick<AppDependencies, "now" | "logError" | "findReadlistArticles" | "findArticlesByUser" | "findArticlesAcrossReadlists" | "readArticleContent" | "findGeneratedSummary" | "findRelatedArticles" | "updateArticleStatusAcrossReadlists" | "recordEngagementActivity" | "refreshArticleIfStale" | "publishSubmitLink" | "baseUrl" | "consumeRateLimit" | "rateLimitRules">,
	built: {
		appOrigin: McpServerDeps["appOrigin"];
		resolveToolAccess: McpServerDeps["resolveToolAccess"];
		readlistOperations: ReturnType<typeof initMcpReadlistOperations>;
		highlightOperations: ReturnType<typeof initMcpHighlightOperations>;
		recordUngatedAnalyticsEvent: Parameters<typeof initRecordMcpToolCall>[0]["recordUngatedAnalyticsEvent"];
		resolveOwnedArticle: Parameters<typeof initMcpArticleOperations>[0]["resolveOwnedArticle"];
	} & Pick<
		Parameters<typeof initMcpSaveLink>[0],
		"resolveSaveAccess" | "claimDailySaves" | "validateNewSaveUrl" | "resolveMcpSaveProvenance" | "saveArticleAtReadlistTop" | "fileArticleIntoReadlist" | "resolveReadlistMembership"
	>,
): McpServerDeps {
	const {
		appOrigin,
		resolveToolAccess,
		readlistOperations,
		highlightOperations,
		resolveSaveAccess,
		claimDailySaves,
		recordUngatedAnalyticsEvent,
		validateNewSaveUrl,
		resolveMcpSaveProvenance,
		saveArticleAtReadlistTop,
		fileArticleIntoReadlist,
		resolveReadlistMembership,
		resolveOwnedArticle,
	} = built;
	function gated<Params extends { userId: AuthenticatedUserId }, Result>(
		op: (params: Params) => Promise<Result>,
	): (params: Params) => Promise<Result | AccessDenied> {
		return async (params) => {
			const access = await resolveSaveAccess(params.userId);
			if (!access.allowed) return { status: "access_denied", message: access.message };
			return op(params);
		};
	}
	return {
		appOrigin,
		resolveToolAccess,
		consumeRateLimit: deps.consumeRateLimit,
		mcpCallRule: deps.rateLimitRules.mcpCall,
		listReadlists: readlistOperations.listReadlists,
		createReadlist: gated(readlistOperations.createReadlist),
		addToReadlist: gated(readlistOperations.addToReadlist),
		recordToolCall: initRecordMcpToolCall({
			recordUngatedAnalyticsEvent,
			now: deps.now,
		}),
		recordHandshake: initRecordMcpHandshake({
			recordUngatedAnalyticsEvent,
			now: deps.now,
		}),
		logError: deps.logError,
		listHighlights: highlightOperations.listHighlights,
		createHighlight: gated(highlightOperations.createHighlight),
		saveLink: initMcpSaveLink({
			now: deps.now,
			resolveSaveAccess,
			claimDailySaves,
			validateNewSaveUrl,
			refreshArticleIfStale: deps.refreshArticleIfStale,
			resolveMcpSaveProvenance,
			publishSubmitLink: deps.publishSubmitLink,
			saveArticleAtReadlistTop,
			fileArticleIntoReadlist,
			resolveReadlistMembership,
			logError: deps.logError,
			baseUrl: deps.baseUrl,
		}),
		...initMcpArticleOperations({
			resolveOwnedArticle,
			resolveReadlistMembership,
			findReadlistArticles: deps.findReadlistArticles,
			findArticlesByUser: deps.findArticlesByUser,
			findArticlesAcrossReadlists: deps.findArticlesAcrossReadlists,
			readArticleContent: deps.readArticleContent,
			findGeneratedSummary: deps.findGeneratedSummary,
			findRelatedArticles: deps.findRelatedArticles,
			updateArticleStatusAcrossReadlists: deps.updateArticleStatusAcrossReadlists,
			recordEngagementActivity: deps.recordEngagementActivity,
			now: deps.now,
		}),
	};
}
