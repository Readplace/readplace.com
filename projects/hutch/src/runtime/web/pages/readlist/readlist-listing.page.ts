
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
import { articlesSavedAt } from "./articles-saved-at";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, } from "../../api/siren";
import { toArticleCollectionEntity } from "../../api/collection-siren";
import { buildQueryString } from "../../api/collection-query";
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
import { collectStatusFlashParams, importFlashMapping, moveFlashMapping, saveFormRejectionMessage, saveableUrlErrorCodeMapping, skippedLinkReasonLabel, statusFlashMapping, } from "./readlist.error";
import { initRequireGmailConnectionAccess } from "../integrations/require-gmail-connection-access";
import {
	hasInstallableClient,
} from "../../onboarding/extension-install";
import {
	hasBackgroundSaveContinuity,
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
		"now" | "recordNativeAppAnyActivity" | "findArticleCrawlStatuses" | "logError" | "findGeneratedSummaries" | "findUserById" | "httpErrorMessageMapping" | "findGmailConnectionByUserId" | "getEffectiveAccess" | "recordEmailStepMarkedDone" | "requireWriteAccess" | "recordGmailStepDismissed" | "secureCookies" | "setKeepOfferDismissed"
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
		const context = await resolveReadlistContext(req, userId);
		const urlState = context.state;
		const store = storeFor(urlState.readlist);
		const tab = tabQuery(urlState.tab);
		const filterUrl = typeof req.query.url === "string" ? req.query.url : undefined;
		const readlistKey = readlistQueryKeyOf(req);
		const canonicalQuery = { readlistKey, readlist: urlState.readlist, status: tab.status, order: urlState.order, page: urlState.page, url: filterUrl };
		if (siren && readlistKey === "readlist" && req.query.queue !== undefined && req.query.readlist === undefined) {
			setSirenCanonicalRedirectCaching(res);
			res.redirect(303, `${READLIST_PATH}${buildQueryString(canonicalQuery)}`);
			return;
		}

		tagPageviewSortOrder(res, urlState.order);
		const order = urlState.order ?? tab.defaultOrder;
		const discovery = siren ? undefined : storeDiscoveryOf(urlState);
		const result = await store.findArticlesByUser({
			userId,
			status: tab.status,
			sort: tab.sort,
			order,
			page: urlState.page,
			pageSize: readlistPageSizeForClient(req.oauthClientId),
			includeTotal: siren,
			excludeContent: true,
			discovery,
		});

		if (siren) {
			const filteredArticles = filterUrl
				? articlesSavedAt({ articles: result.articles, url: filterUrl })
				: result.articles;
			const filtered = filterUrl
				? { ...result, articles: filteredArticles, total: filteredArticles.length }
				: result;
			const [loadedCrawlByUrl, loadedSummaryByUrl] = await Promise.all([
				loadCrawls(deps.findArticleCrawlStatuses, filtered.articles, deps.logError),
				loadSummaries(deps.findGeneratedSummaries, filtered.articles, viewerFor(userId), deps.logError),
			]);
			const { crawlByUrl, summaryByUrl } = filterUrl
				? { crawlByUrl: loadedCrawlByUrl, summaryByUrl: loadedSummaryByUrl }
				: await resolveListedOnView(req, {
						userId,
						surface: "readlist-siren",
						articles: filtered.articles,
						crawlByUrl: loadedCrawlByUrl,
						summaryByUrl: loadedSummaryByUrl,
					});

			const appearance = (await deps.findUserById(userId))?.appearance ?? "system";
			setSirenCollectionCaching(req, res);
			res.type(SIREN_MEDIA_TYPE).json(
				toArticleCollectionEntity(
					filtered,
					canonicalQuery,
					{
						tabs: READLIST_TAB_STATUSES,
						readlists: context.readlists,
						addToReadlist: addToReadlistOfferForClient(req.oauthClientId),
						now: deps.now(),
						surfacePlatform: nativeSurfaceOf(req),
						showSaveInProgressNotice: isNativeClient(req) && !hasBackgroundSaveContinuity(req),
						appearance,
						crawlByUrl,
						enclosureByUrl: ownedEnclosuresByUrl({ viewer: viewerFor(userId), articles: filtered.articles }),
						summaryByUrl,
						totalLabel: readlistTotalLabel,
						sort: { options: READLIST_SORT_OPTIONS, current: order },
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
			: deps.httpErrorMessageMapping(req.query);
		const importFlash = importFlashMapping(req.query);
		const statusFlash = statusFlashMapping(req.query);
		const moveFlash = moveFlashMapping(req.query, context.readlists);
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

	router.get("/counts", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const context = await resolveReadlistContext(req, userId);
		const urlState = context.state;
		const store = storeFor(urlState.readlist);
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
		const version = dismissTokenFor(hasClient, gmailEligible);
		res.cookie(DISMISS_COOKIE_NAME, version, { path: "/", maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: "lax", httpOnly: true, secure: deps.secureCookies });
		const context = requestReadlistContext(req);
		res.redirect(303, buildReadlistUrl(context.state));
	});

	router.post("/keep-offer/dismiss", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		await deps.setKeepOfferDismissed({ userId: req.userId, dismissedAt: deps.now() });
		res.redirect(303, READLIST_PATH);
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
			deps.requireWriteAccess,
			async (req: Request, res: Response) => {
				assert(req.userId, "userId required - route must be protected by requireAuth");
				await deps.recordGmailStepDismissed({ userId: req.userId });
				res.redirect(303, buildReadlistUrl(requestReadlistContext(req).state));
			},
		);
	}

	return router;
}
