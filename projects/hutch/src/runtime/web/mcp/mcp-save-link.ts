import assert from "node:assert";
import { newSaveAttemptId, type withNewSavePreparation } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type { initFileArticleIntoReadlist, initSaveArticleAtReadlistTop } from "@packages/save-article";
import type { AppDependencies } from "../../server";
import type { initResolveMcpSaveProvenance } from "../shared/save-provenance";
import type { McpServerDeps } from "./mcp-ports.types";
import type { initResolveReadlistMembership } from "./readlist-membership";
import type { initResolveSaveAccess } from "./save-access";

export function initMcpSaveLink(
	deps: Pick<AppDependencies, "refreshArticleIfStale" | "publishSubmitLink" | "logError" | "baseUrl"> & {
		resolveSaveAccess: ReturnType<typeof initResolveSaveAccess>;
		validateNewSaveUrl: ReturnType<typeof withNewSavePreparation>;
		resolveMcpSaveProvenance: ReturnType<typeof initResolveMcpSaveProvenance>;
		saveArticleAtReadlistTop: ReturnType<typeof initSaveArticleAtReadlistTop>;
		fileArticleIntoReadlist: ReturnType<typeof initFileArticleIntoReadlist>;
		resolveReadlistMembership: ReturnType<typeof initResolveReadlistMembership>;
	},
): McpServerDeps["saveLink"] {
	const {
		resolveSaveAccess,
		validateNewSaveUrl,
		resolveMcpSaveProvenance,
		saveArticleAtReadlistTop,
		fileArticleIntoReadlist,
		resolveReadlistMembership,
	} = deps;
	return async ({ userId, url, readlists, oauthClientId }) => {
		const access = await resolveSaveAccess(userId);
		if (!access.allowed) {
			return { ok: false, message: access.message };
		}
		const validation = validateNewSaveUrl(url);
		if (validation.status === "ERROR") {
			return { ok: false, message: validation.error.message };
		}
		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			const provenance = await resolveMcpSaveProvenance(oauthClientId);
			const saveAttemptId = newSaveAttemptId();
			if (freshness.action === "unresolved") {
				for (const readlist of new Set([DEFAULT_READLIST_SLUG, ...readlists])) {
					await deps.publishSubmitLink({ userId, url: validation.url, readlist, provenance, saveTrigger: "manual", saveAttemptId });
				}
				return { ok: true, pending: true };
			}
			const { saved } = await saveArticleAtReadlistTop({
				saveAttemptId,
				userId,
				url: validation.url,
				freshness,
				provenance,
				saveTrigger: "manual",
			});
			for (const readlist of readlists) {
				if (readlist === DEFAULT_READLIST_SLUG) continue;
				await fileArticleIntoReadlist({ userId, readlist, article: saved, provenance });
			}
			const membership = await resolveReadlistMembership({ userId, urls: [saved.url] });
			const filedInto = membership.get(saved.url);
			assert(filedInto, "a saved article must have readlist membership");
			return {
				ok: true,
				id: saved.id.value,
				title: saved.metadata.title,
				filedInto,
			};
		} catch (error) {
			deps.logError(
				"MCP save_link failed",
				error instanceof Error ? error : undefined,
			);
			return {
				ok: false,
				message: `Could not save the link — something went wrong on Readplace's side. Try again in a moment, or save it from your readlist at ${deps.baseUrl}/queue.`,
			};
		}
	};
}
