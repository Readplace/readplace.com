import {
	type ReaderSectionInput,
	requestedReaderSection,
} from "../../shared/article-body/reader-slot/section-pages";
import { upgradeOfferFor } from "../../shared/upgrade-offer/upgrade-offer";

import {
	DISMISS_COOKIE_NAME,
} from "@packages/onboarding-extension-signal";
import type { Request, Response, } from "express";
import { z } from "zod";
import type { SaveableUrlErrorCode, } from "@packages/domain/article";
import {
	parseEmailIssueArticleUrl,
} from "@packages/domain/inbox";
import type { ReaderProvenance } from "../../shared/article-body/article-header/provenance-label";
import type { UserId } from "@packages/domain/user";
import { buildKeepOfferShownEvent, KEEP_OFFER_SURFACES, classifyDeviceClass, classifyOsFamily, } from "@packages/web-analytics";
import type { ImportSkippedViewModel } from "./readlist.viewmodel";
import { NEXT_READ_MINIMUM_SAVES, hasEnoughSavesForNextRead } from "@packages/domain/article";
import type {
	FindArticlesResult,
	ReadlistDefinitionData,
} from "@packages/provider-contracts/article-store";
import type {
	ArticleCrawl,
	FindArticleCrawlStatuses,
} from "@packages/provider-contracts/article-crawl";
import type {
	FindGeneratedSummaries,
} from "@packages/provider-contracts/article-summary";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import { captureWatchQuery, } from "../../shared/article-reader/capture-watch";
import type { PollUrlBuilder, } from "../../shared/article-reader/article-reader.types";
import { EPUB_GUIDE_CONTENT, epubDownloadGuideFor, KINDLE_GUIDE_PATH, type EpubDownloadGuide } from "../../shared/epub/epub-download-guide";
import { articleEpubHref } from "../../shared/epub/epub-link";
import {
	initDeleteArticleFromReadlist,
	initDeleteArticleHighlightsUnlessSavedElsewhere,
	initPublishLinkDequeuedUnlessSavedElsewhere,
	initSaveArticleAtReadlistTop, initSaveArticleFromUrl,
} from "@packages/save-article";
import type {
	FindPastReads,
	FindRelatedArticles,
	PastReads,
	RelatedArticles,
} from "@packages/provider-contracts/related-articles";
import { Base, } from "../../base.component";
import {
	requireCspNonce,
	sendComponent,
	withInternalTracking,
} from "@packages/web-shell";
import { FreshForComponent } from "../../conditional-get";
import { buildSaveTip } from "../../shared/save-tip/save-tip.component";
import {
	parseReadlistUrl,
	READLIST_PATH,
	readlistReturnQuery,
	toArticleDiscoveryQuery,
	type ReadlistUrlState,
} from "./readlist.url";
import {
	type ReadlistContext,
	initResolveReadlistContext,
	mainlineReadlistContext,
	readerReadlists,
	sessionIdOf,
} from "./readlist-context";
import { readlistScopedStore } from "./readlist-scoped-store";
import {
	type ReadlistSlug,
	type ReadlistRef,
	readlistsHoldingArticle,
	DEFAULT_READLIST_SLUG,
} from "@packages/domain/readlist";
import {
	type ReaderReadlistFiling,
	buildReaderReadlistFiling,
} from "./reader-readlist-filing";
import { HIGHLIGHT_FEATURE, highlightFeatureEnabled } from "./highlight-feature";
import { ReadlistPage } from "./readlist.component";
import { initFindNonEmptyReadlists } from "./readlist-holdings";
import { buildReadlistRail } from "./readlist-rail";
import { tabQuery } from "./readlist.tabs";
import type { MoveFlash, StatusFlash } from "./readlist.error";
import { toReadlistViewModel } from "./readlist.viewmodel";
import { formatReaderDocumentTitle, } from "../reader/reader.component";
import { GMAIL_ONBOARDING_VERSION, NO_CLIENT_ONBOARDING_VERSION, ONBOARDING_VERSION, hasOutstandingGmailStep, hasOutstandingStep, onboardingVersion } from "../../onboarding/onboarding.steps";
import { gmailConnectionState, } from "@packages/domain/gmail";
import { canConnectGmail } from "../integrations/gmail-connection-access";
import {
	isExtensionInstalled,
	isExtensionSavedArticle,
	advertisedPlatformOf,
	type PitchablePlatform,
} from "../../onboarding/extension-install";
import {
	isNativeSurface,
	nativeSurfaceQuery,
} from "../../onboarding/native-client";
import type {
	GetOnboardingSignals,
	NativeAppPlatform,
} from "@packages/provider-contracts/onboarding-signals";
import type { InstallableClientOnboarding, OnboardingContext, Platform } from "../../onboarding/onboarding.types";
import type { EffectiveAccess, } from "@packages/subscription-access";
import type { ArticleDiscoveryQuery, ReadlistFilter, SavedArticle, ShownSummary, Viewer } from "@packages/domain/article";
import { ownedEnclosuresByUrl, viewerFor } from "@packages/domain/article";
import type { ResolveOnViewSurface } from "@packages/provider-contracts/events";
import { overlayResolution } from "../../../domain/resolve-on-view/request-resolution-on-view";
import { requestCanCapture } from "../../onboarding/capture-capable-request";
import { isPrefetchOrBot } from "../../shared/prefetch-request";
import type { ReadlistDependencies } from "./readlist-dependencies.types";

