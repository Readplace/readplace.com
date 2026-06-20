import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
	FindUserById,
	FindUserByEmail,
	GetSessionUserId,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	UpdatePassword,
	UserExistsByEmail,
	VerifyCredentials,
	ExistsUserByIdPrefix,
} from "@packages/provider-contracts/auth";
import type {
	CreateCheckoutSession,
	RetrieveCheckoutSession,
} from "@packages/provider-contracts/stripe-checkout";
import type {
	ConsumePendingSignup,
	StorePendingSignup,
} from "@packages/provider-contracts/pending-signup";
import type {
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";
import type {
	CreateTrialEndSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import type {
	PublishCancelSubscriptionCommand,
	PublishSubscriptionReactivated,
} from "@packages/provider-contracts/events";
import type {
	CreateSubscriptionOnExistingCustomer,
	ReverseScheduledCancellation,
} from "@packages/provider-contracts/stripe-subscriptions";
import type { ExchangeGoogleCode } from "@packages/provider-contracts/google-auth";
import type {
	CountArticlesByUser,
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleUrlById,
	FindArticlesByUser,
	MarkArticleViewed,
	SaveArticle,
	SaveArticleGlobally,
	UpdateArticleStatus,
} from "@packages/provider-contracts/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type {
	FindArticleCrawlStatus,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";
import type {
	FindGeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import type { PublishLinkSaved } from "@packages/provider-contracts/events";
import type { PublishRecrawlLinkInitiated } from "@packages/provider-contracts/events";
import type { PublishSaveAnonymousLink } from "@packages/provider-contracts/events";
import type { PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawPdfCommand } from "@packages/provider-contracts/events";
import type { PublishExportUserDataCommand } from "@packages/provider-contracts/events";
import type { PutPendingHtml } from "@packages/provider-contracts/pending-html";
import type { PutPendingPdf } from "@packages/provider-contracts/pending-pdf";
import type { SendEmail } from "@packages/provider-contracts/email";
import type {
	CreateVerificationToken,
	VerifyEmailToken,
} from "@packages/provider-contracts/email-verification";
import type {
	CreatePasswordResetToken,
	VerifyPasswordResetToken,
} from "@packages/provider-contracts/password-reset";
import type {
	ConsumeRateLimit,
	RateLimitRules,
} from "@packages/provider-contracts/rate-limit";
import type { OAuthModel, ValidateAccessToken } from "@packages/provider-contracts/oauth";
import { HutchLogger } from "@packages/hutch-logger";
import type { AnalyticsEvent } from "./web/middleware/analytics";
import { initAuthRoutes } from "./web/auth/auth.page";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import { createClickAttributionMiddleware } from "./web/click-attribution.middleware";
import { createVisitorIdMiddleware } from "./web/visitor-id.middleware";
import { initGoogleAuthRoutes } from "./web/auth/google-auth.page";
import { SESSION_COOKIE_NAME } from "./web/auth/session-cookie";
import { isHttpsOrigin } from "./web/cookie-options";
import { initForgotPasswordRoutes } from "./web/auth/forgot-password.page";
import { initQueueRoutes } from "./web/pages/queue/queue.page";
import { QUEUE_PATH } from "./web/pages/queue/queue.url";
import { initImportSessionRoutes } from "./web/pages/import/import.page";
import type { ImportSessionStore } from "@packages/domain/import-session";
import type { ExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import type { HttpErrorMessageMapping } from "./web/pages/queue/queue.error";
import { initSaveRoutes } from "./web/pages/save/save.page";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import { initViewRoutes } from "./web/pages/view/view.page";
import type { ExpiryCountdown } from "./web/pages/view/view-expiry";
import { initAdminRecrawlRoutes } from "./web/pages/admin/recrawl.page";
import { initExportRoutes } from "./web/pages/export/export.page";
import { initAccountRoutes } from "./web/pages/account/account.page";
import { initAgentSkills } from "./web/agent-skills/agent-skills";
import { initMcpServer } from "./web/mcp/mcp-server";
import { initMcpRoutes } from "./web/mcp/mcp.routes";
import { buildMcpServerCard } from "./web/mcp/server-card";
import { initResolveSaveAccess } from "./web/mcp/save-access";
import { saveArticleFromUrl } from "./web/shared/save-article/save-article-from-url";
import type { FoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { initDualAuth } from "./web/dual-auth.middleware";
import { initMarkExtensionInstalled } from "./web/mark-extension-installed.middleware";
import { initOAuthRoutes } from "./web/oauth/oauth.routes";
import { Base } from "./web/base.component";
import { initBuildBannerState } from "./web/banner-state";
import { sendComponent, wantsMarkdown } from "@packages/web-shell";
import { wantsSiren } from "./web/content-negotiation";
import { CONTENT_SIGNAL_VALUE, contentSignalMiddleware } from "./web/content-signal.middleware";
import { linkHeaderMiddleware } from "./web/link-header.middleware";
import { AGENT_SCOPES_SUPPORTED, buildAgentAuthMetadata, renderAuthMarkdown } from "./web/agent-auth";
import { QuerystringFeatureToggle } from "./web/feature-toggle";
import { HomePage } from "./web/pages/home";
import { PrivacyPage } from "./web/pages/privacy";
import { TermsPage } from "./web/pages/terms";
import { E2EFixturePage } from "./web/pages/e2e-fixture";
import { createE2EFixturePdf } from "./web/pages/e2e-fixture-pdf";
import { initInstallRoutes } from "./web/pages/install";
import { NotFoundPage } from "./web/pages/not-found";
import { initGetEffectiveAccess } from "./domain/access/effective-access";
import { initRequireWriteAccess } from "./web/middleware/require-write-access.middleware";
import { initResolveVerificationStatus } from "./web/middleware/resolve-verification-status.middleware";
import { requireNotLocked } from "./web/middleware/require-not-locked.middleware";
import { requireEnv, getEnv } from "./domain/require-env";
import "./web/session.types";

export const PORT = requireEnv("PORT", { defaultValue: "3000" });

const noop = () => {};

interface AppDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	appOrigin: string;
	staticBaseUrl: string;
	hashPassword: (password: string) => Promise<string>;
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
	findUserById: FindUserById;
	googleAuth?: {
		exchangeGoogleCode: ExchangeGoogleCode;
		clientId: string;
		clientSecret: string;
	};
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	saveArticle: SaveArticle;
	saveArticleGlobally: SaveArticleGlobally;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
	sendEmail: SendEmail;
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
	userExistsByEmail: UserExistsByEmail;
	existsUserByIdPrefix: ExistsUserByIdPrefix;
	updatePassword: UpdatePassword;
	baseUrl: string;
	logError: (message: string, error?: Error) => void;
	oauthModel: OAuthModel;
	validateAccessToken: ValidateAccessToken;
	publishLinkSaved: PublishLinkSaved;
	publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	publishStaleCheckRequested: PublishStaleCheckRequested;
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand;
	publishExportUserDataCommand: PublishExportUserDataCommand;
	findEmailByUserId: FindEmailByUserId;
	putPendingHtml: PutPendingHtml;
	putPendingPdf: PutPendingPdf;
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
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
	extractLinksFromPageUrl: ExtractLinksFromPageUrl;
	now: () => Date;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	createCheckoutSession: CreateCheckoutSession;
	consumePendingSignup: ConsumePendingSignup;
	storePendingSignup: StorePendingSignup;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	publishSubscriptionReactivated: PublishSubscriptionReactivated;
	subscriptionProviders: {
		upsertActive: UpsertActiveSubscription;
		upsertTrialing: UpsertTrialingSubscription;
		findByUserId: FindSubscriptionByUserId;
		markActive: MarkSubscriptionActive;
	};
	trialScheduler: {
		createTrialEndSchedule: CreateTrialEndSchedule;
		deleteTrialEndSchedule: DeleteTrialEndSchedule;
		deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	};
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	stripePriceId: string;
	botDefenseLogger: HutchLogger.Typed<BotDefenseEvent>;
	conversionLogger: HutchLogger.Typed<ConversionEvent>;
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	foundingAllocation: FoundingAllocation;
	expiryCountdown: ExpiryCountdown;
	consumeRateLimit: ConsumeRateLimit;
	rateLimitRules: RateLimitRules;
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
	const { appOrigin, staticBaseUrl, getSessionUserId, countUsers, foundingAllocation, ...deps } = dependencies;
	const app: Express = express();

	app.use((req: Request, res: Response, next: NextFunction) => {
		if (req.headers.host === "hutch-app.com") {
			res.redirect(301, `${appOrigin}${req.originalUrl}`);
			return;
		}
		next();
	});

	const agentSkills = initAgentSkills();

	const getEffectiveAccess = initGetEffectiveAccess({
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		now: deps.now,
	});

	/** The MCP server's tools are the same writes/reads the hypermedia `/queue`
	 * API performs, so an agent acting over MCP and the browser extension take
	 * the identical save and list paths — including the lockout and write-access
	 * gates the extension save clears (resolved here from the bearer-derived
	 * userId, since the request carries no session), so an MCP save is the
	 * identical write rather than a back door around them. Listing stays open
	 * while locked, matching `requireNotLocked`, so only `save_link` is gated. */
	const resolveSaveAccess = initResolveSaveAccess({
		findUserById: deps.findUserById,
		getEffectiveAccess,
		now: deps.now,
	});
	const mcpServer = initMcpServer({
		saveLink: async ({ userId, url }) => {
			const access = await resolveSaveAccess(userId);
			if (!access.allowed) {
				return { ok: false, message: access.message };
			}
			const validation = deps.validateSaveableUrl(url);
			if (validation.status === "ERROR") {
				return { ok: false, message: validation.error.message };
			}
			try {
				const freshness = await deps.refreshArticleIfStale({ url: validation.url });
				const { saved } = await saveArticleFromUrl(deps, {
					userId,
					url: validation.url,
					freshness,
				});
				return { ok: true, title: saved.metadata.title, url: saved.url };
			} catch (error) {
				deps.logError(
					"MCP save_link failed",
					error instanceof Error ? error : undefined,
				);
				return { ok: false, message: "Could not save the link right now." };
			}
		},
		listQueue: async ({ userId, status }) => {
			const result = await deps.findArticlesByUser({
				userId,
				status,
				excludeContent: true,
			});
			return {
				total: result.total,
				articles: result.articles.map((article) => ({
					url: article.url,
					title: article.metadata.title,
					status: article.status,
				})),
			};
		},
	});

	const secureCookies = isHttpsOrigin(appOrigin);

	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());
	app.use(createVisitorIdMiddleware({ generateVisitorId: randomUUID, secure: secureCookies }));
	app.use(createClickAttributionMiddleware({ now: dependencies.now, secure: secureCookies }));

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

	app.use(contentSignalMiddleware);
	app.use(linkHeaderMiddleware);

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

	const resolveVerificationStatus = initResolveVerificationStatus({
		findUserById: deps.findUserById,
		markSessionEmailVerified: deps.markSessionEmailVerified,
		now: deps.now,
	});
	app.use(resolveVerificationStatus);

	const markExtensionInstalled = initMarkExtensionInstalled();
	app.use(markExtensionInstalled);

	const requireWriteAccess = initRequireWriteAccess({ getEffectiveAccess });
	const buildBannerState = initBuildBannerState({
		getEffectiveAccess,
		now: deps.now,
	});

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
				`Content-Signal: ${CONTENT_SIGNAL_VALUE}`,
				"Allow: /",
				`Disallow: ${QUEUE_PATH}`,
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
				`Sitemap: ${dependencies.baseUrl}/blog/sitemap.xml`,
			].join("\n"),
		);
	});

	app.get("/llms.txt", (_req: Request, res: Response) => {
		res.type("text/plain").send(LLMS_TXT);
	});

	app.get("/llms-full.txt", (_req: Request, res: Response) => {
		res.type("text/plain").send(LLMS_FULL_TXT);
	});

	app.get("/auth.md", (_req: Request, res: Response) => {
		res.type("text/markdown").send(renderAuthMarkdown(dependencies.baseUrl));
	});

	if (INDEXNOW_KEY) {
		app.get(`/${INDEXNOW_KEY}.txt`, (_req: Request, res: Response) => {
			res.type("text/plain").send(INDEXNOW_KEY);
		});
	}

	app.get("/sitemap.xml", (_req: Request, res: Response) => {
		/** Blog URLs live in blog-site's own sitemap at /blog/sitemap.xml
		 * (advertised in robots.txt), since the blog is a separate deployable
		 * and hutch can no longer enumerate its posts. */
		const pages: { loc: string; priority: string; changefreq: string; lastmod: string }[] = [
			{ loc: "/", priority: "1.0", changefreq: "weekly", lastmod: "2026-04-08" },
			{ loc: "/install", priority: "0.8", changefreq: "monthly", lastmod: "2026-03-01" },
			{ loc: "/login", priority: "0.5", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/signup", priority: "0.5", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/privacy", priority: "0.3", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/terms", priority: "0.3", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/llms.txt", priority: "0.3", changefreq: "monthly", lastmod: "2026-04-08" },
			{ loc: "/llms-full.txt", priority: "0.3", changefreq: "monthly", lastmod: "2026-04-08" },
			{ loc: "/auth.md", priority: "0.3", changefreq: "monthly", lastmod: "2026-06-13" },
		];

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

	app.get("/health", (_req: Request, res: Response) => {
		res.json({ status: "ok" });
	});

	app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
		res.json({
			issuer: dependencies.baseUrl,
			authorization_endpoint: `${dependencies.baseUrl}/oauth/authorize`,
			token_endpoint: `${dependencies.baseUrl}/oauth/token`,
			revocation_endpoint: `${dependencies.baseUrl}/oauth/revoke`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			token_endpoint_auth_methods_supported: ["none"],
			code_challenge_methods_supported: ["S256"],
			agent_auth: buildAgentAuthMetadata(dependencies.baseUrl),
		});
	});

	app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
		res.json({
			resource: dependencies.baseUrl,
			resource_name: "Readplace",
			authorization_servers: [dependencies.baseUrl],
			scopes_supported: AGENT_SCOPES_SUPPORTED,
			bearer_methods_supported: ["header"],
			resource_documentation: `${dependencies.baseUrl}/auth.md`,
		});
	});

	app.get("/.well-known/api-catalog", (_req: Request, res: Response) => {
		res
			.set("Content-Type", 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"')
			.send(
				JSON.stringify(
					{
						linkset: [
							{
								anchor: dependencies.baseUrl,
								"service-doc": [{ href: `${dependencies.baseUrl}/llms-full.txt`, type: "text/plain" }],
								"service-meta": [
									{
										href: `${dependencies.baseUrl}/.well-known/oauth-protected-resource`,
										type: "application/json",
									},
								],
								status: [{ href: `${dependencies.baseUrl}/health`, type: "application/json" }],
							},
						],
					},
					null,
					2,
				),
			);
	});

	app.get("/.well-known/agent-skills/index.json", (_req: Request, res: Response) => {
		res.json(agentSkills.buildIndex());
	});

	for (const skill of agentSkills.getAll()) {
		app.get(`/.well-known/agent-skills/${skill.name}/SKILL.md`, (_req: Request, res: Response) => {
			res.type("text/markdown; charset=utf-8").send(skill.content);
		});
	}

	app.get("/.well-known/mcp/server-card.json", (_req: Request, res: Response) => {
		res.json(buildMcpServerCard(dependencies.baseUrl));
	});

	app.use(
		"/mcp",
		initMcpRoutes({
			validateAccessToken: deps.validateAccessToken,
			mcpServer,
			baseUrl: dependencies.baseUrl,
		}),
	);

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
		if (wantsSiren(req) && !wantsMarkdown(req)) {
			res.redirect(303, QUEUE_PATH);
			return;
		}

		const ua = req.headers["user-agent"] ?? "";
		const browser: "firefox" | "chrome" | "other" =
			ua.includes("Firefox/") ? "firefox"
			: ua.includes("Chrome/") ? "chrome"
			: "other";
		const userCount = await countUsers().catch(() => 0);
		const banner = await buildBannerState(req);
		sendComponent(
			req,
			res,
			Base(HomePage({ userCount, staticBaseUrl, browser, foundingAllocation }), banner),
		);
	});

	app.get("/privacy", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(PrivacyPage(), await buildBannerState(req)));
	});

	app.get("/terms", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(TermsPage(), await buildBannerState(req)));
	});

	// Path-uniqued article fixture for staging e2e tests. The :id segment is
	// ignored — body is identical for every id — so tests pass a per-run unique
	// value to ensure each CI run targets a fresh article row instead of
	// inheriting whatever state the previous run left in DynamoDB. Gated off
	// when NODE_ENV is "production" so the route does not exist on the prod
	// Lambda; tests (NODE_ENV=test via Jest) and local dev (NODE_ENV unset)
	// both expose it.
	if (getEnv("NODE_ENV") !== "production") {
		app.get("/e2e/article/:id", async (req: Request, res: Response) => {
			const title = typeof req.query.title === "string" ? req.query.title : undefined;
			sendComponent(req, res, Base(E2EFixturePage({ title }), await buildBannerState(req)));
		});

		/**
		 * Path-uniqued PDF fixture for the extension's pdf-save-flow staging e2e
		 * (projects/extensions/{chrome,firefox}-extension/src/e2e/pdf-save-flow/
		 * run.e2e-staging.main.ts). The `:id` segment is ignored — bytes are
		 * identical for every id — so callers pass `randomUUID()` to ensure each
		 * CI run targets a fresh save row and the deferred OCR pipeline cannot
		 * brick a subsequent run with cached state. Same gating as
		 * /e2e/article/:id: present on staging (NODE_ENV=development) and dev,
		 * absent on the production Lambda.
		 */
		const E2E_FIXTURE_PDF = createE2EFixturePdf("READPLACE_E2E_PDF_FIXTURE");
		app.get("/e2e/fixtures/pdf/:id.pdf", (_req: Request, res: Response) => {
			res.type("application/pdf").send(E2E_FIXTURE_PDF);
		});

		/** Deterministic newsletter-style page for the /import?mode=from-url
		 * e2e flow. Same gating as the article fixture: present on staging and
		 * dev, absent on the production Lambda. The `:label` segment lets tests
		 * inject per-run-unique links so concurrent CI runs don't collide on
		 * the same harvested URL set. */
		app.get("/e2e/fixtures/links-page/:label", (req: Request, res: Response) => {
			const label = String(req.params.label).replace(/[^a-zA-Z0-9-]/g, "");
			const anchors = [1, 2, 3]
				.map(
					(i) =>
						`<a href="${appOrigin}/privacy?import-from-url-${label}-${i}">Article ${i}</a>`,
				)
				.join("\n");
			res
				.type("text/html")
				.send(
					`<!doctype html><html><head><title>Test newsletter ${label}</title></head><body><nav><a href="/subscribe">Subscribe</a></nav>${anchors}</body></html>`,
				);
		});

		app.get("/e2e/fixtures/links-page-empty", (_req: Request, res: Response) => {
			res
				.type("text/html")
				.send("<!doctype html><html><body><p>No outbound links here.</p></body></html>");
		});

		app.get("/e2e/fixtures/links-page-error", (_req: Request, res: Response) => {
			res.status(500).type("text/html").send("<html><body>boom</body></html>");
		});
	}

	app.use(initInstallRoutes({ buildBannerState }));

	const authRouter = initAuthRoutes({
		hashPassword: deps.hashPassword,
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
		retrieveCheckoutSession: deps.retrieveCheckoutSession,
		consumePendingSignup: deps.consumePendingSignup,
		subscriptionProviders: {
			upsertActive: deps.subscriptionProviders.upsertActive,
			upsertTrialing: deps.subscriptionProviders.upsertTrialing,
		},
		trialScheduler: {
			createTrialEndSchedule: deps.trialScheduler.createTrialEndSchedule,
			deleteTrialEndSchedule: deps.trialScheduler.deleteTrialEndSchedule,
		},
		baseUrl: deps.baseUrl,
		staticBaseUrl,
		secureCookies,
		logError: deps.logError,
		now: deps.now,
		botDefenseLogger: deps.botDefenseLogger,
		conversionLogger: deps.conversionLogger,
		foundingAllocation,
		buildBannerState,
		consumeRateLimit: deps.consumeRateLimit,
		rateLimitRules: {
			login: deps.rateLimitRules.login,
			signup: deps.rateLimitRules.signup,
		},
	});
	app.use(authRouter);

	if (deps.googleAuth) {
		const googleAuthRouter = initGoogleAuthRoutes({
			googleClientId: deps.googleAuth.clientId,
			googleClientSecret: deps.googleAuth.clientSecret,
			appOrigin,
			baseUrl: deps.baseUrl,
			staticBaseUrl,
			secureCookies,
			createSession: deps.createSession,
			createGoogleUser: deps.createGoogleUser,
			findUserByEmail: deps.findUserByEmail,
			countUsers,
			markEmailVerified: deps.markEmailVerified,
			exchangeGoogleCode: deps.googleAuth.exchangeGoogleCode,
			upsertTrialing: deps.subscriptionProviders.upsertTrialing,
			createTrialEndSchedule: deps.trialScheduler.createTrialEndSchedule,
			sendEmail: deps.sendEmail,
			logError: deps.logError,
			now: deps.now,
			conversionLogger: deps.conversionLogger,
			foundingAllocation,
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
		consumeRateLimit: deps.consumeRateLimit,
		rateLimitRule: deps.rateLimitRules.forgotPassword,
	});
	app.use(forgotPasswordRouter);

	const dualAuthMiddleware = initDualAuth({
		validateAccessToken: deps.validateAccessToken,
	});

	const featureToggle = new QuerystringFeatureToggle();

	const queueRouter = initQueueRoutes({
		validateSaveableUrl: deps.validateSaveableUrl,
		appOrigin,
		findArticlesByUser: deps.findArticlesByUser,
		countArticlesByUser: deps.countArticlesByUser,
		findArticleById: deps.findArticleById,
		findArticleByUrl: deps.findArticleByUrl,
		findArticleUrlById: deps.findArticleUrlById,
		saveArticle: deps.saveArticle,
		deleteArticle: deps.deleteArticle,
		updateArticleStatus: deps.updateArticleStatus,
		markArticleViewed: deps.markArticleViewed,
		publishLinkSaved: deps.publishLinkSaved,
		publishSaveLinkRawHtmlCommand: deps.publishSaveLinkRawHtmlCommand,
		publishSaveLinkRawPdfCommand: deps.publishSaveLinkRawPdfCommand,
		putPendingHtml: deps.putPendingHtml,
		putPendingPdf: deps.putPendingPdf,
		findGeneratedSummary: deps.findGeneratedSummary,
		markSummaryPending: deps.markSummaryPending,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		refreshArticleIfStale: deps.refreshArticleIfStale,
		publishUpdateFetchTimestamp: deps.publishUpdateFetchTimestamp,
		readArticleContent: deps.readArticleContent,
		httpErrorMessageMapping: deps.httpErrorMessageMapping,
		dualAuth: dualAuthMiddleware,
		resolveVerificationStatus,
		requireWriteAccess,
		getEffectiveAccess,
		buildBannerState,
		logError: deps.logError,
		logParseError: deps.logParseError,
		analytics: deps.analytics,
		salt: deps.salt,
		now: deps.now,
		featureToggle,
	});
	/** `dualAuthMiddleware` is applied INSIDE the queue router rather than at this
	 * mount so that `GET /queue/:id/view` (and its legacy `/read` redirect) can
	 * stay publicly reachable. Shared reader permalinks (people copy them from
	 * the browser URL bar) redirect non-owners and anonymous visitors to
	 * `/view/<url>` instead of bouncing them to /login. */
	app.use(QUEUE_PATH, extensionCors, queueRouter);

	const importRouter = initImportSessionRoutes({
		validateSaveableUrl: deps.validateSaveableUrl,
		importSessionStore: deps.importSessionStore,
		extractLinksFromPageUrl: deps.extractLinksFromPageUrl,
		saveArticle: deps.saveArticle,
		updateArticleStatus: deps.updateArticleStatus,
		markCrawlPending: deps.markCrawlPending,
		markSummaryPending: deps.markSummaryPending,
		publishUpdateFetchTimestamp: deps.publishUpdateFetchTimestamp,
		publishLinkSaved: deps.publishLinkSaved,
		refreshArticleIfStale: deps.refreshArticleIfStale,
		logError: deps.logError,
		analytics: deps.analytics,
		salt: deps.salt,
		now: deps.now,
		buildBannerState,
	});
	app.use("/import", requireAuth, requireNotLocked, requireWriteAccess, importRouter);

	const saveRouter = initSaveRoutes({ buildBannerState, analytics: deps.analytics, salt: deps.salt, now: deps.now, secureCookies, generatePendingSaveId: randomUUID });
	app.use("/save", saveRouter);

	const viewRouter = initViewRoutes({
		validateSaveableUrl: deps.validateSaveableUrl,
		appOrigin,
		findArticleByUrl: deps.findArticleByUrl,
		readArticleContent: deps.readArticleContent,
		findGeneratedSummary: deps.findGeneratedSummary,
		markSummaryPending: deps.markSummaryPending,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		saveArticleGlobally: deps.saveArticleGlobally,
		publishSaveAnonymousLink: deps.publishSaveAnonymousLink,
		publishStaleCheckRequested: deps.publishStaleCheckRequested,
		consumeRateLimit: deps.consumeRateLimit,
		viewCrawlRateLimit: deps.rateLimitRules.viewCrawl,
		existsUserByIdPrefix: deps.existsUserByIdPrefix,
		expiryCountdown: deps.expiryCountdown,
		now: deps.now,
		buildBannerState,
		analytics: deps.analytics,
		salt: deps.salt,
	});
	app.use("/view", viewRouter);

	const adminRecrawlRouter = initAdminRecrawlRoutes({
		appOrigin,
		findArticleByUrl: deps.findArticleByUrl,
		readArticleContent: deps.readArticleContent,
		findGeneratedSummary: deps.findGeneratedSummary,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		forceMarkCrawlPending: deps.forceMarkCrawlPending,
		publishRecrawlLinkInitiated: deps.publishRecrawlLinkInitiated,
		findUserByEmail: deps.findUserByEmail,
		adminEmails: deps.adminEmails,
		serviceToken: deps.recrawlServiceToken,
		now: deps.now,
		buildBannerState,
	});
	app.use("/admin/recrawl", adminRecrawlRouter);

	const exportRouter = initExportRoutes({
		publishExportUserDataCommand: deps.publishExportUserDataCommand,
		findEmailByUserId: deps.findEmailByUserId,
		logError: deps.logError,
		now: () => new Date(),
		buildBannerState,
	});
	app.use("/export", requireAuth, exportRouter);

	const accountRouter = initAccountRoutes({
		getEffectiveAccess,
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		upsertActiveSubscription: deps.subscriptionProviders.upsertActive,
		upsertTrialingSubscription: deps.subscriptionProviders.upsertTrialing,
		markActiveSubscription: deps.subscriptionProviders.markActive,
		findEmailByUserId: deps.findEmailByUserId,
		publishCancelSubscriptionCommand: deps.publishCancelSubscriptionCommand,
		publishSubscriptionReactivated: deps.publishSubscriptionReactivated,
		createCheckoutSession: deps.createCheckoutSession,
		createSubscriptionOnExistingCustomer: deps.createSubscriptionOnExistingCustomer,
		reverseScheduledCancellation: deps.reverseScheduledCancellation,
		createTrialEndSchedule: deps.trialScheduler.createTrialEndSchedule,
		deleteDeferredCancellationSchedule:
			deps.trialScheduler.deleteDeferredCancellationSchedule,
		storePendingSignup: deps.storePendingSignup,
		stripePriceId: deps.stripePriceId,
		buildCheckoutSuccessUrl: (sessionIdPlaceholder) =>
			`${appOrigin}/auth/checkout/success?session_id=${sessionIdPlaceholder}`,
		appOrigin,
		logger: HutchLogger.from({
			info: noop,
			error: (...args) => {
				deps.logError(String(args[0]), args[1] instanceof Error ? args[1] : undefined);
			},
			warn: noop,
			debug: noop,
		}),
		now: deps.now,
		buildBannerState,
	});
	app.use("/account", requireAuth, accountRouter);

	const oauthRouter = initOAuthRoutes({
		model: deps.oauthModel,
		buildBannerState,
	});
	app.use("/oauth/token", extensionCors);
	app.use("/oauth/revoke", extensionCors);
	app.use("/oauth", oauthRouter);

	app.use(async (req: Request, res: Response) => {
		sendComponent(req, res, Base(NotFoundPage(), await buildBannerState(req)));
	});

	return app;
}
