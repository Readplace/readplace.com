import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ARTICLE_HIGHLIGHT_ID_PREFIX,
	HighlightIdSchema,
	HighlightNoteSchema,
	type ReaderArticleHashId,
	ReaderArticleHashIdSchema,
	type SavedArticle,
} from "@packages/domain/article";
import { viewerOf } from "@packages/viewer-identity";
import { type HighlightNoteSavedEvent, hashIp } from "@packages/web-analytics";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { ANALYTICS_EVENTS, STREAMS } from "../../../observability/events";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import {
	highlightPathsFor,
	requireHighlightFeature,
} from "./highlight-feature";
import type { ReadlistDependencies } from "./readlist-dependencies.types";

const UpdateHighlightNoteBodySchema = z.object({
	note: HighlightNoteSchema,
});

function noteActionOf(change: {
	note: string | undefined;
	hadNote: boolean;
}): HighlightNoteSavedEvent["action"] | undefined {
	if (change.note !== undefined) return change.hadNote ? "edited" : "added";
	return change.hadNote ? "removed" : undefined;
}

export function initHighlightNoteRoutes(
	deps: Pick<
		ReadlistDependencies,
		| "requireWriteAccess"
		| "updateHighlightNote"
		| "recordAnalyticsEvent"
		| "salt"
		| "now"
	>,
	reader: {
		findOwnedArticle: (
			req: Request,
			id: ReaderArticleHashId,
		) => Promise<SavedArticle | null>;
	},
): Router {
	const router = express.Router();

	router.post(
		"/:id/highlights/:highlightId/note",
		requireHighlightFeature,
		requireNotLocked,
		deps.requireWriteAccess,
		express.urlencoded({ extended: false }),
		async (
			req: Request<{ id: string; highlightId: string }>,
			res: Response,
		) => {
			assert(
				req.userId,
				"userId required - route must be protected by requireAuth",
			);
			const userId = req.userId;
			const highlightId = HighlightIdSchema.safeParse(req.params.highlightId);
			const body = UpdateHighlightNoteBodySchema.safeParse(req.body);
			if (!highlightId.success || !body.success) {
				res.status(400).type("html").send("");
				return;
			}
			const id = ReaderArticleHashIdSchema.safeParse(req.params.id);
			const article = id.success
				? await reader.findOwnedArticle(req, id.data)
				: null;
			if (!article) {
				res.status(404).type("html").send("");
				return;
			}
			const { updated, hadNote } = await deps.updateHighlightNote({
				userId,
				url: ArticleResourceUniqueId.parse(article.url).value,
				highlightId: highlightId.data,
				note: body.data.note,
				updatedAt: deps.now(),
			});
			if (!updated) {
				res.status(404).type("html").send("");
				return;
			}
			const action = noteActionOf({ note: body.data.note, hadNote });
			if (action !== undefined) {
				deps.recordAnalyticsEvent(req, {
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.highlightNoteSaved,
					timestamp: deps.now().toISOString(),
					user_id: userId,
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					action,
				});
			}
			const { viewPath } = highlightPathsFor({
				articleId: article.id.value,
				query: req.query,
			});
			res.redirect(
				303,
				`${viewPath}#${ARTICLE_HIGHLIGHT_ID_PREFIX}${highlightId.data}`,
			);
		},
	);

	return router;
}
