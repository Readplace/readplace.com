
import { generatedContentOf } from "../../generated-content-of";
import assert from "node:assert";
import {
	DISMISS_COOKIE_NAME,
} from "@packages/onboarding-extension-signal";
import type { Request, Response, Router } from "express";
import express from "express";
import { tagPageviewSortOrder, } from "@packages/web-analytics";
import {
	IMPORT_SKIPPED_COOKIE_NAME,
	decodeImportSkippedCookie,
} from "../import/import-skipped-cookie";
import type { ImportSkippedViewModel } from "./readlist.viewmodel";
import { articlesSavedAt, savedArticleUrlPage } from "./articles-saved-at";
import { FREE_PLAN_BANNER_DISMISS_COOKIE_NAME } from "./free-plan-banner-dismiss";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, } from "../../api/siren";
import { toArticleCollectionEntity } from "../../api/collection-siren";
import { DEFAULT_READLIST_SLUG, HomeReadlistSlugSchema } from "@packages/domain/readlist";
import { readlistHref } from "../../api/readlist-href";
import { safeReturnPath } from "../../shared/safe-return-path";
import { HOME_READLIST_SAVED, homeReadlistTarget } from "./readlist-home";
import { UNKNOWN_READLIST_REFUSAL, refuseOverSiren } from "./readlist-siren-refusal";
import { FIND_ARTICLES_PARAM, buildQueryString } from "../../api/collection-query";
import {
	parseReadlistUrl,
	buildReadlistUrl,
	READLIST_PATH,
	canonicalReadlistPageRedirect,
} from "./readlist.url";
import {
	renderReadlistCounts,
	toReadlistCountsDisplayModel,
} from "./readlist-counts.component";
import { collectUtmParams } from "../../shared/utm";
import { READLIST_TAB_STATUSES, tabQuery } from "./readlist.tabs";
import { READLIST_SORT_OPTIONS } from "./readlist-sort";
import { readlistTotalLabel } from "./readlist-tab-total.component";
import { READLIST_PAGE_SIZE, readlistPageSizeForClient } from "./readlist-page-size";
import { addToReadlistOfferForClient } from "./add-to-readlist-offer";
import { READLIST_ERROR_UNKNOWN_READLIST, collectStatusFlashParams, httpErrorMessageMapping, importFlashMapping, moveFlashMapping, saveFormRejectionMessage, saveableUrlErrorCodeMapping, skippedLinkReasonLabel, statusFlashMapping, } from "./readlist.error";
import { HAND_PICKED_SCOPE, withHandPicked } from "./built-in-readlists";
import { initRequireGmailConnectionAccess } from "../integrations/require-gmail-connection-access";
import {
	hasInstallableClient,
} from "../../onboarding/extension-install";
import {
	hasBackgroundSaveContinuity,
	HOME_READLIST_HEADER,
	isNativeClient,
	nativeClientOf,
	nativeSurfaceOf,
	readlistQueryKeyOf,
} from "../../onboarding/native-client";
import { setSirenCanonicalRedirectCaching, setSirenCollectionCaching } from "../../siren-discovery-cache";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import { ownedEnclosuresByUrl, viewerFor } from "@packages/domain/article";
import { type ReadlistShared, dismissTokenFor, loadSummaries, loadCrawls, NO_READLIST_FILTER, } from "./readlist-shared";

function readImportSkippedFlash(
	req: Request,
	res: Response,
): ImportSkippedViewModel | undefined {
	const raw = req.cookies?.[IMPORT_SKIPPED_COOKIE_NAME];
	const decoded = decodeImportSkippedCookie(raw);
	if (!decoded || decoded.entries.length === 0) return undefined;
	/** Cookie is read-once: clear it so a refresh of /queue doesn't keep
	 * surfacing the "couldn't import" banner. */
	res.clearCookie(IMPORT_SKIPPED_COOKIE_NAME, { path: READLIST_PATH });
	return {
		entries: decoded.entries.map((e) => ({
			url: e.url,
			reasonLabel: skippedLinkReasonLabel(e.code),
		})),
		andMore: decoded.andMore,
	};
}


