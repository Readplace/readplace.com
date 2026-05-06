import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import type { LogParseError } from "@packages/hutch-infra-components";
import type {
	CountUsers,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroySession,
	FindEmailByUserId,
	FindUserByEmail,
	GetSessionUserId,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	UpdatePassword,
	UserExistsByEmail,
	VerifyCredentials,
} from "@packages/test-fixtures/providers/auth";
import type {
	CreateCheckoutSession,
	RetrieveCheckoutSession,
} from "@packages/test-fixtures/providers/stripe-checkout";
import type {
	ConsumePendingSignup,
	StorePendingSignup,
} from "@packages/test-fixtures/providers/pending-signup";
import type { ExchangeGoogleCode } from "@packages/test-fixtures/providers/google-auth";
import type {
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticlesByUser,
	SaveArticle,
	SaveArticleGlobally,
	UpdateArticleStatus,
} from "@packages/test-fixtures/providers/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import type { ReadArticleContent } from "@packages/test-fixtures/providers/article-store";
import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type {
	FindArticleCrawlStatus,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "@packages/test-fixtures/providers/article-crawl";
import type {
	FindGeneratedSummary,
	ForceMarkSummaryPending,
	MarkSummaryPending,
} from "@packages/test-fixtures/providers/article-summary";
import type { PublishLinkSaved } from "@packages/test-fixtures/providers/events";
import type { PublishRecrawlLinkInitiated } from "@packages/test-fixtures/providers/events";
import type { PublishSaveAnonymousLink } from "@packages/test-fixtures/providers/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/test-fixtures/providers/events";
import type { PublishExportUserDataCommand } from "@packages/test-fixtures/providers/events";
import type { PutPendingHtml } from "@packages/test-fixtures/providers/pending-html";
import type { SendEmail } from "@packages/test-fixtures/providers/email";
import type {
	CreateVerificationToken,
	VerifyEmailToken,
} from "@packages/test-fixtures/providers/email-verification";
import type {
	CreatePasswordResetToken,
	VerifyPasswordResetToken,
} from "@packages/test-fixtures/providers/password-reset";
import type { OAuthModel } from "@packages/test-fixtures/providers/oauth";
import type { HutchLogger } from "@packages/hutch-logger";
import { initAuthRoutes } from "./web/auth/auth.page";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import { initGoogleAuthRoutes } from "./web/auth/google-auth.page";
import { SESSION_COOKIE_NAME } from "./web/auth/session-cookie";
import { initForgotPasswordRoutes } from "./web/auth/forgot-password.page";
import { initQueueRoutes } from "./web/pages/queue/queue.page";
import { initImportSessionRoutes } from "./web/pages/import/import.page";
import type { ImportSessionStore } from "@packages/domain/import-session";
import type { HttpErrorMessageMapping } from "./web/pages/queue/queue.error";
import { initSaveRoutes } from "./web/pages/save/save.page";
import { initViewRoutes } from "./web/pages/view/view.page";
import { initAdminRecrawlRoutes } from "./web/pages/admin/recrawl.page";
import { initEmbedRoutes } from "./web/pages/embed/embed.page";
import { initExportRoutes } from "./web/pages/export/export.page";
import { initBlogRoutes } from "./web/pages/blog";
import { getAllPostMetadata } from "./web/pages/blog/blog.posts";
import { initDualAuth, type ValidateAccessToken } from "./web/dual-auth.middleware";
import { initMarkExtensionInstalled } from "./web/mark-extension-installed.middleware";
import { initOAuthRoutes } from "./web/oauth/oauth.routes";
import { renderPage } from "./web/render-page";
import { sendComponent } from "./web/send-component";
import { wantsSiren } from "./web/content-negotiation";
import { HomePage } from "./web/pages/home";
import { PrivacyPage } from "./web/pages/privacy";
import { TermsPage } from "./web/pages/terms";
import { E2EFixturePage } from "./web/pages/e2e-fixture";
import { InstallPage, fetchFirefoxDownloadUrl, fetchChromeDownloadUrl } from "./web/pages/install";
import { NotFoundPage } from "./web/pages/not-found";
import { requireEnv, getEnv } from "./require-env";
import "./web/session.types";

export const PORT = requireEnv("PORT", { defaultValue: "3000" });

interface AppDependencies {
	appOrigin: string;
	staticBaseUrl: string;
	createUser: CreateUser;
	createUserWithPasswordHash: CreateUserWithPasswordHash;
	createGoogleUser: CreateGoogleUser;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	getSessionUserId: GetSessionUserId;
	destroySession: DestroySession;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	googleAuth?: {
		exchangeGoogleCode: ExchangeGoogleCode;
		clientId: string;
		clientSecret: string;
	};
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticlesByUser: FindArticlesByUser;
	saveArticle: SaveArticle;
	saveArticleGlobally: SaveArticleGlobally;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	sendEmail: SendEmail;
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
	userExistsByEmail: UserExistsByEmail;
	updatePassword: UpdatePassword;
	baseUrl: string;
	logError: (message: string, error?: Error) => void;
	oauthModel: OAuthModel;
	validateAccessToken: ValidateAccessToken;
	publishLinkSaved: PublishLinkSaved;
	publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishExportUserDataCommand: PublishExportUserDataCommand;
	findEmailByUserId: FindEmailByUserId;
	putPendingHtml: PutPendingHtml;
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	forceMarkSummaryPending: ForceMarkSummaryPending;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	forceMarkCrawlPending: ForceMarkCrawlPending;
	refreshArticleIfStale: RefreshArticleIfStale;
	adminEmails: readonly string[];
	recrawlServiceToken: string;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	readArticleContent: ReadArticleContent;
	httpErrorMessageMapping: HttpErrorMessageMapping;
	logParseError: LogParseError;
	importSessionStore: ImportSessionStore;
	now: () => Date;
	createCheckoutSession: CreateCheckoutSession;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	storePendingSignup: StorePendingSignup;
	consumePendingSignup: ConsumePendingSignup;
	botDefenseLogger: HutchLogger.Typed<BotDefenseEvent>;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
	if (!req.userId) {
		res.redirect(303, "/login");
		return;
	}
	next();
}

const LLMS_TXT = readFileSync(join(__dirname, "llms.txt"), "utf-8");
const LLMS_FULL_TXT = readFileSync(join(__dirname, "llms-full.txt"), "utf-8");
const INDEXNOW_KEY = getEnv("INDEXNOW_KEY");

export function createApp(dependencies: AppDependencies): Express {
	const { appOrigin, staticBaseUrl, getSessionUserId, countUsers, ...deps } = dependencies;
	const app: Express = express();

	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());

	// Same-origin client bundles — the Lambda packaging step copies
	// src/runtime/web/client-dist/ into the bundle, so `__dirname/web/client-dist`
	// resolves both in dev (tsx → src/runtime/) and in prod (Lambda → /var/task/).
	app.use(
		"/client-dist",
		express.static(resolve(__dirname, "web", "client-dist"), {
			maxAge: "5m",
			fallthrough: false,
		}),
	);

	app.use(async (req: Request, _res: Response, next: NextFunction) => {
		const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
		if (sessionId) {
			const session = await getSessionUserId(sessionId);
			if (session) {
				req.userId = session.userId;
				req.emailVerified = session.emailVerified;
			}
		}
		next();
	});

	const markExtensionInstalled = initMarkExtensionInstalled();
	app.use(markExtensionInstalled);

	app.get("/favicon.ico", (_req: Request, res: Response) => {
		res.redirect(301, `${staticBaseUrl}/favicon.ico`);
	});

	/** iOS Safari and other clients auto-fetch /apple-touch-icon[-NxN][-precomposed].png from the root before reading <link rel="apple-touch-icon"> in the HTML. Redirect every shape to the static CDN. */
	app.get(/^\/apple-touch-icon(?:-\d+x\d+)?(?:-precomposed)?\.png$/, (req: Request, res: Response) => {
		res.redirect(301, `${staticBaseUrl}${req.path}`);
	});

	app.get("/robots.txt", (_req: Request, res: Response) => {
		res.type("text/plain").send(
			[
				"User-agent: *",
				"Allow: /",
				"Disallow: /queue",
				"Disallow: /export",
				"Disallow: /oauth",
				"Disallow: /forgot-password",
				"",
				"User-agent: GPTBot",
				"Allow: /",
				"",
				"User-agent: PerplexityBot",
				"Allow: /",
				"",
				"User-agent: ClaudeBot",
				"Allow: /",
				"",
				"User-agent: Googlebot",
				"Allow: /",
				"",
				`Sitemap: ${dependencies.baseUrl}/sitemap.xml`,
			].join("\n"),
		);
	});

	app.get("/llms.txt", (_req: Request, res: Response) => {
		res.type("text/plain").send(LLMS_TXT);
	});

	app.get("/llms-full.txt", (_req: Request, res: Response) => {
		res.type("text/plain").send(LLMS_FULL_TXT);
	});

	if (INDEXNOW_KEY) {
		app.get(`/${INDEXNOW_KEY}.txt`, (_req: Request, res: Response) => {
			res.type("text/plain").send(INDEXNOW_KEY);
		});
	}

	app.get("/sitemap.xml", (_req: Request, res: Response) => {
		const blogPriorityMap: Record<string, string> = {
			"best-read-it-later-apps-2026": "0.9",
			"omnivore-alternative": "0.9",
			"readplace-vs-readwise-reader": "0.8",
			"readplace-vs-instapaper": "0.8",
			"how-ai-tldr-actually-works": "0.8",
			"free-read-it-later-apps-2026": "0.8",
			"readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later": "0.8",
		};

		const pages: { loc: string; priority: string; changefreq: string; lastmod: string }[] = [
			{ loc: "/", priority: "1.0", changefreq: "weekly", lastmod: "2026-04-08" },
			{ loc: "/blog", priority: "0.8", changefreq: "weekly", lastmod: "2026-04-07" },
			{ loc: "/install", priority: "0.8", changefreq: "monthly", lastmod: "2026-03-01" },
			{ loc: "/login", priority: "0.5", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/signup", priority: "0.5", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/privacy", priority: "0.3", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/terms", priority: "0.3", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/llms.txt", priority: "0.3", changefreq: "monthly", lastmod: "2026-04-08" },
			{ loc: "/llms-full.txt", priority: "0.3", changefreq: "monthly", lastmod: "2026-04-08" },
		];

		for (const post of getAllPostMetadata()) {
			pages.push({
				loc: `/blog/${post.slug}`,
				priority: blogPriorityMap[post.slug] ?? "0.7",
				changefreq: "weekly",
				lastmod: post.date,
			});
		}
		const urls = pages
			.map(
				(p) =>
					`  <url>\n    <loc>${dependencies.baseUrl}${p.loc}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
			)
			.join("\n");
		res.type("application/xml").send(
			`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
		);
	});

	const extensionCors = cors({
		origin: (origin, callback) => {
			if (
				!origin ||
				origin === appOrigin ||
				origin === "https://hutch-app.com" ||
				/^(moz|chrome)-extension:\/\//.test(origin)
			) {
				callback(null, true);
			} else {
				callback(null, false);
			}
		},
		methods: ["GET", "POST", "PUT", "DELETE"],
		allowedHeaders: ["Authorization", "Content-Type", "Accept", "Prefer"],
		maxAge: 86400,
	});

	/** Firefox extensions enforce CORS preflight for fetches with non-simple headers (Accept: application/vnd.siren+json, Authorization). Register OPTIONS so the preflight succeeds; without this it returns 404 and firefox aborts the fetch with NetworkError. */
	app.options("/", extensionCors);
	app.get("/", extensionCors, async (req: Request, res: Response) => {
		if (wantsSiren(req)) {
			res.redirect(303, "/queue");
			return;
		}

		const ua = req.headers["user-agent"] ?? "";
		const browser: "firefox" | "chrome" | "other" =
			ua.includes("Firefox/") ? "firefox"
			: ua.includes("Chrome/") ? "chrome"
			: "other";
		const userCount = await countUsers().catch(() => 0);
		sendComponent(res, renderPage(req, HomePage({ userCount, staticBaseUrl, browser })));
	});

	app.get("/privacy", (req: Request, res: Response) => {
		sendComponent(res, renderPage(req, PrivacyPage()));
	});

	app.get("/terms", (req: Request, res: Response) => {
		sendComponent(res, renderPage(req, TermsPage()));
	});

	// Path-uniqued article fixture for staging e2e tests. The :id segment is
	// ignored — body is identical for every id — so tests pass a per-run unique
	// value to ensure each CI run targets a fresh article row instead of
	// inheriting whatever state the previous run left in DynamoDB. Gated off
	// when NODE_ENV is "production" so the route does not exist on the prod
	// Lambda; tests (NODE_ENV=test via Jest) and local dev (NODE_ENV unset)
	// both expose it.
	if (getEnv("NODE_ENV") !== "production") {
		app.get("/e2e/article/:id", (req: Request, res: Response) => {
			sendComponent(res, renderPage(req, E2EFixturePage()));
		});
	}

	app.get("/install", async (req: Request, res: Response) => {
		const browser = req.query.browser === "firefox" ? "firefox" : "chrome";
		const [firefox, chrome] = await Promise.all([
			fetchFirefoxDownloadUrl(),
			fetchChromeDownloadUrl(),
		]);
		sendComponent(res, renderPage(req, InstallPage({ firefox, chrome, browser })));
	});

	const blogRouter = initBlogRoutes();
	app.use("/blog", (req: Request, res: Response, next: NextFunction) => {
		if (req.headers.host === "hutch-app.com") {
			res.redirect(301, `${appOrigin}${req.originalUrl}`);
			return;
		}
		next();
	});
	app.use("/blog", blogRouter);
	app.use("/embed", initEmbedRoutes({ appOrigin }));

	const authRouter = initAuthRoutes({
		createUserWithPasswordHash: deps.createUserWithPasswordHash,
		createGoogleUser: deps.createGoogleUser,
		findUserByEmail: deps.findUserByEmail,
		verifyCredentials: deps.verifyCredentials,
		createSession: deps.createSession,
		destroySession: deps.destroySession,
		countUsers,
		markEmailVerified: deps.markEmailVerified,
		markSessionEmailVerified: deps.markSessionEmailVerified,
		sendEmail: deps.sendEmail,
		createVerificationToken: deps.createVerificationToken,
		verifyEmailToken: deps.verifyEmailToken,
		createCheckoutSession: deps.createCheckoutSession,
		retrieveCheckoutSession: deps.retrieveCheckoutSession,
		storePendingSignup: deps.storePendingSignup,
		consumePendingSignup: deps.consumePendingSignup,
		appOrigin,
		baseUrl: deps.baseUrl,
		staticBaseUrl,
		logError: deps.logError,
		now: deps.now,
		botDefenseLogger: deps.botDefenseLogger,
	});
	app.use(authRouter);

	if (deps.googleAuth) {
		const googleAuthRouter = initGoogleAuthRoutes({
			googleClientId: deps.googleAuth.clientId,
			googleClientSecret: deps.googleAuth.clientSecret,
			appOrigin,
			baseUrl: deps.baseUrl,
			staticBaseUrl,
			createSession: deps.createSession,
			createGoogleUser: deps.createGoogleUser,
			findUserByEmail: deps.findUserByEmail,
			countUsers,
			markEmailVerified: deps.markEmailVerified,
			exchangeGoogleCode: deps.googleAuth.exchangeGoogleCode,
			createCheckoutSession: deps.createCheckoutSession,
			storePendingSignup: deps.storePendingSignup,
			sendEmail: deps.sendEmail,
			logError: deps.logError,
		});
		app.use(googleAuthRouter);
	}

	const forgotPasswordRouter = initForgotPasswordRoutes({
		sendEmail: deps.sendEmail,
		userExistsByEmail: deps.userExistsByEmail,
		updatePassword: deps.updatePassword,
		createPasswordResetToken: deps.createPasswordResetToken,
		verifyPasswordResetToken: deps.verifyPasswordResetToken,
		baseUrl: deps.baseUrl,
		logError: deps.logError,
	});
	app.use(forgotPasswordRouter);

	const dualAuthMiddleware = initDualAuth({
		validateAccessToken: deps.validateAccessToken,
	});

	const queueRouter = initQueueRoutes({
		findArticlesByUser: deps.findArticlesByUser,
		findArticleById: deps.findArticleById,
		saveArticle: deps.saveArticle,
		deleteArticle: deps.deleteArticle,
		updateArticleStatus: deps.updateArticleStatus,
		publishLinkSaved: deps.publishLinkSaved,
		publishSaveLinkRawHtmlCommand: deps.publishSaveLinkRawHtmlCommand,
		putPendingHtml: deps.putPendingHtml,
		findGeneratedSummary: deps.findGeneratedSummary,
		markSummaryPending: deps.markSummaryPending,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		refreshArticleIfStale: deps.refreshArticleIfStale,
		publishUpdateFetchTimestamp: deps.publishUpdateFetchTimestamp,
		readArticleContent: deps.readArticleContent,
		httpErrorMessageMapping: deps.httpErrorMessageMapping,
		logError: deps.logError,
		logParseError: deps.logParseError,
		now: deps.now,
	});
	app.use("/queue", extensionCors, dualAuthMiddleware, queueRouter);

	const importRouter = initImportSessionRoutes({
		importSessionStore: deps.importSessionStore,
		saveArticle: deps.saveArticle,
		updateArticleStatus: deps.updateArticleStatus,
		markCrawlPending: deps.markCrawlPending,
		markSummaryPending: deps.markSummaryPending,
		publishUpdateFetchTimestamp: deps.publishUpdateFetchTimestamp,
		publishLinkSaved: deps.publishLinkSaved,
		refreshArticleIfStale: deps.refreshArticleIfStale,
		logError: deps.logError,
	});
	app.use("/import", requireAuth, importRouter);

	const saveRouter = initSaveRoutes();
	app.use("/save", saveRouter);

	const viewRouter = initViewRoutes({
		findArticleByUrl: deps.findArticleByUrl,
		readArticleContent: deps.readArticleContent,
		findGeneratedSummary: deps.findGeneratedSummary,
		markSummaryPending: deps.markSummaryPending,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		refreshArticleIfStale: deps.refreshArticleIfStale,
		saveArticleGlobally: deps.saveArticleGlobally,
		publishSaveAnonymousLink: deps.publishSaveAnonymousLink,
		now: deps.now,
	});
	app.use("/view", viewRouter);

	const adminRecrawlRouter = initAdminRecrawlRoutes({
		findArticleByUrl: deps.findArticleByUrl,
		readArticleContent: deps.readArticleContent,
		findGeneratedSummary: deps.findGeneratedSummary,
		markSummaryPending: deps.markSummaryPending,
		forceMarkSummaryPending: deps.forceMarkSummaryPending,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		forceMarkCrawlPending: deps.forceMarkCrawlPending,
		publishRecrawlLinkInitiated: deps.publishRecrawlLinkInitiated,
		findUserByEmail: deps.findUserByEmail,
		adminEmails: deps.adminEmails,
		serviceToken: deps.recrawlServiceToken,
		now: deps.now,
	});
	app.use("/admin/recrawl", adminRecrawlRouter);

	const exportRouter = initExportRoutes({
		publishExportUserDataCommand: deps.publishExportUserDataCommand,
		findEmailByUserId: deps.findEmailByUserId,
		logError: deps.logError,
		now: () => new Date(),
	});
	app.use("/export", requireAuth, exportRouter);

	const oauthRouter = initOAuthRoutes({
		model: deps.oauthModel,
	});
	app.use("/oauth/token", extensionCors);
	app.use("/oauth/revoke", extensionCors);
	app.use("/oauth", oauthRouter);

	app.use((req: Request, res: Response) => {
		sendComponent(res, renderPage(req, NotFoundPage()));
	});

	return app;
}