/** Client devices dismiss the version of their applicable checklist. Accounts
 * eligible for Gmail include it in that version; other accounts retain their
 * existing token. The no-client notice keeps its stable, independent token.
 * GET and POST use the same device and access predicates. */
export function dismissTokenFor(hasClient: boolean, gmailEligible = false): string {
	if (!hasClient) return NO_CLIENT_ONBOARDING_VERSION;
	return gmailEligible ? GMAIL_ONBOARDING_VERSION : ONBOARDING_VERSION;
}

export const SaveArticleReadlistsSchema = z.array(z.string()).optional().catch(undefined);

export async function loadSummaries(
	findGeneratedSummaries: FindGeneratedSummaries,
	articles: readonly SavedArticle[],
	viewer: Viewer,
	logError: (message: string, error?: Error) => void,
): Promise<Map<string, ShownSummary | undefined>> {
	const urls = articles.map((a) => a.url);
	try {
		const byUrl = await findGeneratedSummaries({ urls, viewer });
		return new Map(urls.map((url) => [url, byUrl.get(url)] as const));
	} catch (error) {
		// A whole-batch transport failure degrades every card to "no summary chip"
		// (the same visible outcome the old per-item allSettled produced), but log
		// it — the previous silent swallow made this class of failure invisible.
		logError("Failed to batch-load article summaries", error instanceof Error ? error : undefined);
		return new Map(urls.map((url) => [url, undefined] as const));
	}
}

export async function loadCrawls(
	findArticleCrawlStatuses: FindArticleCrawlStatuses,
	articles: readonly SavedArticle[],
	logError: (message: string, error?: Error) => void,
): Promise<Map<string, ArticleCrawl | undefined>> {
	const urls = articles.map((a) => a.url);
	try {
		const byUrl = await findArticleCrawlStatuses(urls);
		return new Map(urls.map((url) => [url, byUrl.get(url)] as const));
	} catch (error) {
		logError("Failed to batch-load article crawl statuses", error instanceof Error ? error : undefined);
		return new Map(urls.map((url) => [url, undefined] as const));
	}
}

export const joinedSurfaceQuery = (surfaceQuery: string): string =>
	surfaceQuery === "" ? "" : `&${surfaceQuery}`;

export const relatedPollUrlFor = (params: {
	articleId: string;
	pollCount: number;
	surfaceQuery: string;
}): string =>
	`${READLIST_PATH}/${params.articleId}/related?poll=${params.pollCount}${joinedSurfaceQuery(params.surfaceQuery)}`;

export async function loadRelatedArticles(
	findRelatedArticles: FindRelatedArticles,
	article: SavedArticle,
	logError: (message: string, error?: Error) => void,
): Promise<RelatedArticles> {
	try {
		return await findRelatedArticles({
			userId: article.userId,
			url: article.url,
		});
	} catch (error) {
		logError(
			"Failed to load related articles",
			error instanceof Error ? error : undefined,
		);
		return { status: "pending" };
	}
}

export const pastReadsPollUrlFor = (params: {
	articleId: string;
	pollCount: number;
	surfaceQuery: string;
}): string =>
	`${READLIST_PATH}/${params.articleId}/topic-reads?poll=${params.pollCount}${joinedSurfaceQuery(params.surfaceQuery)}`;

