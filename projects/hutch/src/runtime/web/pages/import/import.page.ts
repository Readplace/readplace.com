import assert from "node:assert";
import type { ErrorRequestHandler, Request, Response, Router } from "express";
import express from "express";
import { extractUrls } from "@packages/domain/import-session";
import {
	IMPORT_COMMIT_CONCURRENCY,
	IMPORT_PAGE_SIZE,
	ImportSessionIdSchema,
	ImportToggleAllSchema,
	ImportToggleSchema,
	MAX_IMPORT_FILE_BYTES,
} from "@packages/domain/import-session";
import type { ImportSessionStore } from "@packages/domain/import-session";
import type { ValidateSaveableUrl, SaveableUrl, SaveableUrlErrorCode } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import { Base } from "../../base.component";
import { bannerStateFromRequest } from "../../banner-state";
import { sendComponent } from "../../send-component";
import { saveArticleFromUrl, type SaveArticleFromUrlDependencies } from "../../shared/save-article/save-article-from-url";
import type { AnalyticsEvent } from "../../middleware/analytics";
import { hashIp } from "../../middleware/analytics";
import {
	IMPORT_SKIPPED_COOKIE_NAME,
	encodeImportSkippedCookie,
} from "./import-skipped-cookie";
import { ImportPage, ImportUploadPage } from "./import.component";
import { importErrorMessageMapping } from "./import.error";
import { toImportUploadViewModel, toImportViewModel } from "./import.viewmodel";
import { initMultipartUpload } from "./multipart-upload";
import { parseImportPage } from "./import.url";

interface ImportRouteDependencies extends SaveArticleFromUrlDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	importSessionStore: ImportSessionStore;
	logError: (message: string, error?: Error) => void;
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
}

const UPLOAD_ERROR_REDIRECT = {
	tooLarge: "/import?error_code=import_too_large",
	noUrls: "/import?error_code=import_no_urls",
	sessionNotFound: "/import?error_code=import_session_not_found",
} as const;