export function initReadlistListingRoutes(deps: Pick<
		ReadlistDependencies,
		"resolveCanonicalIdentity" | "now" | "recordNativeAppAnyActivity" | "resolveReaderProvenances" | "findArticleCrawlStatuses" | "logError" | "findGeneratedSummaries" | "findUserById" | "findGmailConnectionByUserId" | "getEffectiveAccess" | "recordEmailStepMarkedDone" | "recordGmailStepDismissed" | "secureCookies" | "setKeepOfferDismissed" | "findHomeReadlist" | "setHomeReadlist" | "listReadlistDefinitions"
	>, shared: ReadlistShared): Router {
	const router = express.Router();
	const { resolveListedOnView, resolveReadlistContext, requestReadlistContext, storeFor, rememberReadlistFilter, storeDiscoveryOf, recordOnboardingSignalBestEffort, gmailEligibleFor, renderReadlistListing } = shared;

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		/* A native app loads the readlist over Siren on launch; record that authed
		 * request as the "app installed + signed in" signal so step 1 ticks before
		 * any save. Header-gated, so a browser (no header) only ever reads, never
		 * writes. Best-effort: the app's main screen loads over this request, so the
		 * signal write must never be able to fail it. */
		const nativeClient = nativeClientOf(req);
		if (nativeClient) {
			await recordOnboardingSignalBestEffort(() =>
				deps.recordNativeAppAnyActivity({ userId, platform: nativeClient }),
			);
		}
		const siren = wantsSiren(req);
		const homeRequested = req.get(HOME_READLIST_HEADER) === "1";
		const home = !siren || homeRequested ? {
			preference: await deps.findHomeReadlist(userId),
			open: !siren && req.query.utm_medium !== "extension" && Object.keys(req.query).every((key) => key.startsWith("utm_")),
		} : undefined;
		const context = await resolveReadlistContext(req, userId, home);
		const urlState = context.state;
		const store = storeFor(urlState.readlist, urlState.managedSource, urlState.sender);
		const tab = tabQuery(urlState.tab);
		const filterUrl = typeof req.query.url === "string" ? req.query.url : undefined;
		const readlistKey = readlistQueryKeyOf(req);
		const lookup = siren && req.query.lookup === "1" && !urlState.managedSource;
		const status = lookup && req.query.status === undefined && req.query.tab === undefined ? undefined : tab.status;
		const findArticles = siren && !lookup && req.query[FIND_ARTICLES_PARAM.name] === FIND_ARTICLES_PARAM.value
			? { discovery: parseReadlistUrl(req.query).discovery }
			: undefined;
		const canonicalQuery = { readlistKey, readlist: urlState.readlist, status, order: urlState.order, findArticles, page: urlState.page, url: filterUrl, lookup };
		if (siren && readlistKey === "readlist" && req.query.queue !== undefined && req.query.readlist === undefined) {
			setSirenCanonicalRedirectCaching(res);
			res.redirect(303, `${READLIST_PATH}${buildQueryString(canonicalQuery)}`);
			return;
		}

		tagPageviewSortOrder(res, urlState.order);
		const order = urlState.order ?? tab.defaultOrder;
		const discovery = siren
			? storeDiscoveryOf({ ...urlState, discovery: findArticles?.discovery })
			: storeDiscoveryOf(urlState);
		const pageSize = readlistPageSizeForClient(req.oauthClientId);
		const result = lookup ? await savedArticleUrlPage({
			url: filterUrl, userId, status, page: urlState.page, pageSize,
			resolveCanonicalIdentity: deps.resolveCanonicalIdentity, findArticleById: store.findArticleById,
		}) : await store.findArticlesByUser({
			userId,
			status: tab.status,
			sort: tab.sort,
			order,
			page: urlState.page,
			pageSize,
			includeTotal: siren,
			excludeContent: true,
			discovery,
		});

		if (siren) {
			const filteredArticles = filterUrl && !lookup
				? articlesSavedAt({ articles: result.articles, url: filterUrl })
				: result.articles;
			const filtered = filterUrl && !lookup
				? { ...result, articles: filteredArticles, total: filteredArticles.length }
				: result;
			const [loadedCrawlByUrl, loadedSummaryByUrl, readerProvenances] = await Promise.all([
				loadCrawls(deps.findArticleCrawlStatuses, filtered.articles, deps.logError),
				loadSummaries({ findGeneratedSummaries: deps.findGeneratedSummaries, articles: filtered.articles, viewer: viewerFor(userId), generatedContent: generatedContentOf(req), logError: deps.logError }),
				deps.resolveReaderProvenances(filtered.articles.map((article) => article.provenance)),
			]);
			const readerProvenanceByUrl = new Map(
				filtered.articles.map((article, index) => [article.url, readerProvenances[index]] as const),
			);
			const { crawlByUrl, summaryByUrl } = filterUrl
				? { crawlByUrl: loadedCrawlByUrl, summaryByUrl: loadedSummaryByUrl }
				: await resolveListedOnView(req, {
						userId,
						surface: "readlist-siren",
						articles: filtered.articles,
						crawlByUrl: loadedCrawlByUrl,
						summaryByUrl: loadedSummaryByUrl,
					});

			const findArticlesMatchedNothing = discovery !== undefined && result.total === 0 &&
				await store.countArticlesByUser({ userId, status: tab.status }) > 0;
			const appearance = (await deps.findUserById(userId))?.appearance ?? "system";
			const setHomeTarget = nativeClient !== undefined && homeRequested ? context.home?.targets.get(urlState.readlist) : undefined;
			setSirenCollectionCaching(req, res);
			if (req.query[HOME_READLIST_SAVED] !== undefined) res.set("Cache-Control", "private, no-cache");
			res.type(SIREN_MEDIA_TYPE).json(
				toArticleCollectionEntity(
					filtered,
					canonicalQuery,
					{
						tabs: READLIST_TAB_STATUSES,
						readlists: context.readlists,
						pinnedReadlists: context.pinnedReadlists,
						homeHref: homeRequested ? readlistHref({ readlist: context.home?.slug ?? HAND_PICKED_SCOPE, readlistKey }) : undefined,
						setHome: setHomeTarget && { target: setHomeTarget, label: context.activeReadlist.label },
						addToReadlist: addToReadlistOfferForClient(req.oauthClientId),
						now: deps.now(),
						surfacePlatform: nativeSurfaceOf(req),
						showSaveInProgressNotice: isNativeClient(req) && !hasBackgroundSaveContinuity(req),
						appearance,
						crawlByUrl,
						enclosureByUrl: ownedEnclosuresByUrl({ viewer: viewerFor(userId), articles: filtered.articles }),
						summaryByUrl,
						readerProvenanceByUrl,
						totalLabel: readlistTotalLabel,
						sort: { options: READLIST_SORT_OPTIONS, current: order },
						findArticlesMatchedNothing,
					},
				),
			);
			return;
		}

		/** Marking the last item on a page read (or deleting it, or a stale
		 * bookmark) leaves the requested page beyond the new last page, which the
		 * store answers with zero rows. Clamp at this read boundary so the empty
		 * out-of-bounds render is unreachable by navigation; mutation handlers
		 * stay unchanged because they all redirect back through here. 302 not
		 * 301/308 — the page becomes valid again once the list refills. */
		if (result.articles.length === 0 && urlState.page > 1) {
			const pageRedirect = canonicalReadlistPageRedirect({
				state: urlState,
				total: await store.countArticlesByUser({ userId, status: tab.status, discovery }),
				pageSize: result.pageSize,
				extraParams: [
					...collectUtmParams(req.query),
					...collectStatusFlashParams(req.query),
				],
			});
			if (pageRedirect) {
				res.redirect(302, pageRedirect);
				return;
			}
		}

		const saveErrorCode = saveableUrlErrorCodeMapping(req.query);
		const saveError = saveErrorCode
			? saveFormRejectionMessage(saveErrorCode)
			: httpErrorMessageMapping(req.query);
		const importFlash = importFlashMapping(req.query);
		const statusFlash = statusFlashMapping(req.query);
		const moveFlash = moveFlashMapping(req.query, withHandPicked(context.readlists));
		const importSkipped = readImportSkippedFlash(req, res);
		await renderReadlistListing(req, res, {
			userId,
			context,
			result,
			saveError,
			saveErrorCode,
			importFlash,
			statusFlash,
			moveFlash,
			importSkipped,
			saveUrl: filterUrl,
		});
	});

	router.post("/queues/:slug/home", requireNotLocked, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const siren = wantsSiren(req);
		const slug = HomeReadlistSlugSchema.safeParse(req.params.slug);
		const target = slug.success && homeReadlistTarget(slug.data, await deps.listReadlistDefinitions(req.userId));
		const landing = new URL(safeReturnPath(siren ? req.query.returnTo : req.body?.returnTo), "https://readlist.invalid");
		if (landing.pathname === "/") landing.pathname = READLIST_PATH;
		if (landing.pathname === READLIST_PATH && !["queue", "readlist", "scope"].some((key) => landing.searchParams.has(key))) {
			landing.searchParams.set(siren ? readlistQueryKeyOf(req) : "queue", DEFAULT_READLIST_SLUG);
		}
		landing.searchParams.delete(HOME_READLIST_SAVED);
		if (!target || target.createdAt !== req.query.createdAt || !(await deps.setHomeReadlist({ userId: req.userId, preference: target }))) {
			if (siren) {
				refuseOverSiren(res, UNKNOWN_READLIST_REFUSAL);
				return;
			}
			landing.searchParams.set("queue_error", READLIST_ERROR_UNKNOWN_READLIST);
		} else {
			landing.searchParams.set(HOME_READLIST_SAVED, target.slug);
		}
		res.redirect(303, landing.pathname + landing.search);
	});

	router.get("/counts", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const context = await resolveReadlistContext(req, userId);
		const urlState = context.state;
		const store = storeFor(urlState.readlist, urlState.managedSource, urlState.sender);
		const tab = tabQuery(urlState.tab);
		const tabTotal = await store.countArticlesByUser({
			userId,
			status: tab.status,
			discovery: storeDiscoveryOf(urlState),
		});
		const counts = { filters: urlState, tabTotal, pageSize: READLIST_PAGE_SIZE };
		res.type("html").send(renderReadlistCounts(toReadlistCountsDisplayModel(counts)));
	});

	router.post("/filters", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const place = parseReadlistUrl(req.query);
		const filter = parseReadlistUrl(req.body ?? {}).discovery ?? NO_READLIST_FILTER;
		await rememberReadlistFilter(req, { time: filter.time, saved: filter.saved });
		res.redirect(
			303,
			buildReadlistUrl(
				{ ...place, discovery: { q: place.discovery?.q, time: filter.time, saved: filter.saved }, page: 1 },
			),
		);
	});

	router.post("/dismiss-onboarding", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const hasClient = hasInstallableClient(req);
		const gmailEligible = hasClient && deps.findGmailConnectionByUserId !== undefined &&
			gmailEligibleFor(req, await deps.getEffectiveAccess(req.userId));
		const version = dismissTokenFor({ hasClient, gmailEligible });
		res.cookie(DISMISS_COOKIE_NAME, version, { path: "/", maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: "lax", httpOnly: true, secure: deps.secureCookies });
		const context = requestReadlistContext(req);
		res.redirect(303, buildReadlistUrl(context.state));
	});

	router.post("/free-plan-banner/dismiss", (req: Request, res: Response) => {
		res.cookie(FREE_PLAN_BANNER_DISMISS_COOKIE_NAME, "1", { path: "/", maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: "lax", httpOnly: true, secure: deps.secureCookies });
		res.redirect(303, buildReadlistUrl(requestReadlistContext(req).state));
	});

	router.post("/keep-offer/dismiss", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		await deps.setKeepOfferDismissed({ userId: req.userId, dismissedAt: deps.now() });
		res.redirect(303, buildReadlistUrl(requestReadlistContext(req).state));
	});

	router.post("/onboarding/email/done", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		await deps.recordEmailStepMarkedDone({ userId: req.userId });
		res.redirect(303, buildReadlistUrl(requestReadlistContext(req).state));
	});

	if (deps.findGmailConnectionByUserId !== undefined) {
		router.post(
			"/onboarding/gmail/dismiss",
			requireNotLocked,
			initRequireGmailConnectionAccess({ getEffectiveAccess: deps.getEffectiveAccess }),
			async (req: Request, res: Response) => {
				assert(req.userId, "userId required - route must be protected by requireAuth");
				await deps.recordGmailStepDismissed({ userId: req.userId });
				res.redirect(303, buildReadlistUrl(requestReadlistContext(req).state));
			},
		);
	}

	return router;
}