export async function loadPastReads(
	findPastReads: FindPastReads,
	article: SavedArticle,
	sourceReadlist: ReadlistSlug,
	logError: (message: string, error?: Error) => void,
): Promise<PastReads> {
	try {
		return await findPastReads({
			userId: article.userId,
			url: article.url,
			sourceReadlist,
		});
	} catch (error) {
		logError(
			"Failed to load previously read on this topic",
			error instanceof Error ? error : undefined,
		);
		return { status: "pending" };
	}
}

export function pastReadsPresentation(input: { pastReads: PastReads; now: Date }): {
	pastReads: PastReads;
	budgetBlocked: boolean;
} {
	const pastReads = input.pastReads;
	if (pastReads.status === "budget-limited") {
		return pastReads.until > input.now
			? { pastReads, budgetBlocked: true }
			: { pastReads: { status: "pending" }, budgetBlocked: false };
	}
	if (pastReads.status === "ready" && pastReads.budgetBlockedUntil !== undefined) {
		return { pastReads, budgetBlocked: pastReads.budgetBlockedUntil > input.now };
	}
	return { pastReads, budgetBlocked: false };
}

export const NO_READLIST_FILTER: ReadlistFilter = { time: [], saved: [] };

export const SAVE_ROUTE = {
	saveArticle: "/",
	saveArticles: "/save-articles",
	save: "/save",
	saveContent: "/save-content",
} as const;

/** Root ("/") maps to READLIST_PATH alone; appending it would record a spurious "/queue/" trailing slash. */
const saveIntentPath = (route: string): string =>
	route === "/" ? READLIST_PATH : `${READLIST_PATH}${route}`;

export const SAVE_INTENT_PATH = {
	saveArticle: saveIntentPath(SAVE_ROUTE.saveArticle),
	saveArticles: saveIntentPath(SAVE_ROUTE.saveArticles),
	save: saveIntentPath(SAVE_ROUTE.save),
	saveContent: saveIntentPath(SAVE_ROUTE.saveContent),
} as const;

/** True when the client wants an app's chromeless reader rather than the full web
 * shell — chosen by an explicit client signal, never a user-agent sniff. The app
 * appends `?platform=` to the `read` link it loads in its web view; the
 * `x-readplace-client` header is honoured alongside it so a store-reviewed build
 * predating the query param — which cannot deploy in lockstep with the server —
 * still resolves to its chromeless reader. */
export const isAppPlatform = (req: Request): boolean => isNativeSurface(req);

export function readerReadlistFilingFrom(input: {
	article: SavedArticle;
	definitions: readonly ReadlistDefinitionData[];
	saves: readonly { readlist?: ReadlistSlug }[];
	signals: Awaited<ReturnType<GetOnboardingSignals>>;
	returnTo: string;
	filed: ReadlistSlug | undefined;
}): ReaderReadlistFiling {
	return buildReaderReadlistFiling({
		articleId: input.article.id.value,
		definitions: input.definitions,
		saves: input.saves,
		returnTo: input.returnTo,
		filed: input.filed,
		markStatusConfirmGated:
			readerReadlists(input.definitions).length > 1 &&
			input.signals.markReadAcrossQueuesAckedAt === undefined,
	});
}

/** Whose install/save signals a device's platform reads: a native app's own
 * server-side pair, or `undefined` for the extension's same-browser cookies.
 * Every platform is answered explicitly, so a new content-capture client is a
 * compile error here until it is told which signals it ticks — a phone app
 * silently reading another phone's pair would tick a step on a device the user
 * does not have. */
const NATIVE_APP_SIGNAL_PLATFORM = {
	iphone: "ios",
	android: "android",
	firefox: undefined,
	chrome: undefined,
	other: undefined,
} as const satisfies Record<Platform, NativeAppPlatform | undefined>;

export const ISSUE_LINK_SAVED_PARAM = "issue_link_saved";

