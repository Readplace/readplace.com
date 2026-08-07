import type { NextFunction, Request, Response, Router } from "express";
import { requireCspNonce } from "@packages/web-shell";
import express from "express";
import { z } from "zod";
import type {
	FindArticleCrawlStatus,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";
import type { FindArticleByUrl, FindArticleCrawlVersions, FindArticleFreshness } from "@packages/provider-contracts/article-store";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type {
	FindGeneratedSummary,
} from "@packages/provider-contracts/article-summary";
import type { PublishRecrawlLinkInitiated } from "@packages/provider-contracts/events";
import type { FindUserByEmail } from "@packages/provider-contracts/auth";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { extensionInstallUrlIfMissing } from "../../onboarding/extension-install";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import type { PollUrlBuilder } from "../../shared/article-reader/article-reader.types";
import { SaveErrorPage } from "../save/save-error.component";
import { AdminRecrawlLandingPage } from "./recrawl-landing.component";
import { AdminRecrawlPage, formatRecrawlDocumentTitle, recrawlPathFor } from "./recrawl.component";
import { initRequireAdmin } from "./require-admin.middleware";

const RecrawlUrlSchema = z.url();

export interface AdminRecrawlDependencies {
	appOrigin: string;
	findArticleByUrl: FindArticleByUrl;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	readArticleContent: ReadArticleContent;
	findGeneratedSummary: FindGeneratedSummary;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	forceMarkCrawlPending: ForceMarkCrawlPending;
	publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated;
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	serviceToken: string;
	now: () => Date;
	buildBannerState: BuildBannerState;
}

function pollUrlBuilderFor(articleUrl: string): PollUrlBuilder {
	return {
		summary: (n) =>
			`/admin/recrawl/summary?url=${encodeURIComponent(articleUrl)}&poll=${n}`,
		reader: (n) =>
			`/admin/recrawl/reader?url=${encodeURIComponent(articleUrl)}&poll=${n}`,
	};
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
	res.setHeader("Cache-Control", "no-store");
	next();
}

async function renderNotFound(
	deps: AdminRecrawlDependencies,
	req: Request,
	res: Response,
): Promise<void> {
	const html = Base(SaveErrorPage({
		redirectUrl: "/admin/recrawl",
		linkLabel: "Back to recrawl",
	}), await deps.buildBannerState(req)).to("text/html");
	res.status(404).type("html").send(html.body);
}

/** GET `/admin/recrawl`: the bare form, or — when `?url=` names an article — the
 * recrawl page itself. It renders in place rather than redirecting into the path
 * form, which would collapse an embedded scheme back out of the address. */
function handleLanding(
	deps: AdminRecrawlDependencies,
	reader: ReturnType<typeof initArticleReader>,
) {
	return async (req: Request, res: Response): Promise<void> => {
		if (req.query.url === undefined) {
			const html = Base(AdminRecrawlLandingPage(), await deps.buildBannerState(req)).to("text/html");
			res.status(html.statusCode).type("html").send(html.body);
			return;
		}
		await renderRecrawlPage(deps, reader, req, res);
	};
}

/** `?url=` wins when present — see {@link recrawlPathFor} for why the path
 * carrier cannot name every row. A query value must be a full URL (the landing
 * form's `type="url"` input already enforces that); only the path form gets the
 * schemeless default. */
function requestedUrlFrom(req: Request<{ splat?: string[] }>): string | undefined {
	const fromQuery = req.query.url;
	if (typeof fromQuery === "string") return fromQuery;
	const splat = req.params.splat;
	if (splat === undefined) return undefined;
	const rawPath = splat.join("/");
	// API Gateway v2 HTTP API decodes %2F to /, restore https:/ → https://
	// (same normalisation as /view). Only the leading scheme is recoverable —
	// an embedded `https:/` is indistinguishable from a genuine single slash.
	const restoredScheme = rawPath.replace(/^(https?):\/(?!\/)/i, "$1://");
	// Admin pastes the bare article URL (`fagnerbrack.com/post`) without a
	// scheme. Default to https:// so the path resolves to the same DB row
	// as the canonical save.
	return /^https?:\/\//i.test(restoredScheme)
		? restoredScheme
		: `https://${restoredScheme}`;
}

async function resolveArticleUrl(
	deps: AdminRecrawlDependencies,
	req: Request<{ splat?: string[] }>,
	res: Response,
): Promise<string | undefined> {
	const parsed = RecrawlUrlSchema.safeParse(requestedUrlFrom(req));
	if (!parsed.success) {
		await renderNotFound(deps, req, res);
		return undefined;
	}
	/* API Gateway HTTP API decodes the path segment once before Express
	 * sees it, so `parsed.data` arrives with literal spaces and brackets
	 * where the rest of the system (save-anonymous-link, stale-check
	 * refresh, /view) carries the URL-encoded form (%20, %5B). DynamoDB
	 * keys articles by URL string — running through `new URL().toString()`
	 * canonicalises to the encoded form so the recrawl writes land on the
	 * same row the view reads. Without this, an admin recrawl of a URL
	 * with spaces creates a parallel "decoded-URL" row that nothing else
	 * in the system ever reads or updates. */
	return new URL(parsed.data).toString();
}

function handleShowRecrawlPage(
	deps: AdminRecrawlDependencies,
	reader: ReturnType<typeof initArticleReader>,
) {
	return async (
		req: Request<{ splat?: string[] }>,
		res: Response,
	): Promise<void> => {
		await renderRecrawlPage(deps, reader, req, res);
	};
}

async function renderRecrawlPage(
	deps: AdminRecrawlDependencies,
	reader: ReturnType<typeof initArticleReader>,
	req: Request<{ splat?: string[] }>,
	res: Response,
): Promise<void> {
	const articleUrl = await resolveArticleUrl(deps, req, res);
	if (articleUrl === undefined) {
		return;
	}

	const existing = await deps.findArticleByUrl(articleUrl);
	if (!existing) {
		// The endpoint is explicitly for human intervention on an existing
		// saved URL. Do not create a stub; surface 404.
		await renderNotFound(deps, req, res);
		return;
	}

	const state = await reader.resolveReaderState({
		article: {
			url: articleUrl,
			metadata: existing.metadata,
			estimatedReadTime: existing.estimatedReadTime,
		},
		pollUrlBuilder: pollUrlBuilderFor(articleUrl),
		capturing: false,
	});

	// `?started=1` is set by the POST-Redirect-GET landing after the recrawl
	// has already been triggered, so the result view must not re-emit the
	// auto-submitting form (which would fire the mutation again on load).
	const recrawlFormAction =
		req.query.started === "1" ? undefined : recrawlPathFor(articleUrl);

	const html = Base(AdminRecrawlPage({
		articleUrl,
		appOrigin: deps.appOrigin,
		metadata: existing.metadata,
		estimatedReadTime: existing.estimatedReadTime,
		content: state.content,
		crawl: state.crawl,
		readerPollUrl: state.readerPollUrl,
		summary: state.summary,
		summaryPollUrl: state.summaryPollUrl,
		progress: state.progress,
		contentSourceTier: existing.contentSourceTier,
		extensionInstallUrl: extensionInstallUrlIfMissing(req),
		recrawlFormAction,
		crawlVersions: state.crawlVersions,
		cspNonce: requireCspNonce(req),
	}), await deps.buildBannerState(req)).to("text/html");
	res.status(html.statusCode).type("html").send(html.body);
}

function handleTriggerRecrawl(deps: AdminRecrawlDependencies) {
	return async (
		req: Request<{ splat?: string[] }>,
		res: Response,
	): Promise<void> => {
		const articleUrl = await resolveArticleUrl(deps, req, res);
		if (articleUrl === undefined) {
			return;
		}

		const existing = await deps.findArticleByUrl(articleUrl);
		if (!existing) {
			// The endpoint is explicitly for human intervention on an existing
			// saved URL. Do not create a stub; surface 404.
			await renderNotFound(deps, req, res);
			return;
		}

		// Always recrawl. No cache, no TTL. Force crawl back to pending (even if
		// already `ready`) so the reader slot shows the "recrawl in progress"
		// skeleton. Summary state is owned by the recrawl pipeline: a promotion
		// publishes CanonicalContentChanged, whose subscriber re-primes and
		// regenerates the summary, so wiping it here would be redundant.
		await deps.forceMarkCrawlPending({ url: articleUrl });
		await deps.publishRecrawlLinkInitiated({ url: articleUrl });

		res.redirect(303, `${recrawlPathFor(articleUrl)}&started=1`);
	};
}

function handleSummaryPoll(reader: ReturnType<typeof initArticleReader>) {
	return async (req: Request, res: Response): Promise<void> => {
		const parsed = RecrawlUrlSchema.safeParse(req.query.url);
		if (!parsed.success) {
			res.status(400).type("html").send("");
			return;
		}
		const articleUrl = new URL(parsed.data).toString();
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleSummaryPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			capturing: false,
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: undefined,
		});
		const html = component.to("text/html");
		res.status(html.statusCode).type("html").send(html.body);
	};
}

