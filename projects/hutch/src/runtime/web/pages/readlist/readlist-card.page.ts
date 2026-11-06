import { toArticleSubEntity } from "../../api/article-siren";
import { addToReadlistOfferForClient } from "./add-to-readlist-offer";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { upgradeOfferFor } from "../../shared/upgrade-offer/upgrade-offer";

import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import { ArticleStatusSchema } from "@packages/domain/article";
import { classifyDeviceClass, hashIp, } from "@packages/web-analytics";
import { viewerOf } from "@packages/viewer-identity";
import { ANALYTICS_EVENTS, STREAMS, } from "../../../observability/events";
import { FILED_READLIST_PARAM } from "../../shared/filing-flash";
import { ReaderArticleHashIdSchema, viewerFor } from "@packages/domain/article";
import {
	sendComponent,
} from "@packages/web-shell";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { HxRedirectPage } from "../../hx-redirect-page";
import { wantsSiren } from "../../content-negotiation";
import { buildQueryString } from "../../api/collection-query";
import { readlistsAtHrefs } from "../../api/readlist-href";
import {
	parseReadlistUrl,
	buildReadlistUrl,
	READLIST_PATH,
} from "./readlist.url";
import {
	type ReadlistContext,
	readerReadlists,
	readlistToFileInto,
} from "./readlist-context";
import { MARK_STATUS_ACK_NEVER } from "./mark-status-confirm.component";
import { DELETE_ACK_NEVER, } from "./readlist-card/delete-confirm.component";
import {
	DEFAULT_READLIST_SLUG,
	ReadlistSlugSchema,
	type ReadlistSlug,
	type ReadlistRef,
	decideReadlistArticleMove,
	readlistsHoldingArticle,
} from "@packages/domain/readlist";
import {
	READER_READLIST_CREATE_POPOVER_ID,
} from "./reader-readlist-filing";
import { renderReaderFilingFragment } from "./reader-filing-fragment";
import {
	renderReadlistCard,
	toReadlistCardDisplayModel,
} from "./readlist-card/readlist-card.component";
import { collectUtmParams } from "../../shared/utm";
import { tabQuery } from "./readlist.tabs";
import { readlistPageSizeForClient } from "./readlist-page-size";
import type { StatusFlash } from "./readlist.error";
import { READLIST_CREATE_REJECTIONS, READLIST_ERROR_LIMIT, READLIST_LIMIT_MESSAGE, type ReadlistCreateDialogRejection, READLIST_ERROR_UNKNOWN_READLIST, statusFlashFor } from "./readlist.error";
import { renderReadlistCreateForm } from "./readlist-create.component";
import { moveCreatePopoverId, renderMoveCreateForm } from "./readlist-card/move-dialog.component";
import type { HxLocationScroll, } from "../../hx-location";
import { answerReadlistNaming, } from "./readlist-naming-answer";
import { UNKNOWN_ARTICLE_REFUSAL, UNKNOWN_READLIST_REFUSAL, refuseOverSiren } from "./readlist-siren-refusal";
import { renderReadlistMutationFragment } from "./readlist-mutation-fragments";
import { MAX_POLLS } from "@packages/web-shell";
import { parsePollParam } from "@packages/web-shell";
import { toReadlistArticleViewModel, } from "./readlist.viewmodel";
import { computeReadlistCardEtag } from "./readlist-card/readlist-card.etag";
import { etagMatches } from "@packages/web-shell";
import { readerMarkStatusConfirm } from "../reader/reader.component";
import { safeReturnPath } from "../../shared/safe-return-path";
import {
	isNativeClient,
	isNativeSurfaceMarked,
	APP_SHELL_QUERY,
	PLATFORM_QUERY,
	readlistQueryKeyOf,
} from "../../onboarding/native-client";
import { APP_BACK_LINK } from "../../shared/native-app-links";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import { type ReadlistShared, SaveArticleReadlistsSchema, isAppPlatform, readerReadlistFilingFrom, } from "./readlist-shared";

/** Minute-precision UTC id as recorded in the crawl-version log, e.g.
 * "2026-07-10T09:41Z" — the value the reader's remove-version form submits. */
const CrawlVersionMinuteIdSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);

const ArticleMoveBodySchema = z.union([
	z.object({ from: ReadlistSlugSchema, to: ReadlistSlugSchema }),
	z.object({ from: ReadlistSlugSchema, label: z.string() }),
]);