export function initReadlistShared(deps: ReadlistDependencies) {
	const saveArticleFromUrl = initSaveArticleFromUrl(deps);
	const saveArticleAtReadlistTop = initSaveArticleAtReadlistTop({
		allocateSavedAt: deps.allocateSavedAt,
		saveArticleFromUrl,
	});
	const resolveReadlistContext = initResolveReadlistContext({
		listReadlistDefinitions: deps.listReadlistDefinitions,
		findSessionReadlistFilter: deps.findSessionReadlistFilter,
	});

	/** Mutation and redirect handlers read the addressed readlist from the URL alone.
	 * A shape-valid readlist the reader does not own binds to a partition holding no
	 * rows, so the write no-ops on its `attribute_exists` condition and the reader
	 * lands back on a listing the next GET resolves for real. */
	const requestReadlistContext = (req: Request): ReadlistContext => ({
		...mainlineReadlistContext(req.query),
		state: parseReadlistUrl(req.query),
	});

	const publishLinkDequeuedUnlessSavedElsewhere = initPublishLinkDequeuedUnlessSavedElsewhere({
		listUserSavesForUrl: deps.listUserSavesForUrl,
		publishLinkDequeued: deps.publishLinkDequeued,
	});

	const deleteArticleHighlightsUnlessSavedElsewhere = initDeleteArticleHighlightsUnlessSavedElsewhere({
		listUserSavesForUrl: deps.listUserSavesForUrl,
		deleteArticleHighlights: deps.deleteArticleHighlights,
	});

	/** The one place a request's readlist decides which rows it reads and writes.
	 * The default readlist answers with the untouched mainline dependencies, so every
	 * handler below runs today's code path byte for byte unless a reader addressed
	 * one of their own readlists. */
	const storeFor = (readlist: ReadlistSlug) => readlistScopedStore(deps, readlist);

	const rememberReadlistFilter = async (req: Request, filter: ReadlistFilter): Promise<void> => {
		const sessionId = sessionIdOf(req);
		if (sessionId === undefined) return;
		await deps.setSessionReadlistFilter({ sessionId, filter });
	};

	const storeDiscoveryOf = (state: ReadlistUrlState): ArticleDiscoveryQuery | undefined =>
		state.discovery === undefined ? undefined : toArticleDiscoveryQuery(state.discovery, deps.now());

	const findNonEmptyReadlists = initFindNonEmptyReadlists({ countReadlistArticles: deps.countReadlistArticles });

	const deleteArticleFromReadlistFor = (readlist: ReadlistSlug) =>
		initDeleteArticleFromReadlist({
			...deps,
			deleteArticle: storeFor(readlist).deleteArticle,
			publishLinkDequeued: publishLinkDequeuedUnlessSavedElsewhere,
			deleteArticleHighlights: deleteArticleHighlightsUnlessSavedElsewhere,
		});

	const purgeArticleFromReadlistFor = (readlist: ReadlistSlug) =>
		initDeleteArticleFromReadlist({
			...deps,
			deleteArticle: (id, userId) => deps.purgeReadlistArticle({ id, userId, readlist }),
			publishLinkDequeued: publishLinkDequeuedUnlessSavedElsewhere,
			deleteArticleHighlights: deleteArticleHighlightsUnlessSavedElsewhere,
		});

	/** An onboarding signal is non-essential bookkeeping that sits on the critical
	 * path of the app's readlist load and every save. Unlike the extension's
	 * equivalent — a Set-Cookie header that cannot fail — these writes hit DynamoDB
	 * and can throw (a transient error, or `assert(row)` firing for a token that
	 * outlived a deleted account). Swallow and log so the bookkeeping can never
	 * turn a successful save into a 500 or break the iPhone app's readlist load; the
	 * signal is allowed to lag a render and catch up on the next request. */
	const recordOnboardingSignalBestEffort = async (record: () => Promise<void>): Promise<void> => {
		try {
			await record();
		} catch (error) {
			deps.logError(
				"Failed to record onboarding signal",
				error instanceof Error ? error : undefined,
			);
		}
	};

	const reader = initArticleReader({
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		findGeneratedSummary: deps.findGeneratedSummary,
		readArticleContent: deps.readArticleContent,
		findArticleByUrl: deps.findArticleByUrl,
		findItemOwner: deps.findItemOwner,
		findArticleFreshness: deps.findArticleFreshness,
		findArticleCrawlVersions: deps.findArticleCrawlVersions,
		appOrigin: deps.appOrigin,
		now: deps.now,
		formatDocumentTitle: formatReaderDocumentTitle,
		summaryOpen: false,
		requestResolutionOnView: deps.requestResolutionOnView,
	});
	function pollUrlBuilderFor(req: Request, articleId: string): PollUrlBuilder {
		const readlist = readlistReturnQuery(parseReadlistUrl(req.query)).slice(1);
		const section = requestedReaderSection(req.query.section);
		const surface = `${readlist === "" ? "" : `&${readlist}`}${joinedSurfaceQuery(nativeSurfaceQuery(req))}${section === undefined ? "" : `&section=${section}`}${
			highlightFeatureEnabled(req.query) ? `&feature=${HIGHLIGHT_FEATURE}` : ""
		}`;
		return {
			summary: (n) => `${READLIST_PATH}/${articleId}/summary?poll=${n}${surface}`,
			reader: (n, capture) =>
				`${READLIST_PATH}/${articleId}/reader?poll=${n}${captureWatchQuery(capture)}${surface}`,
		};
	}

	const ownerReaderSection = (req: Request, articleId: string): ReaderSectionInput => {
		const readlist = requestReadlistContext(req).state.readlist;
		return {
			requested: requestedReaderSection(req.query.section),
			readerPath: readerPathForReadlist(req)(articleId, readlist === DEFAULT_READLIST_SLUG ? undefined : readlist),
			thresholdBytes: deps.readerSectionThresholdBytes,
		};
	};

	const readerPathFor =
		(req: Request) =>
		(articleId: string): string => {
			const surface = nativeSurfaceQuery(req);
			return surface === ""
				? `${READLIST_PATH}/${articleId}/view`
				: `${READLIST_PATH}/${articleId}/view?${surface}`;
		};

	// A past-read match opens where the reader owns it: the destination readlist
	// (resolved server-side, absent for the default list) rides the `queue` param
	// alongside the preserved native-surface markers.
	const readerPathForReadlist =
		(req: Request) =>
		(articleId: string, readlist?: ReadlistSlug): string => {
			const parts: string[] = [];
			const surface = nativeSurfaceQuery(req);
			if (surface !== "") parts.push(surface);
			if (readlist !== undefined) parts.push(`queue=${encodeURIComponent(readlist)}`);
			const query = parts.join("&");
			return query === ""
				? `${READLIST_PATH}/${articleId}/view`
				: `${READLIST_PATH}/${articleId}/view?${query}`;
		};

	const readerReturnPath = (req: Request, articleId: string): string =>
		readerPathFor(req)(articleId);

	const epubGuideFor = (req: Request, article: SavedArticle): EpubDownloadGuide | undefined =>
		isAppPlatform(req) || parseEmailIssueArticleUrl(article.url) !== undefined
			? undefined
			: epubDownloadGuideFor({
					osFamily: classifyOsFamily(req.get("user-agent")),
					downloadHref: articleEpubHref({ articleUrl: article.url, utmSource: "reader", appClient: undefined }),
					learnMoreHref: withInternalTracking(KINDLE_GUIDE_PATH, { source: "reader", content: EPUB_GUIDE_CONTENT }),
				});

	/** Resolves how far the account is toward the Next Read minimum, capped at it.
	 * Once the milestone is stamped the answer is the cap and no count is issued,
	 * which is both what makes the step sticky against later deletions and what
	 * keeps a bounded COUNT query off the steady-state `/queue` render. Stamping
	 * here memoises an observation the same request already made — the account
	 * really does hold that many saves — rather than mutating anything the user
	 * can see, which is why it is allowed on a GET. */
	const resolveSavedCount = async (
		userId: UserId,
		nextReadMinimumReachedAt: Date | undefined,
	): Promise<number> => {
		if (nextReadMinimumReachedAt) {
			return NEXT_READ_MINIMUM_SAVES;
		}
		const savedCount = await deps.countArticlesByUser({
			userId,
			countLimit: NEXT_READ_MINIMUM_SAVES,
		});
		if (hasEnoughSavesForNextRead(savedCount)) {
			await recordOnboardingSignalBestEffort(() =>
				deps.recordNextReadMinimumReached({ userId }),
			);
		}
		return savedCount;
	};

	const gmailEligibleFor = (req: Request, access: EffectiveAccess): boolean =>
		deps.findGmailConnectionByUserId !== undefined &&
		req.verificationStatus?.state !== "locked" && canConnectGmail(access);

	/** Resolves the onboarding-checklist signals for an authenticated `/queue`
	 * HTML render.
	 *
	 * Completion source is resolved by platform: iPhone reads the per-user
	 * server-side iOS signal (Safari can't see the app's cookies); every other
	 * platform reads the same-browser extension liveness/save cookies.
	 *
	 * Dismissal compares the cookie against {@link dismissTokenFor} for the device
	 * class. Client devices additionally require the install step complete in *this*
	 * context: the dismiss button only appears once every step is done, so a dismiss
	 * without `installed` means a different context (a different browser, or a phone
	 * whose app isn't signed in) — re-show so the user can finish here. When a client
	 * later ships for a currently-clientless device, hasClient flips true and the read
	 * falls through to this `installed && …` arm, where the no-client token no longer
	 * matches and the new client isn't installed, so onboarding re-appears.
	 * Outstanding Gmail always overrides a whole-checklist dismissal; its own
	 * permanent dismissal is account-scoped and independent of this cookie. */
	const resolveOnboardingSignals = async (req: Request, userId: UserId, access: EffectiveAccess) => {
		const advertisedPlatform = advertisedPlatformOf(req);
		const platform: PitchablePlatform = advertisedPlatform ?? "other";
		const hasClient = advertisedPlatform !== undefined;
		const dismissCookie = req.cookies?.[DISMISS_COOKIE_NAME];
		const gmailEligible = gmailEligibleFor(req, access);
		const dismissTokenMatches = dismissCookie === dismissTokenFor(hasClient, gmailEligible);
		const onboardingCompletedBefore =
			dismissCookie !== undefined && dismissCookie !== NO_CLIENT_ONBOARDING_VERSION;
		const [signals, connection] = await Promise.all([
			deps.getOnboardingSignals({ userId }),
			gmailEligible && deps.findGmailConnectionByUserId
				? deps.findGmailConnectionByUserId(userId)
				: undefined,
		]);
		const gmailState = gmailConnectionState(connection);
		const gmail = gmailEligible ? {
			connected: !["disconnected", "disconnecting", "revoked"].includes(gmailState),
			dismissed: signals.gmailStepDismissedAt !== undefined,
		} : undefined;
		const markReadAcrossQueuesAckedAt = signals.markReadAcrossQueuesAckedAt;
		const deleteArticleAckedAt = signals.deleteArticleAckedAt;
		if (!hasClient) {
			const noClientContext = { hasInstallableClient: false, gmail } satisfies OnboardingContext;
			return {
				markReadAcrossQueuesAckedAt,
				deleteArticleAckedAt,
				onboarding: {
					context: noClientContext,
					dismissed: dismissTokenMatches,
					completedBefore: onboardingCompletedBefore,
					completionUnearned: false,
				},
			};
		}
		const nativeAppPlatform = NATIVE_APP_SIGNAL_PLATFORM[platform];
		const { installed, savedArticle } = nativeAppPlatform
			? signals.nativeApp[nativeAppPlatform]
			: { installed: isExtensionInstalled(req), savedArticle: isExtensionSavedArticle(req) };
		const savedCount = await resolveSavedCount(userId, signals.nextReadMinimumReachedAt);
		const context: InstallableClientOnboarding = {
			hasInstallableClient: true,
			gmail,
			platform,
			installed,
			savedArticle,
			savedCount,
			inboxArticleQueued: signals.firstInboxArticleQueuedAt !== undefined,
			emailStepMarkedDone: signals.emailStepMarkedDoneAt !== undefined,
		};
		const version = onboardingVersion(context);
		const seenUnderThisVersion = signals.onboardingOutstandingVersion === version;
		if (!seenUnderThisVersion && hasOutstandingStep(context)) {
			await recordOnboardingSignalBestEffort(() =>
				deps.recordOnboardingOutstandingVersion({ userId, version }),
			);
		}
		return {
			markReadAcrossQueuesAckedAt,
			deleteArticleAckedAt,
			onboarding: {
				context,
				dismissed: installed && dismissTokenMatches && !hasOutstandingGmailStep(context),
				completedBefore: onboardingCompletedBefore,
				completionUnearned: !seenUnderThisVersion,
			},
		};
	};

	const savesAcrossReadlists = async (params: {
		userId: UserId;
		context: ReadlistContext;
		urls: readonly string[];
	}): Promise<ReadonlyMap<string, readonly { readlist?: ReadlistSlug }[]> | undefined> => {
		if (params.context.readlists.length <= 1) return undefined;
		return deps.listUserSavesForUrls({
			userId: params.userId,
			urls: params.urls,
			readlists: params.context.readlists.map((readlist) => readlist.slug),
		});
	};

	const markStatusConfirmReadlistsFor = (params: {
		context: ReadlistContext;
		urls: readonly string[];
		savesByUrl: ReadonlyMap<string, readonly { readlist?: ReadlistSlug }[]> | undefined;
		acknowledgedAt: Date | undefined;
	}): ReadonlyMap<string, readonly ReadlistRef[]> | undefined => {
		const { savesByUrl } = params;
		if (savesByUrl === undefined || params.acknowledgedAt !== undefined) return undefined;
		return new Map(
			params.urls.map((url) => [
				url,
				readlistsHoldingArticle({
					saves: savesByUrl.get(url) ?? [],
					readlists: params.context.readlists,
				}),
			]),
		);
	};

	const readlistHoldsAnyArticle = async (params: {
		userId: UserId;
		readlist: ReadlistSlug;
		result: FindArticlesResult;
	}): Promise<boolean> => {
		if (params.result.articles.length > 0) return true;
		const held = await storeFor(params.readlist).countArticlesByUser({
			userId: params.userId,
			countLimit: 1,
		});
		return held > 0;
	};

	const openTabHoldsRows = async (params: {
		userId: UserId;
		state: ReadlistUrlState;
		result: FindArticlesResult;
	}): Promise<boolean> => {
		if (params.result.articles.length > 0) return true;
		if (params.state.discovery === undefined) return false;
		const held = await storeFor(params.state.readlist).countArticlesByUser({
			userId: params.userId,
			status: tabQuery(params.state.tab).status,
			countLimit: 1,
		});
		return held > 0;
	};

	/** Renders the full readlist listing from an already-fetched page of rows — the
	 * tail shared by the top-of-page GET and the card-mutation fallback. Never
	 * fetches the listing itself, so GET stays single-fetch and the fallback can
	 * feed it the metadata-only page probe it already holds. */
	const resolveListedOnView = async (
		req: Request,
		listed: {
			userId: UserId;
			surface: ResolveOnViewSurface;
			articles: readonly SavedArticle[];
			crawlByUrl: ReadonlyMap<string, ArticleCrawl | undefined>;
			summaryByUrl: ReadonlyMap<string, ShownSummary | undefined>;
		},
	) => {
		if (isPrefetchOrBot(req)) return { crawlByUrl: listed.crawlByUrl, summaryByUrl: listed.summaryByUrl };
		const resolved = await deps.requestResolutionOnView({
			surface: listed.surface,
			viewer: viewerFor(listed.userId),
			viewerCanCapture: requestCanCapture(req),
			articles: listed.articles.map((article) => ({
				url: article.url,
				crawl: listed.crawlByUrl.get(article.url),
				summary: listed.summaryByUrl.get(article.url),
			})),
		});
		return overlayResolution(listed.crawlByUrl, listed.summaryByUrl, resolved);
	};

	const renderReadlistListing = async (
		req: Request,
		res: Response,
		input: {
			userId: UserId;
			context: ReadlistContext;
			result: FindArticlesResult;
			saveError?: string;
			saveErrorCode?: SaveableUrlErrorCode;
			importFlash?: string;
			statusFlash?: StatusFlash;
			moveFlash?: MoveFlash;
			importSkipped?: ImportSkippedViewModel;
			saveUrl?: string;
		},
	): Promise<void> => {
		const effectiveAccessPromise = deps.getEffectiveAccess(input.userId);
		const urls = input.result.articles.map((article) => article.url);
		const [loadedSummaryByUrl, loadedCrawlByUrl, effectiveAccess, readlistHoldsArticles, tabHoldsRows, signals, nonEmptyReadlists, savesByUrl, readerProvenances, keepOffer] =
			await Promise.all([
				loadSummaries(deps.findGeneratedSummaries, input.result.articles, viewerFor(input.userId), deps.logError),
				loadCrawls(deps.findArticleCrawlStatuses, input.result.articles, deps.logError),
				effectiveAccessPromise,
				readlistHoldsAnyArticle({
					userId: input.userId,
					readlist: input.context.state.readlist,
					result: input.result,
				}),
				openTabHoldsRows({
					userId: input.userId,
					state: input.context.state,
					result: input.result,
				}),
				effectiveAccessPromise.then((access) => resolveOnboardingSignals(req, input.userId, access)),
				findNonEmptyReadlists({ userId: input.userId, readlists: input.context.readlists }),
				savesAcrossReadlists({ userId: input.userId, context: input.context, urls }),
				deps.resolveReaderProvenances(input.result.articles.map((article) => article.provenance)),
				deps.keepOffer.eligibility(input.userId),
			]);
		const { crawlByUrl, summaryByUrl } = await resolveListedOnView(req, {
			userId: input.userId,
			surface: "readlist-html",
			articles: input.result.articles,
			crawlByUrl: loadedCrawlByUrl,
			summaryByUrl: loadedSummaryByUrl,
		});
		const readerProvenanceByUrl = new Map(
			input.result.articles.map((article, index): [string, ReaderProvenance | undefined] => [
				article.url,
				readerProvenances[index],
			]),
		);
		const confirmReadlistsByUrl = markStatusConfirmReadlistsFor({
			context: input.context,
			urls,
			savesByUrl,
			acknowledgedAt: signals.markReadAcrossQueuesAckedAt,
		});
		const upgradeOffer = upgradeOfferFor({ req, access: effectiveAccess });
		const vm = toReadlistViewModel(input.result, input.context.state, {
			errors: input.saveError ? [{ message: input.saveError }] : undefined,
			saveErrorCode: input.saveErrorCode,
			importFlash: input.importFlash,
			statusFlash: input.statusFlash,
			importSkipped: input.importSkipped,
			summaryByUrl,
			crawlByUrl,
			enclosureByUrl: ownedEnclosuresByUrl({ viewer: viewerFor(input.userId), articles: input.result.articles }),
			readerProvenanceByUrl,
			effectiveAccess,
			upgradeOffer,
			now: deps.now(),
			confirmReadlistsByUrl,
			deleteAcknowledged: signals.deleteArticleAckedAt !== undefined,
			readlists: input.context.readlists,
			savesByUrl,
			moveFlash: input.moveFlash,
		});
		const onboarding = signals.onboarding;
		const cspNonce = requireCspNonce(req);
		const pageOptions = { onboarding, cspNonce, readlistHoldsArticles, tabHoldsRows, saveUrl: input.saveUrl, deviceClass: classifyDeviceClass(req.get("user-agent")), rail: buildReadlistRail({ context: input.context, accessIsReadOnly: vm.accessIsReadOnly, offer: upgradeOffer, nonEmptyReadlists }), saveTip: buildSaveTip(req, { kind: "article", mode: "advisory" }), purpose: input.context.activePurpose };
		const page = ReadlistPage(vm, { ...pageOptions, keepOffer, query: req.query });
		if (keepOffer.shown) {
			deps.recordAnalyticsEvent(
				req,
				buildKeepOfferShownEvent(
					{ now: deps.now, salt: deps.salt },
					{ req, userId: input.userId, surface: KEEP_OFFER_SURFACES.readlistPanel, trialDay: keepOffer.trialDay },
				),
			);
		}
		res.vary("Cookie");
		sendComponent(
			req, res,
			FreshForComponent(
				Base(
					page,
					await deps.buildBannerState(req, { preFetchedAccess: effectiveAccess, upgradeSource: "queue-banner" }),
				),
				{ ifNoneMatch: req.get("If-None-Match"), cspNonce, cacheControl: "private, max-age=5" },
			),
		);
	};

	return {
		saveArticleAtReadlistTop,
		resolveReadlistContext,
		requestReadlistContext,
		storeFor,
		rememberReadlistFilter,
		storeDiscoveryOf,
		findNonEmptyReadlists,
		deleteArticleFromReadlistFor,
		purgeArticleFromReadlistFor,
		recordOnboardingSignalBestEffort,
		reader,
		pollUrlBuilderFor,
		ownerReaderSection,
		readerPathFor,
		readerPathForReadlist,
		readerReturnPath,
		epubGuideFor,
		gmailEligibleFor,
		resolveOnboardingSignals,
		savesAcrossReadlists,
		markStatusConfirmReadlistsFor,
		resolveListedOnView,
		renderReadlistListing,
	};
}

export type ReadlistShared = ReturnType<typeof initReadlistShared>;
