import type { AppDependencies } from "../../server";
import type { McpServerDeps } from "./mcp-ports.types";
import { initMcpSaveLink } from "./mcp-save-link";
import { initRecordMcpHandshake, initRecordMcpToolCall } from "./mcp-analytics";
import { initMcpArticleOperations } from "./article-operations";
import type { initMcpReadlistOperations } from "./readlist-operations";

export function mcpServerDependenciesFrom(
	deps: Pick<AppDependencies, "now" | "logError" | "findReadlistArticles" | "findArticlesByUser" | "findArticlesAcrossReadlists" | "readArticleContent" | "findGeneratedSummary" | "findRelatedArticles" | "updateArticleStatusAcrossReadlists" | "recordEngagementActivity" | "refreshArticleIfStale" | "publishSubmitLink" | "baseUrl">,
	built: {
		appOrigin: McpServerDeps["appOrigin"];
		resolveToolAccess: McpServerDeps["resolveToolAccess"];
		readlistOperations: ReturnType<typeof initMcpReadlistOperations>;
		recordUngatedAnalyticsEvent: Parameters<typeof initRecordMcpToolCall>[0]["recordUngatedAnalyticsEvent"];
		resolveOwnedArticle: Parameters<typeof initMcpArticleOperations>[0]["resolveOwnedArticle"];
	} & Pick<
		Parameters<typeof initMcpSaveLink>[0],
		"resolveSaveAccess" | "validateNewSaveUrl" | "resolveMcpSaveProvenance" | "saveArticleAtReadlistTop" | "fileArticleIntoReadlist" | "resolveReadlistMembership"
	>,
): McpServerDeps {
	const {
		appOrigin,
		resolveToolAccess,
		readlistOperations,
		resolveSaveAccess,
		recordUngatedAnalyticsEvent,
		validateNewSaveUrl,
		resolveMcpSaveProvenance,
		saveArticleAtReadlistTop,
		fileArticleIntoReadlist,
		resolveReadlistMembership,
		resolveOwnedArticle,
	} = built;
	return {
		appOrigin,
		resolveToolAccess,
		listReadlists: readlistOperations.listReadlists,
		createReadlist: async (params) => {
			const access = await resolveSaveAccess(params.userId);
			if (!access.allowed) return { status: "access_denied", message: access.message };
			return readlistOperations.createReadlist(params);
		},
		addToReadlist: async (params) => {
			const access = await resolveSaveAccess(params.userId);
			if (!access.allowed) return { status: "access_denied", message: access.message };
			return readlistOperations.addToReadlist(params);
		},
		recordToolCall: initRecordMcpToolCall({
			recordUngatedAnalyticsEvent,
			now: deps.now,
		}),
		recordHandshake: initRecordMcpHandshake({
			recordUngatedAnalyticsEvent,
			now: deps.now,
		}),
		logError: deps.logError,
		saveLink: initMcpSaveLink({
			resolveSaveAccess,
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