function handleReaderPoll(reader: ReturnType<typeof initArticleReader>) {
	return async (req: Request, res: Response): Promise<void> => {
		const parsed = RecrawlUrlSchema.safeParse(req.query.url);
		if (!parsed.success) {
			res.status(400).type("html").send("");
			return;
		}
		const articleUrl = new URL(parsed.data).toString();
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleReaderPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			capturing: false,
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: undefined,
		});
		const html = component.to("text/html");
		res.status(html.statusCode).type("html").send(html.body);
	};
}

export function initAdminRecrawlRoutes(deps: AdminRecrawlDependencies): Router {
	const router = express.Router();
	const requireAdmin = initRequireAdmin({
		findUserByEmail: deps.findUserByEmail,
		adminEmails: deps.adminEmails,
		serviceToken: deps.serviceToken,
	});

	const reader = initArticleReader({
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		findGeneratedSummary: deps.findGeneratedSummary,
		readArticleContent: deps.readArticleContent,
		findArticleByUrl: deps.findArticleByUrl,
		findArticleFreshness: deps.findArticleFreshness,
		findArticleCrawlVersions: deps.findArticleCrawlVersions,
		appOrigin: deps.appOrigin,
		formatDocumentTitle: formatRecrawlDocumentTitle,
		summaryOpen: false,
		now: deps.now,
	});

	router.use(noStore);
	router.use(requireAdmin);

	router.get("/", handleLanding(deps, reader));
	router.get("/summary", handleSummaryPoll(reader));
	router.get("/reader", handleReaderPoll(reader));
	// The `?url=` trigger is registered first so the lossless carrier is matched
	// before the path wildcard ever sees the request.
	router.post("/", handleTriggerRecrawl(deps));
	router.post<string, { splat?: string[] }>(
		"/*splat",
		handleTriggerRecrawl(deps),
	);
	router.get<string, { splat?: string[] }>(
		"/*splat",
		handleShowRecrawlPage(deps, reader),
	);

	return router;
}
