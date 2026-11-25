import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	HIGHLIGHT_NOTE_MAX_LENGTH,
	HighlightIdSchema,
	HighlightNoteSchema,
	type ReaderArticleHashId,
	ReaderArticleHashIdSchema,
	type SavedArticle,
	viewerFor,
} from "@packages/domain/article";
import {
	collectTextChunks,
	HIGHLIGHT_MAX_SELECTION_LENGTH,
	normaliseText,
} from "@packages/domain/article/highlight";
import { DEFAULT_LOCALE } from "@packages/translations/locale";
import { viewerOf } from "@packages/viewer-identity";
import { hashIp } from "@packages/web-analytics";
import type { Request, Response, Router } from "express";
import express from "express";
import { parseHTML } from "linkedom";
import { z } from "zod";
import { ANALYTICS_EVENTS, STREAMS } from "../../../observability/events";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { nativeSurfaceOf } from "../../onboarding/native-client";
import {
	HIGHLIGHT_NOTE_DIALOG_ID,
	highlightFormUrl,
	pushesHistory,
	renderHighlightNoteCreateForm,
} from "../../shared/article-body/highlights/highlight-note-dialog.component";
import type { HighlightRefusal } from "../../shared/article-body/highlights/highlight-toolbar.component";
import { prepareReaderContent } from "../../shared/article-body/reader-slot/reader-content";
import type { ReaderSectionInput } from "../../shared/article-body/reader-slot/section-pages";
import { servedContentHash } from "../../shared/article-body/reader-slot/served-content-hash";
import {
	highlightActionUrl,
	highlightNoteLocation,
	highlightReaderLocation,
} from "./highlight-surface";
import { highlightFormScopeFor } from "./reader-highlight-options";
import type { RenderOwnerReader } from "./reader-page.page";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import { answerReadlistNaming } from "./readlist-naming-answer";
import { READLIST_PATH } from "./readlist.url";

const CreateHighlightBodySchema = z
	.object({
		exact: z.string().min(1),
		start: z.coerce.number().int().min(0),
		end: z.coerce.number().int().min(0),
		origin: z.enum(["mouse", "tap", "longpress"]),
		note: HighlightNoteSchema.optional(),
		answer: z.literal("dialog").optional(),
		after: z.enum(["", "note"]).optional(),
	})
	.refine((body) => body.start <= body.end);

const HIGHLIGHT_CREATE_PATH = new RegExp(`^${READLIST_PATH}/[^/]+/highlights$`);

export function isHighlightCreateRequest(req: Request): boolean {
	return req.method === "POST" && HIGHLIGHT_CREATE_PATH.test(req.path);
}

const HighlightOpenedQuerySchema = z.object({
	highlight: HighlightIdSchema,
	origin: z.enum(["mark", "rail"]),
});

const HighlightCopiedQuerySchema = z.object({
	highlight: HighlightIdSchema,
	origin: z.literal("panel"),
});

const DIALOG_ERRORS: Record<HighlightRefusal, string> = {
	"passage-changed": "That passage changed; select it again",
	"too-long": "Select a shorter passage",
	"notes-too-long": `Joined with the highlights it overlaps, the notes are over ${HIGHLIGHT_NOTE_MAX_LENGTH.toLocaleString(DEFAULT_LOCALE)} characters.`,
	cancelled: "That highlight just changed; try again.",
};

