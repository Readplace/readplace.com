import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ARTICLE_HIGHLIGHT_ID_PREFIX,
	HighlightIdSchema,
	type ReaderArticleHashId,
	ReaderArticleHashIdSchema,
	type SavedArticle,
	viewerFor,
} from "@packages/domain/article";
import {
	collectTextChunks,
	normaliseText,
} from "@packages/domain/article/highlight";
import { viewerOf } from "@packages/viewer-identity";
import { hashIp } from "@packages/web-analytics";
import { renderToast } from "@packages/web-shell";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { parseHTML } from "linkedom";
import { z } from "zod";
import { ANALYTICS_EVENTS, STREAMS } from "../../../observability/events";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { prepareReaderContent } from "../../shared/article-body/reader-slot/reader-content";
import type { ReaderSectionInput } from "../../shared/article-body/reader-slot/section-pages";
import { servedContentHash } from "../../shared/article-body/reader-slot/served-content-hash";
import {
	highlightFeatureEnabled,
	highlightPathsFor,
} from "./highlight-feature";
import type { RenderOwnerReader } from "./reader-page.page";
import type { ReadlistDependencies } from "./readlist-dependencies.types";

const CreateHighlightBodySchema = z
	.object({
		exact: z.string().min(1),
		start: z.coerce.number().int().min(0),
		end: z.coerce.number().int().min(0),
		origin: z.enum(["mouse"]),
	})
	.refine((body) => body.start <= body.end);

const TOAST_DISMISS_MS = 6000;

const OUTCOME_TOASTS = {
	"passage-changed": "That passage changed; select it again",
	"too-long": "Select a shorter passage",
	cancelled: "That highlight just changed; try again",
} as const;

function servedTextOf(html: string): string {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="served-highlight-root">${html}</div></body></html>`,
	);
	const root = document.querySelector("div#served-highlight-root");
	assert(root, "parseHTML must produce the served-highlight wrapper div");
	return normaliseText(collectTextChunks<Node>(root)).text;
}

export function initHighlightRoutes(
	deps: Pick<
		ReadlistDependencies,
		| "requireWriteAccess"
		| "readArticleContent"
		| "readCanonicalSnapshot"
		| "createReaderHighlight"
		| "deleteHighlight"
		| "recordAnalyticsEvent"
		| "salt"
		| "now"
		| "appOrigin"
	>,
	reader: {
		findOwnedArticle: (
			req: Request,
			id: ReaderArticleHashId,
		) => Promise<SavedArticle | null>;
		renderOwnerReader: RenderOwnerReader;
		readerSectionFor: (req: Request, articleId: string) => ReaderSectionInput;
	},
): Router {
	const router = express.Router();

	const flagOn = (req: Request, _res: Response, next: NextFunction): void => {
		next(highlightFeatureEnabled(req.query) ? undefined : "router");
	};

	const ownedArticleOf = async (
		req: Request<{ id: string }>,
	): Promise<SavedArticle | null> => {
		const id = ReaderArticleHashIdSchema.safeParse(req.params.id);
		return id.success ? reader.findOwnedArticle(req, id.data) : null;
	};

	const toastOf = (message: string): string =>
		renderToast({ message, dismissMs: TOAST_DISMISS_MS, actions: [] });

	router.post(
		"/:id/highlights",
		flagOn,
		requireNotLocked,
		deps.requireWriteAccess,
		express.urlencoded({ extended: false }),
		async (req: Request<{ id: string }>, res: Response) => {
			assert(
				req.userId,
				"userId required - route must be protected by requireAuth",
			);
			const userId = req.userId;
			const id = ReaderArticleHashIdSchema.safeParse(req.params.id);
			const body = CreateHighlightBodySchema.safeParse(req.body);
			if (!id.success || !body.success) {
				res.status(400).type("html").send("");
				return;
			}
			const article = await reader.findOwnedArticle(req, id.data);
			if (!article) {
				res.status(404).type("html").send("");
				return;
			}
			const stored = await deps.readArticleContent({
				url: article.url,
				viewer: viewerFor(userId),
			});
			if (stored.kind !== "article") {
				await reader.renderOwnerReader(req, res, {
					statusCode: 422,
					toast: toastOf(OUTCOME_TOASTS["passage-changed"]),
					markViewed: false,
				});
				return;
			}
			const prepared = prepareReaderContent({
				content: stored.body,
				appOrigin: deps.appOrigin,
				url: article.url,
				section: reader.readerSectionFor(req, article.id.value),
			});
			const offset = prepared.text.indexOf(servedTextOf(prepared.html));
			assert(
				offset >= 0,
				"the served page's text must be a slice of the whole article's text",
			);
			const snapshot = await deps.readCanonicalSnapshot(article.url);
			const outcome = await deps.createReaderHighlight({
				text: prepared.text,
				contentHash:
					snapshot?.canonicalContentHash ?? servedContentHash(prepared.text),
				candidateId: snapshot?.canonicalCandidateId,
				userId,
				url: ArticleResourceUniqueId.parse(article.url).value,
				exact: body.data.exact,
				start: body.data.start + offset,
				end: body.data.end + offset,
			});
			if (outcome.status === "created" || outcome.status === "merged") {
				deps.recordAnalyticsEvent(req, {
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.highlightCreated,
					timestamp: deps.now().toISOString(),
					user_id: userId,
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					origin: body.data.origin,
				});
				const { viewPath } = highlightPathsFor({
					articleId: article.id.value,
					query: req.query,
				});
				res.redirect(
					303,
					`${viewPath}#${ARTICLE_HIGHLIGHT_ID_PREFIX}${outcome.highlight.highlightId}`,
				);
				return;
			}
			await reader.renderOwnerReader(req, res, {
				statusCode: 422,
				toast: toastOf(OUTCOME_TOASTS[outcome.status]),
				markViewed: false,
			});
		},
	);

	router.post(
		"/:id/highlights/:highlightId/delete",
		flagOn,
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
			if (!highlightId.success) {
				res.status(400).type("html").send("");
				return;
			}
			const article = await ownedArticleOf(req);
			if (!article) {
				res.status(404).type("html").send("");
				return;
			}
			const { deleted } = await deps.deleteHighlight({
				userId,
				url: ArticleResourceUniqueId.parse(article.url).value,
				highlightId: highlightId.data,
			});
			if (!deleted) {
				res.status(404).type("html").send("");
				return;
			}
			deps.recordAnalyticsEvent(req, {
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.highlightDeleted,
				timestamp: deps.now().toISOString(),
				user_id: userId,
				visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
			});
			const { viewPath } = highlightPathsFor({
				articleId: article.id.value,
				query: req.query,
			});
			res.redirect(303, `${viewPath}#highlights-rail`);
		},
	);

	return router;
}
