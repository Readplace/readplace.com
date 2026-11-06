
import assert from "node:assert";
import {
	EXTENSION_LIVENESS_TTL_MS,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { BulkSaveOutcome, SaveAttemptId, SaveTrigger, SaveableUrl, SaveableUrlErrorCode, ValidateSaveableUrl } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { SaveAttemptIdSchema, newSaveAttemptId, BulkSaveManifestSchema, MAX_PAGES_PER_BULK_SAVE, MAX_UPLOAD_REQUEST_BYTES, } from "@packages/domain/article";
import { buildSaveIntentEvent, } from "@packages/web-analytics";
import { SAVE_OUTCOMES, SAVE_SURFACES, type SaveOutcome, type SaveSurface } from "../../../observability/events";
import { saveClientOf } from "../../shared/save-client";
import { isNonArticleHost, viewerFor } from "@packages/domain/article";
import { CaptureTriggerSchema, type CaptureTrigger, } from "@packages/domain/article";
import type { ResolvedFreshnessResult } from "@packages/provider-contracts/article-freshness";
import { isPDF, MAX_HTML_BYTES, MAX_PDF_BYTES } from "@packages/crawl-article";
import { initMultipartUpload } from "../import/multipart-upload";
import { UPLOAD_COMPLETION_MAX_AGE_SECONDS } from "./upload-slot-ttl";
import { initSaveContentLimitHandler } from "./save-content-limit-handler";
import { initSaveArticlesLimitHandler } from "./save-articles-limit-handler";
import {initSaveArticleFromUrl,
	rankNewLinksAbove,
} from "@packages/save-article";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { tagSaveRefusal } from "../../shared/save-refusal";
import { SAVE_REFUSAL_CODES } from "@packages/web-analytics";
import { markSaveTipSeen } from "../../shared/save-tip/save-tip";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";
import { toArticleCollectionEntity } from "../../api/collection-siren";
import { toBulkSaveResultEntity } from "../../api/bulk-save-siren";
import { toSavedArticleEntity } from "../../api/article-siren";
import { readlistsAtHrefs } from "../../api/readlist-href";
import { megabytesLabel } from "../../shared/bytes-to-mb";
import { toUploadSlotEntity } from "../../api/upload-slot-siren";
import { saveQueuedSirenNotice } from "../../api/save-queued-siren";
import {
	parseReadlistUrl,
	buildReadlistUrl,
	READLIST_PATH,
} from "./readlist.url";
import {
	readlistToFileInto,
} from "./readlist-context";
import { DEFAULT_READLIST } from "./readlist.nav";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import { READLIST_TAB_STATUSES, } from "./readlist.tabs";
import { readlistPageSizeForClient } from "./readlist-page-size";
import { addToReadlistOfferForClient } from "./add-to-readlist-offer";
import { resolveSaveProvenance } from "../../shared/save-provenance";
import { SAVE_FAILED_MESSAGE, READLIST_NOTICE_SAVE_QUEUED, saveFormRejectionMessage, } from "./readlist.error";
import { ADD_LINK_POPOVER_ID, type AddLinkFormError, renderAddLinkForm } from "./readlist-add-link.component";
import { type HxLocationScroll, hxLocationToMain } from "../../hx-location";
import {
	isIosBuildBeforeRekeyedShareTargets,
	nativeClientOf,
	nativeSurfaceOf,
	readlistQueryKeyOf,
} from "../../onboarding/native-client";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import { type ReadlistShared, SaveArticleReadlistsSchema, loadSummaries, loadCrawls, NO_READLIST_FILTER, SAVE_ROUTE, SAVE_INTENT_PATH, } from "./readlist-shared";

function markExtensionSavedArticle(res: Response, { secureCookies }: { secureCookies: boolean }): void {
	res.cookie(SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE, {
		path: "/",
		maxAge: EXTENSION_LIVENESS_TTL_MS,
		sameSite: "lax",
		httpOnly: true,
		secure: secureCookies,
	});
}

type SaveContentResult =
	| { ok: true; dispatch: () => Promise<void> }
	| { ok: false; code: string; message: string };

type SaveContentMedia = {
	uploadCeilingBytes: number;
	stageInlineBytes: (input: {
		url: string;
		bytes: Buffer;
		title?: string;
		userId: UserId;
		saveAttemptId: SaveAttemptId;
		sourceUrl: string;
		sourceOriginalUrl: string;
		captureTrigger: CaptureTrigger;
	}) => Promise<SaveContentResult>;
	admitUploadedBytes: (input: {
		url: string;
		mediaType: string;
		title?: string;
		userId: UserId;
		saveAttemptId: SaveAttemptId;
		sourceUrl: string;
		sourceOriginalUrl: string;
		captureTrigger: CaptureTrigger;
	}) => Promise<SaveContentResult>;
};

const ORIGINAL_UNRESOLVED_MESSAGE = "The original article could not be resolved. Try saving the original link.";

const NOT_A_PDF: SaveContentResult = {
	ok: false,
	code: "not-a-pdf",
	message: "Uploaded bytes do not look like a PDF (missing %PDF- magic header)",
};

function normalizeMediaType(mediaType: string): string {
	const base = mediaType.split(";")[0].trim().toLowerCase();
	if (isPDF({ contentType: base })) return "application/pdf";
	return base;
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

const SAVE_ATTEMPT_ID_HEADER = "x-readplace-save-attempt-id";

export function initReadlistSaveRoutes(
	deps: Pick<
		ReadlistDependencies,
		"saveArticleKeepingPosition" | "saveArticleWithoutActivity" | "recordNativeAppSavedArticle" | "secureCookies" | "recordAnalyticsEvent" | "now" | "salt" | "publishSubmitLink" | "putPendingPdf" | "publishSaveLinkRawPdfCommand" | "readPendingUploadPrefix" | "putPendingHtml" | "publishSaveLinkRawHtmlCommand" | "requireWriteAccess" | "validateNewSaveUrl" | "findArticlesByUser" | "findArticleCrawlStatuses" | "logError" | "findGeneratedSummaries" | "refreshArticleIfStale" | "fileArticleIntoReadlist" | "refreshArticleIfStaleStored" | "findSavedUrls" | "allocateSavedAtSequence" | "recordEngagementActivity" | "allocateSavedAt" | "validateSaveableUrl" | "statPendingUpload" | "resolveSaveIdentity" | "createUploadSlot" | "updateArticleStatus" | "markCrawlPending" | "markSummaryPending" | "pinContentSource" | "publishUpdateFetchTimestamp" | "publishLinkSaved" | "publishLinkQueued" | "publishQueueEntryCreated" | "publishComputeRelatedPasses" | "publishComputeRelatedPastReads" | "readRelatedPassRequestState" | "markRelatedPassesRequested"
	>,
	shared: ReadlistShared,
): Router {
	const router = express.Router();
	const { saveArticleAtReadlistTop, resolveReadlistContext, rememberReadlistFilter, recordOnboardingSignalBestEffort } = shared;

	const attachArticleContent = initSaveArticleFromUrl({
		...deps,
		saveArticle: deps.saveArticleKeepingPosition,
	});
	const saveArticleFromUrlWithoutActivity = initSaveArticleFromUrl({
		...deps,
		saveArticle: deps.saveArticleWithoutActivity,
	});

	/** Records that the user saved their first article. From a native app (client
	 * header present) this is a per-user server-side write so the phone browser's
	 * `/queue` can read it; from the extension it is the same-browser-jar liveness
	 * cookie. */
	const recordSaveSignal = async (req: Request, res: Response, userId: UserId): Promise<void> => {
		const platform = nativeClientOf(req);
		if (platform) {
			await recordOnboardingSignalBestEffort(() =>
				deps.recordNativeAppSavedArticle({ userId, platform }),
			);
			return;
		}
		markExtensionSavedArticle(res, { secureCookies: deps.secureCookies });
	};

	/** Records a save-intent for an authenticated save surface. The save has
	 * already happened (or failed) by the time this is called, so `outcome` is
	 * `saved` or `error` — never `prompted_to_sign_up`, which is anonymous-only. */
	const emitSaveIntent = (params: {
		req: Request;
		url: string;
		path: string;
		surface: SaveSurface;
		outcome: SaveOutcome;
	}): void => {
		deps.recordAnalyticsEvent(
			params.req,
			buildSaveIntentEvent({ now: deps.now, salt: deps.salt }, { ...params, client: saveClientOf(params.req) }),
		);
	};

	const queueUnresolvedSave = async (params: {
		req: Request;
		res: Response;
		userId: UserId;
		url: SaveableUrl;
		readlists: Iterable<ReadlistSlug>;
		saveTrigger: SaveTrigger;
		saveAttemptId: SaveAttemptId;
		path: string;
	}): Promise<void> => {
		for (const readlist of params.readlists) {
			await deps.publishSubmitLink({
				url: params.url,
				userId: params.userId,
				provenance: resolveSaveProvenance(params.req.oauthClientId),
				readlist,
				saveTrigger: params.saveTrigger,
				saveAttemptId: params.saveAttemptId,
			});
		}
		emitSaveIntent({ req: params.req, url: params.url, path: params.path, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
		params.res
			.status(409)
			.type(SIREN_MEDIA_TYPE)
			.json(saveQueuedSirenNotice());
	};

	const saveContentMedia: Record<string, SaveContentMedia> = {
		"application/pdf": {
			uploadCeilingBytes: MAX_PDF_BYTES.bytes,
			stageInlineBytes: async ({ url, bytes, title, userId, saveAttemptId, sourceUrl, sourceOriginalUrl }) => {
				if (!isPDF({ bodyBytes: bytes })) return NOT_A_PDF;
				await deps.putPendingPdf({ url, bytes, saveAttemptId });
				return { ok: true, dispatch: () => deps.publishSaveLinkRawPdfCommand({ url, userId, title, saveAttemptId, sourceUrl, sourceOriginalUrl }) };
			},
			admitUploadedBytes: async ({ url, mediaType, title, userId, saveAttemptId, sourceUrl, sourceOriginalUrl }) => {
				const prefix = await deps.readPendingUploadPrefix({ url, mediaType, bytes: 8, saveAttemptId });
				if (!isPDF({ bodyBytes: prefix })) return NOT_A_PDF;
				return { ok: true, dispatch: () => deps.publishSaveLinkRawPdfCommand({ url, userId, title, saveAttemptId, sourceUrl, sourceOriginalUrl }) };
			},
		},
		"text/html": {
			uploadCeilingBytes: MAX_HTML_BYTES.bytes,
			stageInlineBytes: async ({ url, bytes, title, userId, saveAttemptId, sourceUrl, sourceOriginalUrl, captureTrigger }) => {
				await deps.putPendingHtml({ url, html: bytes.toString("utf8"), saveAttemptId });
				return { ok: true, dispatch: () => deps.publishSaveLinkRawHtmlCommand({ url, userId, title, saveAttemptId, sourceUrl, sourceOriginalUrl, captureTrigger }) };
			},
			admitUploadedBytes: async ({ url, title, userId, saveAttemptId, sourceUrl, sourceOriginalUrl, captureTrigger }) => {
				return { ok: true, dispatch: () => deps.publishSaveLinkRawHtmlCommand({ url, userId, title, saveAttemptId, sourceUrl, sourceOriginalUrl, captureTrigger }) };
			},
		},
	};

	const mediaFor = (params: { mediaType: string; url: string }): SaveContentMedia | undefined =>
		isNonArticleHost(params.url)
			? undefined
			: saveContentMedia[normalizeMediaType(params.mediaType)];

	const parseCaptureTrigger = (raw: string | undefined) =>
		CaptureTriggerSchema.default("manual").safeParse(raw);

	router.post(SAVE_ROUTE.saveArticle, requireNotLocked, deps.requireWriteAccess, express.json(), async (req: Request, res: Response) => {
		if (!wantsSiren(req)) {
			res.status(406).send("Not Acceptable");
			return;
		}

		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const context = await resolveReadlistContext(req, userId);
		const submittedUrl = typeof req.body?.url === "string" ? req.body.url : "";
		const validation = deps.validateNewSaveUrl(submittedUrl);

		if (validation.status === "ERROR") {
			emitSaveIntent({ req, url: submittedUrl, path: SAVE_INTENT_PATH.saveArticle, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
			if (validation.error.code === "malformed_url") {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code: "invalid-url", message: validation.error.message }),
				);
				return;
			}
			/** Scheme/host that the crawler can't reach (chrome://, file:,
			 * localhost, *.home.arpa, ...). Return the current collection so
			 * the extension can drop the user back into the list view, and
			 * surface a `warning` property carrying the failure code + a
			 * human-readable message that the client can render as a warning
			 * banner alongside the list. */
			const collection = await deps.findArticlesByUser({
				userId,
				includeTotal: true,
				pageSize: readlistPageSizeForClient(req.oauthClientId),
				excludeContent: true,
			});
			const [crawlByUrl, summaryByUrl] = await Promise.all([
				loadCrawls(deps.findArticleCrawlStatuses, collection.articles, deps.logError),
				loadSummaries(deps.findGeneratedSummaries, collection.articles, viewerFor(userId), deps.logError),
			]);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				toArticleCollectionEntity(
					collection,
					{ readlistKey: readlistQueryKeyOf(req), page: collection.page },
					{
						tabs: READLIST_TAB_STATUSES,
						readlists: context.readlists,
						addToReadlist: addToReadlistOfferForClient(req.oauthClientId),
						now: deps.now(),
						warning: { code: validation.error.code, message: validation.error.message },
						surfacePlatform: nativeSurfaceOf(req),
						crawlByUrl,
						summaryByUrl,
					},
				),
			);
			return;
		}

		try {
			const addressedFiling = readlistToFileInto(context);
			const ticked = readlistsAtHrefs({
				hrefs: [
					...(SaveArticleReadlistsSchema.parse(req.body?.readlists) ?? []),
					...(isIosBuildBeforeRekeyedShareTargets(req) ? (SaveArticleReadlistsSchema.parse(req.body?.queues) ?? []) : []),
				],
				readlists: context.readlists,
			});
			const destinations = [
				...(addressedFiling ? [context.activeReadlist] : []),
				...ticked.filter(
					(readlist) =>
						readlist.slug !== DEFAULT_READLIST_SLUG && readlist.slug !== addressedFiling,
				),
			];
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			const saveAttemptId = newSaveAttemptId();
			if (freshness.action === "unresolved") {
				await queueUnresolvedSave({
					req,
					res,
					userId,
					url: validation.url,
					readlists: new Set([DEFAULT_READLIST_SLUG, ...destinations.map((destination) => destination.slug)]),
					saveTrigger: "manual",
					saveAttemptId,
					path: SAVE_INTENT_PATH.saveArticle,
				});
				return;
			}
			const result = await saveArticleAtReadlistTop({
				userId,
				url: validation.url,
				freshness,
				provenance: resolveSaveProvenance(req.oauthClientId),
				saveTrigger: "manual",
				saveAttemptId,
			});

			const filings: { createdUserArticle: boolean; wroteUserArticle: boolean; resurfacedFromRead: boolean }[] = [result];
			for (const destination of destinations) {
				filings.push(await deps.fileArticleIntoReadlist({
					userId,
					readlist: destination.slug,
					article: result.saved,
					provenance: resolveSaveProvenance(req.oauthClientId),
				}));
			}
			await recordSaveSignal(req, res, userId);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.saveArticle, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
			res.status(201).type(SIREN_MEDIA_TYPE).json(
				toSavedArticleEntity({
					article: result.saved,
					createdUserArticle: filings.some((filing) => filing.createdUserArticle),
					wroteUserArticle: filings.some((filing) => filing.wroteUserArticle),
					resurfacedFromRead: filings.some((filing) => filing.resurfacedFromRead),
					destination: {
						filedInto: destinations.length > 0 ? destinations : [context.activeReadlist],
						readlists: context.readlists,
					},
					readlistKey: readlistQueryKeyOf(req),
					now: deps.now(),
				}),
			);
		} catch (error) {
			deps.logError("Failed to save article", error instanceof Error ? error : undefined);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.saveArticle, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
			res.status(500).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "save-failed", message: "Could not save article" }),
			);
		}
	});

	/** Bulk "Save All Tabs": the extension captures every open tab and hands the
	 * server one multipart request — a JSON `manifest` part listing each page
	 * (`{ url, title?, mediaType? }`) plus a `content-<index>` file part carrying
	 * the captured bytes of every page whose entry declares a `mediaType`. Each
	 * page is classified and saved best-effort:
	 *   - unsaveable scheme (chrome://, file:, private host) → skipped;
	 *   - captured content → staged via the shared save-content handlers, then
	 *     stub-saved so the crawl enriches it (the sized parser limit already
	 *     bounds every content part, so there is no per-page refusal — `tooBig`
	 *     is always empty but stays in the response because deployed extensions'
	 *     response schema requires the field);
	 *   - no captured content (unscriptable or discarded tab) → saved URL-only.
	 * The window is chunked client-side to MAX_PAGES_PER_BULK_SAVE; a request over
	 * that count is rejected early, and saveArticlesLimitHandler turns a body over
	 * the sized parser limit into a Siren 422 rather than an unhandled 413. */
	const saveArticlesUpload = initMultipartUpload({ maxBytes: MAX_UPLOAD_REQUEST_BYTES });
	const saveArticlesLimitHandler = initSaveArticlesLimitHandler({
		logError: deps.logError,
		maxBytes: MAX_UPLOAD_REQUEST_BYTES,
	});
	router.post(SAVE_ROUTE.saveArticles, requireNotLocked, deps.requireWriteAccess, saveArticlesUpload.rawBodyParser, saveArticlesLimitHandler, async (req: Request, res: Response) => {
		if (!wantsSiren(req)) {
			tagSaveRefusal(res, SAVE_REFUSAL_CODES.notSiren);
			res.status(406).send("Not Acceptable");
			return;
		}

		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		const parsed = saveArticlesUpload.parseAllParts(req);
		if (!parsed.ok) {
			tagSaveRefusal(res, SAVE_REFUSAL_CODES.invalidManifest);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "invalid-save-articles", message: "save-articles requires a multipart/form-data body" }),
			);
			return;
		}

		const manifestPart = parsed.parts.find((p) => p.name === "manifest" && !p.isFile);
		const manifest = BulkSaveManifestSchema.safeParse(
			manifestPart ? safeJsonParse(manifestPart.content.toString("utf8")) : undefined,
		);
		if (!manifest.success) {
			tagSaveRefusal(res, SAVE_REFUSAL_CODES.invalidManifest);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "invalid-save-articles", message: "Invalid save-articles manifest" }),
			);
			return;
		}

		if (manifest.data.length > MAX_PAGES_PER_BULK_SAVE) {
			tagSaveRefusal(res, SAVE_REFUSAL_CODES.tooManyPages);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "save-articles-too-many-pages", message: `Too many tabs to save in one request (max ${MAX_PAGES_PER_BULK_SAVE})` }),
			);
			return;
		}

		type PageJob =
			| { kind: "content"; index: number; url: SaveableUrl; title?: string; mediaType: string; bytes: Buffer }
			| { kind: "url-only"; index: number; url: SaveableUrl; title?: string };
		type PageOutcome = { index: number; outcome: Exclude<BulkSaveOutcome, "skipped">; code?: "queued" };
		const jobs: PageJob[] = [];
		const skipped: { url: string; code: SaveableUrlErrorCode; message: string }[] = [];
		const entryOutcomes: { outcome: BulkSaveOutcome; code?: SaveableUrlErrorCode | "queued" }[] = [];

		manifest.data.forEach((entry, index) => {
			const validation = deps.validateNewSaveUrl(entry.url);
			if (validation.status !== "SUCCESS") {
				skipped.push({ url: entry.url, code: validation.error.code, message: validation.error.message });
				entryOutcomes[index] = { outcome: "skipped", code: validation.error.code };
				return;
			}
			const url = validation.url;
			const mediaType = entry.mediaType;
			/** Only an entry that declares a mediaType carries a content part; a
			 * declared-but-missing part (unscriptable/discarded tab) and an entry
			 * with no mediaType both fall through to a URL-only save. */
			const contentPart = mediaType
				? parsed.parts.find((p) => p.name === `content-${index}` && p.isFile)
				: undefined;
			if (mediaType && contentPart) {
				jobs.push({ kind: "content", index, url, title: entry.title, mediaType, bytes: contentPart.content });
			} else {
				jobs.push({ kind: "url-only", index, url, title: entry.title });
			}
		});

		const failOnePage = (job: PageJob, error: unknown): PageOutcome => {
			deps.logError(`Failed to bulk-save url=${job.url}`, error instanceof Error ? error : undefined);
			emitSaveIntent({ req, url: job.url, path: SAVE_INTENT_PATH.saveArticles, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
			return { index: job.index, outcome: "failed" };
		};

		type PreparedPage = { job: PageJob; freshness: ResolvedFreshnessResult; saveAttemptId: SaveAttemptId };

		const prepareOnePage = async (job: PageJob): Promise<PreparedPage | PageOutcome> => {
			try {
				const freshness = await deps.refreshArticleIfStaleStored({ url: job.url });
				const saveAttemptId = newSaveAttemptId();
				if (freshness.action === "unresolved") {
					await deps.publishSubmitLink({
						url: job.url,
						userId,
						provenance: resolveSaveProvenance(req.oauthClientId),
						readlist: DEFAULT_READLIST_SLUG,
						saveTrigger: "manual",
						saveAttemptId,
					});
					emitSaveIntent({ req, url: job.url, path: SAVE_INTENT_PATH.saveArticles, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
					return { index: job.index, outcome: "created", code: "queued" };
				}
				return { job, freshness, saveAttemptId };
			} catch (error) {
				return failOnePage(job, error);
			}
		};

		const writeOnePage = async (page: PreparedPage, savedAt: Date): Promise<PageOutcome> => {
			const { job, freshness } = page;
			try {
				let staged: SaveContentResult | undefined;
				if (job.kind === "content") {
					/** Stage the captured bytes when the media type is supported; an
					 * unsupported type stages nothing and the page is saved URL-only,
					 * so the crawl enriches it the ordinary way. */
					const media = mediaFor({ mediaType: job.mediaType, url: freshness.identity.url });
					if (media) staged = await media.stageInlineBytes({ url: freshness.identity.url, bytes: job.bytes, title: job.title, userId, saveAttemptId: page.saveAttemptId, sourceUrl: job.url, sourceOriginalUrl: freshness.identity.originalUrl, captureTrigger: "manual" });
				}
				const { createdUserArticle } = await saveArticleFromUrlWithoutActivity({
					userId,
					url: job.url,
					freshness,
					provenance: resolveSaveProvenance(req.oauthClientId),
					saveTrigger: "manual",
					savedAt,
					saveAttemptId: page.saveAttemptId,
				});
				if (staged?.ok) await staged.dispatch();
				emitSaveIntent({ req, url: job.url, path: SAVE_INTENT_PATH.saveArticles, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
				return { index: job.index, outcome: createdUserArticle ? "created" : "merged" };
			} catch (error) {
				return failOnePage(job, error);
			}
		};

		const findAlreadySaved = async (ready: PreparedPage[]): Promise<Set<string>> => {
			const canonicalUrls = ready.map((page) => page.freshness.identity.url);
			try {
				return new Set(await deps.findSavedUrls({ userId, urls: canonicalUrls }));
			} catch (error) {
				deps.logError("Failed to rank a bulk save; keeping manifest order", error instanceof Error ? error : undefined);
				return new Set(canonicalUrls);
			}
		};

		const writeAllPages = async (ready: PreparedPage[]): Promise<PageOutcome[]> => {
			if (ready.length === 0) return [];
			const alreadySavedPending = findAlreadySaved(ready);
			let savedAts: Date[];
			try {
				savedAts = await deps.allocateSavedAtSequence({ userId, count: ready.length });
			} catch (error) {
				await alreadySavedPending;
				return ready.map((page) => failOnePage(page.job, error));
			}
			const alreadySaved = await alreadySavedPending;
			const ranked = rankNewLinksAbove({
				items: ready,
				instants: savedAts,
				isNew: (page) => !alreadySaved.has(page.freshness.identity.url),
			});
			return Promise.all(ready.map((page, index) => writeOnePage(page, ranked[index])));
		};

		const prepared = await Promise.all(jobs.map(prepareOnePage));
		const ready = prepared.flatMap((page) => ("outcome" in page ? [] : [page]));
		const prepareFailures = prepared.flatMap((page) => ("outcome" in page ? [page] : []));
		const pageOutcomes = [...prepareFailures, ...(await writeAllPages(ready))];
		const saved = pageOutcomes.filter((o) => o.outcome !== "failed").length;
		const failed = pageOutcomes.filter((o) => o.outcome === "failed").length;
		if (saved > 0) {
			await deps.recordEngagementActivity({ userId, kind: "personal-save", at: deps.now() });
		}

		for (const page of pageOutcomes) {
			entryOutcomes[page.index] = { outcome: page.outcome, code: page.code };
		}
		const results = manifest.data.map((entry, index) => {
			const entryOutcome = entryOutcomes[index];
			assert(entryOutcome, `bulk-save outcome missing for manifest entry ${index}`);
			return { url: entry.url, ...entryOutcome };
		});

		if (saved > 0) markExtensionSavedArticle(res, { secureCookies: deps.secureCookies });
		res.status(200).type(SIREN_MEDIA_TYPE).json(
			toBulkSaveResultEntity({
				saved,
				skipped: skipped.length,
				failed,
				tooBig: [],
				skippedUrls: skipped,
				results,
			}),
		);
	});

	/** Unified content entry point. The extension sends captured bytes (HTML or
	 * PDF) together with a `mediaType` hint; the server validates and dispatches
	 * to the existing HTML or PDF pipeline. */
	const contentUpload = initMultipartUpload({ maxBytes: MAX_UPLOAD_REQUEST_BYTES });
	const saveContentLimitHandler = initSaveContentLimitHandler({
		logError: deps.logError,
		maxBytes: MAX_UPLOAD_REQUEST_BYTES,
	});

	router.post(
		SAVE_ROUTE.saveContent,
		requireNotLocked,
		deps.requireWriteAccess,
		contentUpload.rawBodyParser,
		saveContentLimitHandler,
		async (req: Request, res: Response) => {
			if (!wantsSiren(req)) {
				res.status(406).send("Not Acceptable");
				return;
			}

			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;

			const buildFallbackAction = () => ({
				name: "save-article",
				title: "Save a link",
				href: READLIST_PATH,
				method: "POST",
				type: "application/json",
				fields: [{ name: "url", type: "url" }],
			});
			const parsed = contentUpload.parseAllParts(req);
			if (!parsed.ok) {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({
						code: "invalid-save-content",
						message: "save-content requires a multipart/form-data body",
						actions: [buildFallbackAction()],
					}),
				);
				return;
			}

			const textPart = (name: string): string | undefined => {
				const part = parsed.parts.find((p) => p.name === name && !p.isFile);
				return part ? part.content.toString("utf8") : undefined;
			};
			const contentBytes = parsed.parts.find((p) => p.name === "content" && p.isFile)?.content;
			const submittedUrl = textPart("url") ?? "";
			const mediaType = textPart("mediaType") ?? "";
			const title = textPart("title");
			const uploaded = textPart("uploaded");
			const completionAttempt = z.uuid().pipe(SaveAttemptIdSchema).safeParse(textPart("saveAttemptId"));
			const saveAttemptId = uploaded === "true" && completionAttempt.success ? completionAttempt.data : newSaveAttemptId();
			const sizeRaw = textPart("size");
			const size = sizeRaw !== undefined ? Number(sizeRaw) : Number.NaN;
			const captureTrigger = parseCaptureTrigger(textPart("captureTrigger"));

			const refuse = (message: string, code = "invalid-save-content") => {
				emitSaveIntent({ req, url: submittedUrl, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code, message, actions: [buildFallbackAction()] }),
				);
			};

			if (!captureTrigger.success) {
				refuse("captureTrigger must be automatic or manual");
				return;
			}

			const resolveTarget = (validate: ValidateSaveableUrl): { articleUrl: SaveableUrl; normalized: string; media: SaveContentMedia } | undefined => {
				if (!mediaType) {
					refuse("save-content requires a mediaType field");
					return undefined;
				}
				const validation = validate(submittedUrl);
				if (validation.status === "ERROR") {
					refuse(validation.error.message);
					return undefined;
				}
				if (isNonArticleHost(validation.url)) {
					refuse(
						"This link isn't an article, so the page capture wasn't kept",
						"capture-not-allowed",
					);
					return undefined;
				}
				const normalized = normalizeMediaType(mediaType);
				const media = saveContentMedia[normalized];
				if (!media) {
					refuse(`Unsupported media type: ${mediaType}`, "unsupported-media-type");
					return undefined;
				}
				return { articleUrl: validation.url, normalized, media };
			};


			const finishSave = async (articleUrl: SaveableUrl, freshness: ResolvedFreshnessResult, dispatch?: () => Promise<void>): Promise<void> => {
				const result = await attachArticleContent({
					userId,
					url: articleUrl,
					freshness,
					provenance: resolveSaveProvenance(req.oauthClientId),
					saveTrigger: captureTrigger.data,
					savedAt: await deps.allocateSavedAt({ userId }),
					saveAttemptId,
				});
				if (dispatch !== undefined) await dispatch();
				const context = await resolveReadlistContext(req, userId);
				await recordSaveSignal(req, res, userId);
				emitSaveIntent({ req, url: articleUrl, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
				res.status(201).type(SIREN_MEDIA_TYPE).json(
					toSavedArticleEntity({
						article: result.saved,
						createdUserArticle: result.createdUserArticle,
						wroteUserArticle: result.wroteUserArticle,
						resurfacedFromRead: result.resurfacedFromRead,
						destination: { filedInto: [DEFAULT_READLIST], readlists: context.readlists },
						readlistKey: readlistQueryKeyOf(req),
						now: deps.now(),
					}),
				);
			};

			try {
				if (contentBytes && contentBytes.length > 0) {
					if (!mediaType) {
						refuse("save-content requires a mediaType field");
						return;
					}
					const validation = deps.validateNewSaveUrl(submittedUrl);
					if (validation.status === "ERROR") {
						refuse(validation.error.message);
						return;
					}
					const freshness = await deps.refreshArticleIfStale({ url: validation.url });
					if (freshness.action === "unresolved") {
						await queueUnresolvedSave({
							req,
							res,
							userId,
							url: validation.url,
							readlists: [DEFAULT_READLIST_SLUG],
							saveTrigger: captureTrigger.data,
							saveAttemptId,
							path: SAVE_INTENT_PATH.saveContent,
						});
						return;
					}
					const { identity } = freshness;
					const stageUrl = identity.url;
					const media = mediaFor({ mediaType, url: stageUrl });
					const staged = await media?.stageInlineBytes({ url: stageUrl, bytes: contentBytes, title, userId, saveAttemptId, sourceUrl: validation.url, sourceOriginalUrl: identity.originalUrl, captureTrigger: captureTrigger.data });
					await finishSave(validation.url, freshness, staged?.ok ? staged.dispatch : undefined);
					return;
				}

				if (uploaded === "true") {
					if (!completionAttempt.success) {
						refuse("The upload attempt is missing or invalid; please re-upload", "upload-not-found");
						return;
					}
					const target = resolveTarget(deps.validateSaveableUrl);
					if (!target) return;
					const freshness = await deps.refreshArticleIfStale({ url: target.articleUrl });
					if (freshness.action === "unresolved") {
						refuse(ORIGINAL_UNRESOLVED_MESSAGE, "original-unresolved");
						return;
					}
					const { identity } = freshness;
					const stat = await deps.statPendingUpload({ url: identity.url, mediaType: target.normalized, saveAttemptId });
					if (!stat) {
						refuse("No uploaded content found for this URL", "upload-not-found");
						return;
					}
					if (stat.byteLength > target.media.uploadCeilingBytes) {
						refuse(`Content upload exceeded ${megabytesLabel(target.media.uploadCeilingBytes)}`, "content-too-large");
						return;
					}
					const ageSeconds = (deps.now().getTime() - stat.lastModified.getTime()) / 1000;
					if (ageSeconds > UPLOAD_COMPLETION_MAX_AGE_SECONDS) {
						refuse("The uploaded content has expired; please re-upload", "upload-not-found");
						return;
					}
					const admitted = await target.media.admitUploadedBytes({
						url: identity.url,
						saveAttemptId,
						sourceUrl: target.articleUrl,
						sourceOriginalUrl: identity.originalUrl,
						mediaType: target.normalized,
						title,
						userId,
						captureTrigger: captureTrigger.data,
					});
					if (!admitted.ok) {
						refuse(admitted.message, admitted.code);
						return;
					}
					await finishSave(target.articleUrl, freshness, admitted.dispatch);
					return;
				}

				if (Number.isInteger(size) && size > 0) {
					const target = resolveTarget(deps.validateNewSaveUrl);
					if (!target) return;
					if (size > target.media.uploadCeilingBytes) {
						refuse(`Content upload exceeded ${megabytesLabel(target.media.uploadCeilingBytes)}`, "content-too-large");
						return;
					}
					const identity = await deps.resolveSaveIdentity(target.articleUrl);
					if (identity.status === "unresolved") {
						refuse(ORIGINAL_UNRESOLVED_MESSAGE, "original-unresolved");
						return;
					}
					const slot = await deps.createUploadSlot({ url: identity.url, mediaType: target.normalized, byteLength: size, saveAttemptId });
					res.status(200).type(SIREN_MEDIA_TYPE).json(
						toUploadSlotEntity({
							saveAttemptId,
							uploadUrl: slot.uploadUrl,
							expiresAt: slot.expiresAt,
							url: target.articleUrl,
							mediaType: target.normalized,
							title,
							completionHref: `${READLIST_PATH}${SAVE_ROUTE.saveContent}`,
						}),
					);
					return;
				}

				refuse("save-content requires a content field, a size to request an upload slot, or uploaded=true to complete an upload");
			} catch (error) {
				deps.logError("Failed to save article from content", error instanceof Error ? error : undefined);
				const intent = deps.validateNewSaveUrl(submittedUrl);
				if (intent.status === "SUCCESS") {
					emitSaveIntent({ req, url: intent.url, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
				}
				res.status(500).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code: "save-failed", message: "Could not save article" }),
				);
			}
		},
	);

	router.post(SAVE_ROUTE.save, requireNotLocked, deps.requireWriteAccess, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		markSaveTipSeen(res, { secureCookies: deps.secureCookies });
		const submittedUrl = typeof req.body?.url === "string" ? req.body.url : "";
		const validation = deps.validateNewSaveUrl(submittedUrl);
		const saveState = parseReadlistUrl({});
		const fromDialog = req.get("HX-Request") === "true";
		const land = (path: string, scroll: HxLocationScroll): void => {
			if (!fromDialog) {
				res.redirect(303, scroll === "latest-saved" ? `${path}#latest-saved` : path);
				return;
			}
			res.set("HX-Location", hxLocationToMain({ path, source: `#${ADD_LINK_POPOVER_ID}`, scroll }));
			res.status(204).end();
		};
		const refuse = (error: AddLinkFormError, errorCode: string): void => {
			if (!fromDialog) {
				res.redirect(303, buildReadlistUrl(saveState, [["error_code", errorCode]]));
				return;
			}
			res.status(422).type("html").send(
				renderAddLinkForm({
					action: req.originalUrl,
					value: submittedUrl,
					error,
					saveTipState: "seen",
					accessIsReadOnly: false,
					autoSubmit: false,
					autofocus: true,
				}),
			);
		};

		if (validation.status === "ERROR") {
			emitSaveIntent({ req, url: submittedUrl, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.readlistSaveBar, outcome: SAVE_OUTCOMES.error });
			refuse(
				{ message: saveFormRejectionMessage(validation.error.code), code: validation.error.code },
				validation.error.code,
			);
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			const saveAttemptId = newSaveAttemptId();
			if (freshness.action === "unresolved") {
				await deps.publishSubmitLink({ url: validation.url, userId, provenance: resolveSaveProvenance(req.oauthClientId), readlist: DEFAULT_READLIST_SLUG, saveTrigger: "manual", saveAttemptId });
				await rememberReadlistFilter(req, NO_READLIST_FILTER);
				emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.readlistSaveBar, outcome: SAVE_OUTCOMES.saved });
				res.set(SAVE_ATTEMPT_ID_HEADER, saveAttemptId);
				land(buildReadlistUrl(saveState, [["queue_error", READLIST_NOTICE_SAVE_QUEUED]]), "top");
				return;
			}
			await saveArticleAtReadlistTop({
				userId,
				url: validation.url,
				freshness,
				provenance: resolveSaveProvenance(req.oauthClientId),
				saveTrigger: "manual",
				saveAttemptId,
			});
			await rememberReadlistFilter(req, NO_READLIST_FILTER);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.readlistSaveBar, outcome: SAVE_OUTCOMES.saved });
			res.set(SAVE_ATTEMPT_ID_HEADER, saveAttemptId);
			land(buildReadlistUrl(saveState), "latest-saved");
		} catch (error) {
			deps.logError("Failed to save article", error instanceof Error ? error : undefined);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.readlistSaveBar, outcome: SAVE_OUTCOMES.error });
			refuse({ message: SAVE_FAILED_MESSAGE }, "save_failed");
		}
	});

	return router;
}