export function initImportSessionRoutes(deps: ImportRouteDependencies): Router {
	const router = express.Router();
	const { rawBodyParser, parseRequest } = initMultipartUpload({ maxBytes: MAX_IMPORT_FILE_BYTES });

	const sizeLimitHandler: ErrorRequestHandler = (err, _req, res, next) => {
		if (err && typeof err === "object" && "type" in err && err.type === "entity.too.large") {
			res.redirect(303, UPLOAD_ERROR_REDIRECT.tooLarge);
			return;
		}
		next(err);
	};

	router.get("/", (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const errorMessage = importErrorMessageMapping(req.query);
		const vm = toImportUploadViewModel({
			errors: errorMessage ? [{ message: errorMessage }] : undefined,
		});
		sendComponent(req, res, Base(ImportUploadPage(vm), bannerStateFromRequest(req)));
	});

	router.post("/", rawBodyParser, sizeLimitHandler, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const parsed = parseRequest(req);
		if (!parsed.ok) {
			res.redirect(303, UPLOAD_ERROR_REDIRECT.noUrls);
			return;
		}

		const { urls, truncated, totalFoundInFile } = extractUrls(parsed.file.content);
		if (urls.length === 0) {
			res.redirect(303, UPLOAD_ERROR_REDIRECT.noUrls);
			return;
		}

		const session = await deps.importSessionStore.createImportSession({
			userId: req.userId,
			urls,
			truncated,
			totalFoundInFile,
		});
		deps.analytics.info({
			stream: "analytics",
			event: "import_uploaded",
			timestamp: deps.now().toISOString(),
			path: "/import",
			utm_source: "import-feature",
			utm_medium: "form",
			utm_campaign: "file-upload",
			url_count: urls.length,
			truncated: truncated ? 1 : 0,
			visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
			is_authenticated: 1,
		});
		res.redirect(303, `/import/${session.id}`);
	});

	router.get("/:id", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const parsedId = ImportSessionIdSchema.safeParse(req.params.id);
		if (!parsedId.success) {
			res.redirect(303, "/queue");
			return;
		}

		const page = parseImportPage(req.query);
		const pageResult = await deps.importSessionStore.loadImportSessionPage({
			id: parsedId.data,
			userId: req.userId,
			page,
			pageSize: IMPORT_PAGE_SIZE,
		});

		if (!pageResult) {
			res.redirect(303, UPLOAD_ERROR_REDIRECT.sessionNotFound);
			return;
		}

		const totalSelected =
			pageResult.session.totalUrls - pageResult.session.deselected.size;
		const vm = toImportViewModel(pageResult, totalSelected);
		sendComponent(req, res, Base(ImportPage(vm), bannerStateFromRequest(req)));
	});

	router.post("/:id/toggle", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const parsedId = ImportSessionIdSchema.safeParse(req.params.id);
		const parsedBody = ImportToggleSchema.safeParse(req.body);
		if (!parsedId.success || !parsedBody.success) {
			res.status(422).send("");
			return;
		}

		await deps.importSessionStore.toggleImportSelection({
			id: parsedId.data,
			userId: req.userId,
			index: parsedBody.data.index,
			checked: parsedBody.data.checked === "true",
		});

		const page = parseImportPage(req.query);
		res.redirect(303, page > 1 ? `/import/${parsedId.data}?page=${page}` : `/import/${parsedId.data}`);
	});

	router.post("/:id/toggle-all", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const parsedId = ImportSessionIdSchema.safeParse(req.params.id);
		const parsedBody = ImportToggleAllSchema.safeParse(req.body);
		if (!parsedId.success || !parsedBody.success) {
			res.status(422).send("");
			return;
		}

		await deps.importSessionStore.toggleAllImportSelection({
			id: parsedId.data,
			userId: req.userId,
			checked: parsedBody.data.checked === "true",
		});

		const page = parseImportPage(req.query);
		res.redirect(303, page > 1 ? `/import/${parsedId.data}?page=${page}` : `/import/${parsedId.data}`);
	});

	router.post("/:id/commit", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ImportSessionIdSchema.safeParse(req.params.id);
		if (!parsedId.success) {
			res.redirect(303, UPLOAD_ERROR_REDIRECT.sessionNotFound);
			return;
		}

		const session = await deps.importSessionStore.findImportSession({
			id: parsedId.data,
			userId,
		});
		if (!session) {
			res.redirect(303, UPLOAD_ERROR_REDIRECT.sessionNotFound);
			return;
		}

		const allUrls = await deps.importSessionStore.loadAllImportSessionUrls({
			id: parsedId.data,
			userId,
		});
		assert(allUrls, "session row was found but URL chunks missing");

		const selected = allUrls.filter((_url, i) => !session.deselected.has(i));
		const saveable: SaveableUrl[] = [];
		const skipped: Array<{ url: string; code: SaveableUrlErrorCode }> = [];
		for (const url of selected) {
			const validation = deps.validateSaveableUrl(url);
			if (validation.status === "SUCCESS") {
				saveable.push(validation.url);
			} else {
				skipped.push({ url, code: validation.error.code });
			}
		}

		for (let i = 0; i < saveable.length; i += IMPORT_COMMIT_CONCURRENCY) {
			const batch = saveable.slice(i, i + IMPORT_COMMIT_CONCURRENCY);
			await Promise.all(
				batch.map((url) =>
					deps
						.refreshArticleIfStale({ url })
						.then((freshness) => saveArticleFromUrl(deps, { userId, url, freshness }))
						.catch((error: unknown) => {
							deps.logError(
								`Failed to import url=${url}`,
								error instanceof Error ? error : undefined,
							);
						}),
				),
			);
		}

		await deps.importSessionStore.deleteImportSession({ id: parsedId.data, userId });

		if (skipped.length > 0) {
			/** Cookie carries the skipped URL list so the queue page can render
			 * a "couldn't import these N links" banner. Cleared on the next
			 * queue render. Capped at MAX_COOKIE_ITEMS to stay under the 4 KiB
			 * cookie limit on large skip volumes. */
			res.cookie(IMPORT_SKIPPED_COOKIE_NAME, encodeImportSkippedCookie(skipped), {
				path: "/queue",
				maxAge: 5 * 60 * 1000,
				sameSite: "lax",
				httpOnly: true,
			});
		}

		deps.analytics.info({
			stream: "analytics",
			event: "import_committed",
			timestamp: deps.now().toISOString(),
			path: "/import/commit",
			utm_source: "import-feature",
			utm_medium: "form",
			utm_campaign: "submit",
			imported_count: saveable.length,
			skipped_count: skipped.length,
			total_in_session: session.totalUrls,
			visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
			is_authenticated: 1,
		});
		res.redirect(
			303,
			`/queue?import_imported=${saveable.length}&import_total=${session.totalUrls}&import_skipped=${skipped.length}`,
		);
	});

	return router;
}