export function initReadlistCardRoutes(
	deps: Pick<
		ReadlistDependencies,
		"appOrigin" | "findArticleById" | "findArticleCrawlStatus" | "findGeneratedSummary" | "resolveReaderProvenance" | "getOnboardingSignals" | "getEffectiveAccess" | "now" | "recordMarkReadAcrossQueuesAcknowledged" | "updateArticleStatusAcrossReadlists" | "recordEngagementActivity" | "recordAnalyticsEvent" | "salt" | "recordDeleteArticleAcknowledged" | "requireWriteAccess" | "addArticleToReadlist" | "listReadlistDefinitions" | "listUserSavesForUrls" | "upsertReadlist" | "findArticleUrlById" | "listUserSavesForUrl" | "publishRemoveMyContent"
	>,
	shared: ReadlistShared,
): Router {
	const router = express.Router();
	const { resolveReadlistContext, requestReadlistContext, storeFor, storeDiscoveryOf, deleteArticleFromReadlistFor, savesAcrossReadlists, markStatusConfirmReadlistsFor, renderReadlistListing } = shared;

	const closeAppReader = (req: Request, res: Response): void => {
		if (req.get("HX-Request") === "true") {
			sendComponent(req, res, HxRedirectPage(APP_BACK_LINK.topHref));
			return;
		}
		res.redirect(303, APP_BACK_LINK.topHref);
	};

	const filedLanding = (returnTo: unknown, slug: ReadlistSlug): string => {
		const landing = new URL(safeReturnPath(returnTo), deps.appOrigin);
		landing.searchParams.set(FILED_READLIST_PARAM, slug);
		return `${landing.pathname}${landing.search}`;
	};

	/** Answers an htmx card status change. The server — never the client —
	 * decides the response shape from a metadata-only re-probe of the requested
	 * page: an applied change on a page that still has rows removes just the card
	 * (empty primary body) and refreshes toast/counts out of band; anything else
	 * (page emptied, page beyond the last, or the change didn't apply) re-renders
	 * the full listing exactly as the 303 → GET path would, retargeted to <main>
	 * so the DOM resyncs to truth. Delete keeps its full-<main> confirm flow, so
	 * this covers status only. */
	const respondCardStatusSwap = async (
		req: Request,
		res: Response,
		{
			userId,
			statusFlash,
			context,
			resolveFullContext,
		}: {
			userId: UserId;
			statusFlash?: StatusFlash;
			context: ReadlistContext;
			resolveFullContext: () => Promise<ReadlistContext>;
		},
	): Promise<void> => {
		const urlState = context.state;
		const store = storeFor(urlState.readlist);
		const tab = tabQuery(urlState.tab);
		const order = urlState.order ?? tab.defaultOrder;
		const pageSize = readlistPageSizeForClient(req.oauthClientId);
		const discovery = storeDiscoveryOf(urlState);
		const probePage = (page: number) =>
			store.findArticlesByUser({
				userId,
				status: tab.status,
				sort: tab.sort,
				order,
				page,
				pageSize,
				excludeContent: true,
				discovery,
			});

		const result = await probePage(urlState.page);
		const rows = result.articles.length;

		/** The card-removal fast path leaves <main> — and so the pagination nav —
		 * untouched, so it is only safe while that nav stays correct. Removing the
		 * card drops the tab total by one, which erases the Next link exactly when
		 * that leaves the current page full with nothing after it: the next page
		 * held the single row this page just absorbed (`rows === pageSize &&
		 * !hasMore`). Treat that like any other DOM drift and fall through to the
		 * full render, which re-renders the nav — the counts loader only re-arms the
		 * "Page X of Y" label, never the Previous/Next links. */
		const paginationWouldDrift = rows === pageSize && !result.hasMore;

		if (statusFlash && rows > 0 && !paginationWouldDrift) {
			res
				.status(200)
				.type("html")
				.send(renderReadlistMutationFragment({ filters: urlState, statusFlash }));
			return;
		}

		let renderState = urlState;
		let renderResult = result;
		if (statusFlash && rows === 0 && urlState.page > 1) {
			const total = await store.countArticlesByUser({ userId, status: tab.status, discovery });
			const totalPages = Math.max(1, Math.ceil(total / pageSize));
			renderState = { ...urlState, page: totalPages };
			renderResult = await probePage(totalPages);
		}

		res.set("HX-Retarget", "main");
		res.set("HX-Reswap", "outerHTML show:none");
		res.set("HX-Reselect", "main");
		await renderReadlistListing(req, res, {
			userId,
			context: { ...(await resolveFullContext()), state: renderState },
			result: renderResult,
			statusFlash,
		});
	};

	router.get("/:id/card", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			if (wantsSiren(req)) {
				refuseOverSiren(res, UNKNOWN_ARTICLE_REFUSAL);
				return;
			}
			res.status(404).type("html").send("");
			return;
		}

		if (wantsSiren(req)) {
			const [crawl, summary, context] = await Promise.all([
				deps.findArticleCrawlStatus(article.url),
				deps.findGeneratedSummary({ url: article.url, viewer: viewerFor(userId) }),
				resolveReadlistContext(req, userId),
			]);
			const { state } = context;
			const { rel: _rel, ...entity } = toArticleSubEntity(article, {
				addToReadlist: addToReadlistOfferForClient(req.oauthClientId),
				crawl,
				summary,
				collectionQuery: {
					readlistKey: readlistQueryKeyOf(req),
					readlist: state.readlist,
					status: tabQuery(state.tab).status,
					order: state.order,
				},
				now: deps.now(),
				pollCount: parsePollParam(req.query.poll, MAX_POLLS) + 1,
			});
			res.set("Cache-Control", "private, no-cache");
			res.vary("Accept, Authorization");
			res.type(SIREN_MEDIA_TYPE).json(entity);
			return;
		}

		const [crawl, summary, readerProvenance] = await Promise.all([
			deps.findArticleCrawlStatus(article.url),
			deps.findGeneratedSummary({ url: article.url, viewer: viewerFor(userId) }),
			deps.resolveReaderProvenance(article.provenance),
		]);

		const etag = computeReadlistCardEtag({ article, crawl, summary, readerProvenance });
		/** Per-user data — never share across CDN edges or between users on a
		 * shared cache. `no-cache` requires revalidation on every request, which
		 * is exactly what we want: the browser always asks, the server cheaply
		 * returns 304 when the row hasn't changed during the wait window. */
		res.set("Cache-Control", "private, no-cache");
		res.set("Vary", "Cookie");
		res.set("ETag", etag);

		if (etagMatches(req.get("If-None-Match"), etag)) {
			res.status(304).end();
			return;
		}

		const filters = parseReadlistUrl(req.query);
		const readlistUrl = buildReadlistUrl(filters);
		const queryIndex = readlistUrl.indexOf("?");
		const returnQuery = queryIndex !== -1 ? readlistUrl.slice(queryIndex) : "";
		const requestedPoll = parsePollParam(req.query.poll, MAX_POLLS);
		/** The fragment must agree with the listing it replaces a row in: a card
		 * still polling when the reader silences the delete confirmation would
		 * otherwise come back pointing at a panel the page no longer renders,
		 * leaving its Delete button inert. */
		const [signals, context, access] = await Promise.all([
			deps.getOnboardingSignals({ userId }),
			resolveReadlistContext(req, userId),
			deps.getEffectiveAccess(userId),
		]);
		const savesByUrl = await savesAcrossReadlists({ userId, context, urls: [article.url] });
		const confirmReadlistsByUrl = markStatusConfirmReadlistsFor({
			context,
			urls: [article.url],
			savesByUrl,
			acknowledgedAt: signals.markReadAcrossQueuesAckedAt,
		});
		const articleVm = toReadlistArticleViewModel({
			article,
			now: deps.now(),
			returnQuery,
			summary,
			crawl,
			readerProvenance,
			filters,
			pollCount: requestedPoll + 1,
			maxPolls: MAX_POLLS,
			confirmReadlists: confirmReadlistsByUrl?.get(article.url),
			deleteAcknowledged: signals.deleteArticleAckedAt !== undefined,
			filing: {
				readlists: context.readlists,
				saves: savesByUrl?.get(article.url),
				accessIsReadOnly: access.access === "read-only",
				offer: upgradeOfferFor({ req, access }),
			},
		});
		const cardOptions = { isFirst: false, deviceClass: classifyDeviceClass(req.get("user-agent")) };
		const html = renderReadlistCard(toReadlistCardDisplayModel(articleVm, cardOptions));
		res.status(200).type("html").send(html);
	});

	router.post("/:id/status", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const parsedStatus = ArticleStatusSchema.safeParse(req.body.status);
		const context = requestReadlistContext(req);

		if (req.body?.ack === MARK_STATUS_ACK_NEVER) {
			await deps.recordMarkReadAcrossQueuesAcknowledged({ userId });
		}

		let statusFlash: StatusFlash | undefined;
		const flashParams: [string, string][] = [];
		if (parsedId.success && parsedStatus.success) {
			const updated = await deps.updateArticleStatusAcrossReadlists({
				id: parsedId.data,
				userId,
				addressed: context.state.readlist,
				status: parsedStatus.data,
			});
			if (updated) {
				await deps.recordEngagementActivity({
					userId,
					kind: "read-status",
					at: deps.now(),
					articleId: updated.id,
					markedRead: parsedStatus.data === "read",
					campaignId: updated.suggestionAttribution?.campaignId,
				});
				statusFlash = statusFlashFor({ articleId: req.params.id, changed: parsedStatus.data });
				flashParams.push(["status_changed", parsedStatus.data]);
				flashParams.push(["status_article", req.params.id]);
			}
			if (updated && parsedStatus.data === "read") {
				deps.recordAnalyticsEvent(req, {
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.articleRead,
					timestamp: deps.now().toISOString(),
					user_id: userId,
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					device_class: classifyDeviceClass(req.get("user-agent")),
					opened_in_reader: updated.viewedAt !== undefined,
				});
			}
		}

		if (req.get("HX-Request") === "true" && req.query.swap === "card") {
			/** The fallback branch re-renders the whole listing, rail included, so
			 * that render needs the reader's real readlists — the shape-only context
			 * above knows the addressed slug but not the set it belongs to. */
			await respondCardStatusSwap(req, res, {
				userId,
				statusFlash,
				context,
				resolveFullContext: () => resolveReadlistContext(req, userId),
			});
			return;
		}

		res.redirect(303, buildReadlistUrl(context.state, [...collectUtmParams(req.query), ...flashParams]));
	});

	router.post("/:id/delete", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);

		if (isAppPlatform(req) && !parsedId.success) {
			res.status(404).type("html").send("");
			return;
		}

		if (req.body?.ack === DELETE_ACK_NEVER) {
			await deps.recordDeleteArticleAcknowledged({ userId });
		}

		const context = requestReadlistContext(req);
		if (parsedId.success) {
			await deleteArticleFromReadlistFor(context.state.readlist)({ articleId: parsedId.data, userId });
		}

		if (isAppPlatform(req)) {
			closeAppReader(req, res);
			return;
		}
		res.redirect(303, buildReadlistUrl(context.state));
	});

	router.post(
		"/:id/assign",
		requireNotLocked,
		deps.requireWriteAccess,
		express.json(),
		async (req: Request<{ id: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
			if (wantsSiren(req)) {
				const context = await resolveReadlistContext(req, userId);
				const targets = readlistsAtHrefs({
					hrefs: SaveArticleReadlistsSchema.parse(req.body?.readlists) ?? [],
					readlists: context.readlists,
				}).filter((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG);
				if (targets.length === 0) {
					refuseOverSiren(res, UNKNOWN_READLIST_REFUSAL);
					return;
				}
				const article = parsedId.success
					? await storeFor(context.state.readlist).findArticleById(parsedId.data, userId)
					: null;
				if (!article) {
					refuseOverSiren(res, UNKNOWN_ARTICLE_REFUSAL);
					return;
				}
				for (const target of targets) {
					await deps.addArticleToReadlist({ userId, readlist: target.slug, from: context.state.readlist, url: article.url });
				}
				res.redirect(
					303,
					`${READLIST_PATH}${buildQueryString({ readlistKey: readlistQueryKeyOf(req), readlist: context.state.readlist, status: tabQuery(context.state.tab).status, order: context.state.order })}`,
				);
				return;
			}
			const parsedReadlist = ReadlistSlugSchema.safeParse(req.body?.queue);
			if (!parsedId.success || !parsedReadlist.success || parsedReadlist.data === DEFAULT_READLIST_SLUG) {
				res.status(404).type("html").send("");
				return;
			}
			const definitions = await deps.listReadlistDefinitions(userId);
			const target = definitions.find((definition) => definition.slug === parsedReadlist.data);
			if (!target) {
				res.status(404).type("html").send("");
				return;
			}
			const article = await deps.findArticleById(parsedId.data, userId);
			if (article) {
				const { assigned } = await deps.addArticleToReadlist({
					userId,
					readlist: target.slug,
					from: DEFAULT_READLIST_SLUG,
					url: article.url,
				});
				if (req.get("HX-Request") === "true" && req.query.swap === "filing") {
					const returnPath = safeReturnPath(req.body.returnTo);
					const returnQuery = new URL(returnPath, deps.appOrigin).searchParams;
					const appSurface =
						isNativeClient(req) ||
						isNativeSurfaceMarked({
							platform: returnQuery.get(PLATFORM_QUERY),
							shell: returnQuery.get(APP_SHELL_QUERY),
						});
					const [savesByUrl, signals] = await Promise.all([
						deps.listUserSavesForUrls({
							userId,
							urls: [article.url],
							readlists: readerReadlists(definitions).map(({ slug }) => slug),
						}),
						deps.getOnboardingSignals({ userId }),
					]);
					const saves = savesByUrl.get(article.url);
					assert(saves, "listUserSavesForUrls must answer an entry for every requested url");
					const filing = readerReadlistFilingFrom({
						article,
						definitions,
						saves,
						signals,
						returnTo: returnPath,
						filed: assigned && !appSurface ? target.slug : undefined,
					});
					res
						.set("HX-Reswap", "none show:none")
						.set("HX-Replace-Url", returnPath)
						.type("html")
						.send(
							renderReaderFilingFragment({
								filing,
								markStatusConfirm:
									filing.markStatusConfirmReadlists === undefined
										? undefined
										: readerMarkStatusConfirm({ article, readlists: filing.markStatusConfirmReadlists }),
							}),
						);
					return;
				}
				if (assigned) {
					res.redirect(303, filedLanding(req.body.returnTo, target.slug));
					return;
				}
			}
			res.redirect(303, safeReturnPath(req.body.returnTo));
		},
	);

	router.post(
		"/:id/create-and-assign",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request<{ id: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
			if (!parsedId.success) {
				res.status(404).type("html").send("");
				return;
			}
			const returnTo = safeReturnPath(req.body?.returnTo);
			const land = (landing: { path: string; scroll: HxLocationScroll }): void =>
				answerReadlistNaming(req, res, {
					dialogId: READER_READLIST_CREATE_POPOVER_ID,
					naming: { landing: landing.path, scroll: landing.scroll },
				});
			const article = await deps.findArticleById(parsedId.data, userId);
			if (!article) {
				land({ path: returnTo, scroll: "top" });
				return;
			}
			const label = typeof req.body?.label === "string" ? req.body.label : "";
			const refuse = (error: string): void =>
				answerReadlistNaming(req, res, {
					dialogId: READER_READLIST_CREATE_POPOVER_ID,
					naming: {
						refusal: returnTo,
						form: () =>
							renderReadlistCreateForm({
								popoverId: READER_READLIST_CREATE_POPOVER_ID,
								key: "readlist-create",
								action: req.originalUrl,
								value: label,
								error,
								hiddenFields: [{ name: "returnTo", value: returnTo }],
							}),
					},
				});
			const outcome = await deps.upsertReadlist({ userId, name: label });
			switch (outcome.status) {
				case "ok": {
					const { assigned } = await deps.addArticleToReadlist({
						userId,
						readlist: outcome.readlist.slug,
						from: DEFAULT_READLIST_SLUG,
						url: article.url,
					});
					land({ path: assigned ? filedLanding(returnTo, outcome.readlist.slug) : returnTo, scroll: "stay-put" });
					return;
				}
				case "invalid-name":
				case "reserved-name":
					refuse(READLIST_CREATE_REJECTIONS[outcome.status].message);
					return;
				case "limit-reached":
					refuse(READLIST_LIMIT_MESSAGE);
					return;
			}
		},
	);

	router.post("/:id/unassign", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		if (wantsSiren(req)) {
			const context = await resolveReadlistContext(req, userId);
			const addressed = readlistToFileInto(context);
			if (addressed === undefined) {
				refuseOverSiren(res, UNKNOWN_READLIST_REFUSAL);
				return;
			}
			const removed = parsedId.success
				? await deleteArticleFromReadlistFor(addressed)({ articleId: parsedId.data, userId })
				: false;
			if (!removed) {
				refuseOverSiren(res, UNKNOWN_ARTICLE_REFUSAL);
				return;
			}
			res.redirect(
				303,
				`${READLIST_PATH}${buildQueryString({ readlistKey: readlistQueryKeyOf(req), readlist: addressed, status: tabQuery(context.state.tab).status, order: context.state.order })}`,
			);
			return;
		}
		const parsedReadlist = ReadlistSlugSchema.safeParse(req.body?.queue);
		if (parsedId.success && parsedReadlist.success && parsedReadlist.data !== DEFAULT_READLIST_SLUG) {
			await deleteArticleFromReadlistFor(parsedReadlist.data)({ articleId: parsedId.data, userId });
		}
		res.redirect(303, safeReturnPath(req.body.returnTo));
	});

	router.post(
		"/:id/move",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request<{ id: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
			const parsedBody = ArticleMoveBodySchema.safeParse(req.body);
			if (!parsedId.success || !parsedBody.success) {
				res.status(404).type("html").send("");
				return;
			}
			const articleId = parsedId.data;
			const body = parsedBody.data;
			const { from } = body;
			const dialogId = moveCreatePopoverId(articleId.value);
			const context = await resolveReadlistContext(req, userId);
			const land = (landing: { path: string; scroll: HxLocationScroll }): void => {
				if ("label" in body) {
					answerReadlistNaming(req, res, { dialogId, naming: { landing: landing.path, scroll: landing.scroll } });
					return;
				}
				res.redirect(303, landing.path);
			};
			const quietLanding = { path: buildReadlistUrl(context.state), scroll: "stay-put" } as const;
			const url = await deps.findArticleUrlById(articleId);
			if (url === null) {
				land(quietLanding);
				return;
			}
			const saves = await deps.listUserSavesForUrl({ userId, url });
			const holders = readlistsHoldingArticle({ saves, readlists: context.readlists });
			if (!holders.some((readlist) => readlist.slug === from)) {
				land(quietLanding);
				return;
			}
			const moveInto = async (destination: {
				to: ReadlistSlug;
				readlists: readonly ReadlistRef[];
			}): Promise<void> => {
				const decision = decideReadlistArticleMove({
					from,
					to: destination.to,
					readlists: destination.readlists,
					saves,
				});
				if (!decision.ok) {
					land(
						decision.reason === "unknown-readlist"
							? {
									path: buildReadlistUrl(context.state, [["queue_error", READLIST_ERROR_UNKNOWN_READLIST]]),
									scroll: "top",
								}
							: quietLanding,
					);
					return;
				}
				if (decision.copyInto !== undefined) {
					await deps.addArticleToReadlist({ userId, readlist: decision.copyInto, from, url });
				}
				if (decision.removeFrom !== undefined) {
					await deleteArticleFromReadlistFor(decision.removeFrom)({ articleId, userId });
				}
				land({
					path: buildReadlistUrl(context.state, [
						...collectUtmParams(req.query),
						["moved_article", articleId.value],
						["moved_from", from],
						["moved_to", destination.to],
					]),
					scroll: "stay-put",
				});
			};
			if (!("label" in body)) {
				await moveInto({ to: body.to, readlists: context.readlists });
				return;
			}
			const refuse = (reason: ReadlistCreateDialogRejection): void =>
				answerReadlistNaming(req, res, {
					dialogId,
					naming: {
						refusal: buildReadlistUrl(context.state, [["queue_error", `create_${reason}`]]),
						form: () =>
							renderMoveCreateForm({
								articleId: articleId.value,
								action: req.originalUrl,
								from,
								value: body.label,
								error: READLIST_CREATE_REJECTIONS[reason].message,
							}),
					},
				});
			const outcome = await deps.upsertReadlist({ userId, name: body.label });
			switch (outcome.status) {
				case "ok":
					if (!outcome.created) {
						refuse("name-taken");
						return;
					}
					await moveInto({ to: outcome.readlist.slug, readlists: [...context.readlists, outcome.readlist] });
					return;
				case "invalid-name":
				case "reserved-name":
					refuse(outcome.status);
					return;
				case "limit-reached":
					land({ path: buildReadlistUrl(context.state, [["queue_error", READLIST_ERROR_LIMIT]]), scroll: "top" });
					return;
			}
		},
	);

	/** Remove one crawl-version snapshot the viewer authored. Guardless (only
	 * dualAuth + resolveVerificationStatus, matching `/delete`): removing content
	 * you authored is a deletion right, reachable for read-only/locked users. The
	 * publisher only ever deletes objects whose sidecar/log entry credits this
	 * userId, so a forged id/version resolves to nothing server-side. */
	router.post("/:id/remove-my-version", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const parsedVersion = CrawlVersionMinuteIdSchema.safeParse(req.body?.versionMinuteId);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (article && parsedVersion.success) {
			await deps.publishRemoveMyContent({
				url: article.url,
				userId,
				versionMinuteId: parsedVersion.data,
			});
			res.redirect(303, `${READLIST_PATH}/${article.id.value}/view`);
			return;
		}

		res.redirect(303, `${READLIST_PATH}/${req.params.id}/view`);
	});

	return router;
}