const NEEDS_NEW_SELECTION: Record<HighlightRefusal, boolean> = {
	"passage-changed": true,
	"too-long": true,
	"notes-too-long": false,
	cancelled: false,
};

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

	const ownedArticleOf = async (
		req: Request<{ id: string }>,
	): Promise<SavedArticle | null> => {
		const id = ReaderArticleHashIdSchema.safeParse(req.params.id);
		return id.success ? reader.findOwnedArticle(req, id.data) : null;
	};

	router.post(
		"/:id/highlights",
		requireNotLocked,
		express.urlencoded({ extended: false, limit: "1mb" }),
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
			const scope = highlightFormScopeFor(req, article.id.value);
			const viewPath = highlightActionUrl({
				path: `${READLIST_PATH}/${article.id.value}/view`,
				readlist: scope.readlist,
				surface: scope.surface,
			});
			const inDialog =
				body.data.answer === "dialog" && req.get("HX-Request") === "true";
			const refuse = async (status: HighlightRefusal): Promise<void> => {
				if (inDialog) {
					answerReadlistNaming(req, res, {
						dialogId: HIGHLIGHT_NOTE_DIALOG_ID,
						naming: {
							refusal: viewPath,
							form: () =>
								renderHighlightNoteCreateForm({
									action: highlightFormUrl({
										scope,
										path: "/highlights",
										source: "highlight-toolbar",
										content: "save-note",
									}),
									hiddenFields: [
										{ name: "exact", value: body.data.exact },
										{ name: "start", value: String(body.data.start) },
										{ name: "end", value: String(body.data.end) },
										{ name: "origin", value: body.data.origin },
										{ name: "answer", value: "dialog" },
									],
									value: body.data.note ?? "",
									error: DIALOG_ERRORS[status],
									autofocus: true,
									...(NEEDS_NEW_SELECTION[status]
										? { refusal: "passage" as const }
										: {}),
								}),
						},
					});
					return;
				}
				await reader.renderOwnerReader(req, res, {
					statusCode: 422,
					highlightRefusal: status,
					markViewed: false,
				});
			};
			if (body.data.exact.length > HIGHLIGHT_MAX_SELECTION_LENGTH) {
				await refuse("too-long");
				return;
			}
			const stored = await deps.readArticleContent({
				url: article.url,
				viewer: viewerFor(userId),
			});
			if (stored.kind !== "article") {
				await refuse("passage-changed");
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
				note: body.data.note,
			});
			if (
				outcome.status === "passage-changed" ||
				outcome.status === "notes-too-long" ||
				outcome.status === "cancelled"
			) {
				await refuse(outcome.status);
				return;
			}
			const landing =
				"highlight" in outcome ? outcome.highlight : outcome.highlights[0];
			if (outcome.status === "created" || outcome.status === "merged") {
				deps.recordAnalyticsEvent(req, {
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.highlightCreated,
					timestamp: deps.now().toISOString(),
					user_id: userId,
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					origin: body.data.origin,
					highlight_id: landing.highlightId,
					pieces: outcome.highlights.length,
					surface: nativeSurfaceOf(req) ?? "web",
				});
			}
			if (body.data.note !== undefined) {
				deps.recordAnalyticsEvent(req, {
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.highlightNoteSaved,
					timestamp: deps.now().toISOString(),
					user_id: userId,
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					action: "added",
				});
			}
			if (inDialog) {
				answerReadlistNaming(req, res, {
					dialogId: HIGHLIGHT_NOTE_DIALOG_ID,
					naming: {
						landing: viewPath,
						scroll: "stay-put",
						...(pushesHistory(scope) ? {} : { push: false as const }),
					},
				});
				return;
			}
			if (body.data.after === "note") {
				const noteLanding = highlightNoteLocation({
					...scope,
					highlightId: landing.highlightId,
				});
				if (req.get("HX-Request") === "true") {
					res.status(200).set("HX-Redirect", noteLanding).type("html").send("");
					return;
				}
				res.redirect(303, noteLanding);
				return;
			}
			res.redirect(
				303,
				highlightReaderLocation({
					...scope,
					fragment: { highlightId: landing.highlightId },
				}),
			);
		},
	);

	router.post(
		"/:id/highlights/opened",
		async (req: Request<{ id: string }>, res: Response) => {
			assert(
				req.userId,
				"userId required - route must be protected by requireAuth",
			);
			const article = await ownedArticleOf(req);
			if (!article) {
				res.status(404).type("html").send("");
				return;
			}
			const opened = HighlightOpenedQuerySchema.safeParse(req.query);
			if (opened.success) {
				deps.recordAnalyticsEvent(req, {
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.highlightOpened,
					timestamp: deps.now().toISOString(),
					user_id: req.userId,
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					origin: opened.data.origin,
					highlight_id: opened.data.highlight,
				});
			}
			res.status(204).end();
		},
	);

	router.post(
		"/:id/highlights/copied",
		async (req: Request<{ id: string }>, res: Response) => {
			assert(
				req.userId,
				"userId required - route must be protected by requireAuth",
			);
			const article = await ownedArticleOf(req);
			if (!article) {
				res.status(404).type("html").send("");
				return;
			}
			const copied = HighlightCopiedQuerySchema.safeParse(req.query);
			if (copied.success) {
				deps.recordAnalyticsEvent(req, {
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.highlightCopied,
					timestamp: deps.now().toISOString(),
					user_id: req.userId,
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					origin: copied.data.origin,
					highlight_id: copied.data.highlight,
					surface: nativeSurfaceOf(req) ?? "web",
				});
			}
			res.status(204).end();
		},
	);

	router.post(
		"/:id/highlights/:highlightId/delete",
		requireNotLocked,
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
				highlight_id: highlightId.data,
			});
			res.redirect(
				303,
				highlightReaderLocation({
					...highlightFormScopeFor(req, article.id.value),
					fragment: "rail",
				}),
			);
		},
	);

	return router;
}
