import assert from "node:assert";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type {
	FindArticleCrawlStatus,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "@packages/test-fixtures/providers/article-crawl";
import type { FindArticleByUrl } from "@packages/test-fixtures/providers/article-store";
import type { ReadArticleContent } from "@packages/test-fixtures/providers/article-store";
import type {
	FindGeneratedSummary,
} from "@packages/test-fixtures/providers/article-summary";
import type { PublishRecrawlLinkInitiated } from "@packages/test-fixtures/providers/events";
import type { FindUserByEmail } from "@packages/test-fixtures/providers/auth";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { extensionInstallUrlIfMissing } from "../../onboarding/extension-install";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import type { PollUrlBuilder } from "../../shared/article-reader/article-reader.types";
import { SaveErrorPage } from "../save/save-error.component";
import { AdminRecrawlLandingPage } from "./recrawl-landing.component";
import { AdminRecrawlPage, formatRecrawlDocumentTitle } from "./recrawl.component";
import { initRequireAdmin } from "./require-admin.middleware";

const RecrawlUrlSchema = z.url();

export interface AdminRecrawlDependencies {
	findArticleByUrl: FindArticleByUrl;
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

function handleLanding(deps: AdminRecrawlDependencies) {
	return async (req: Request, res: Response): Promise<void> => {
		const submittedUrl =
			typeof req.query.url === "string" ? req.query.url : undefined;
		if (submittedUrl === undefined) {
			const html = Base(AdminRecrawlLandingPage(), await deps.buildBannerState(req)).to("text/html");
			res.status(html.statusCode).type("html").send(html.body);
			return;
		}
		const parsed = RecrawlUrlSchema.safeParse(submittedUrl);
		if (!parsed.success) {
			await renderNotFound(deps, req, res);
			return;
		}
		res.redirect(302, `/admin/recrawl/${encodeURIComponent(parsed.data)}`);
	};
}

function handleRecrawlArticle(
	deps: AdminRecrawlDependencies,
	reader: ReturnType<typeof initArticleReader>,
) {
	return async (
		req: Request<Record<string, string>>,
		res: Response,
	): Promise<void> => {
		const rawPath = req.params[0];
		// API Gateway v2 HTTP API decodes %2F to /, restore https:/ → https://
		// (same normalisation as /view).
		const normalizedUrl = rawPath.replace(/^(https?):\/(?!\/)/i, "$1://");
		const parsed = RecrawlUrlSchema.safeParse(normalizedUrl);
		if (!parsed.success) {
			await renderNotFound(deps, req, res);
			return;
		}
		const articleUrl = parsed.data;

		const existing = await deps.findArticleByUrl(articleUrl);
		if (!existing) {
			// The endpoint is explicitly for human intervention on an existing
			// saved URL. Do not create a stub; surface 404.
			await renderNotFound(deps, req, res);
			return;
		}

		// Always recrawl. No cache, no TTL. Force crawl back to pending (even if
		// currently `ready`) so the reader slot shows the "recrawl in progress"
		// skeleton. Summary state is owned by the recrawl pipeline — the
		// canonicalContentHash gate inside recrawlPromoteTier /
		// recrawlTieKeptCanonical decides whether to regenerate the AI excerpt,
		// so wiping summary here would mean a guaranteed regen even when the
		// canonical readable content has not actually changed.
		await deps.forceMarkCrawlPending({ url: articleUrl });
		await deps.publishRecrawlLinkInitiated({ url: articleUrl });

		const state = await reader.resolveReaderState({
			article: {
				url: articleUrl,
				metadata: existing.metadata,
				estimatedReadTime: existing.estimatedReadTime,
			},
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
		});

		const html = Base(AdminRecrawlPage({
			articleUrl,
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
		}), await deps.buildBannerState(req)).to("text/html");
		assert(
			state.crawl?.status === "pending",
			"force-pending + resolveReaderState must leave the crawl in 'pending'",
		);
		res.status(html.statusCode).type("html").send(html.body);
	};
}

function handleSummaryPoll(reader: ReturnType<typeof initArticleReader>) {
	return async (req: Request, res: Response): Promise<void> => {
		const parsed = RecrawlUrlSchema.safeParse(req.query.url);
		if (!parsed.success) {
			res.status(400).type("html").send("");
			return;
		}
		const articleUrl = parsed.data;
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleSummaryPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
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
		const articleUrl = parsed.data;
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleReaderPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
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
		formatDocumentTitle: formatRecrawlDocumentTitle,
		now: deps.now,
	});

	router.use(noStore);
	router.use(requireAdmin);

	router.get("/", handleLanding(deps));
	router.get("/summary", handleSummaryPoll(reader));
	router.get("/reader", handleReaderPoll(reader));
	router.get<string, Record<string, string>>(
		"/*",
		handleRecrawlArticle(deps, reader),
	);

	return router;
}
