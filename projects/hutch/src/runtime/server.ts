import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { isbot } from "isbot";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { ClientNameInGroup } from "@packages/supported-clients";
import type {
	CountUsers,
	CreateAppleUser,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroySession,
	DestroyUserSessions,
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
import type {
	BeginAddCard,
	ListCards,
	RemoveCard,
	SetPrimaryCard,
} from "@packages/provider-contracts/payment-methods";
import type { ExchangeGoogleCode } from "@packages/provider-contracts/google-auth";
import type { ExchangeAppleCode } from "@packages/provider-contracts/apple-auth";
import type { GetIosAppSignals, RecordIosAnyActivity, RecordIosSavedArticle } from "@packages/provider-contracts/ios-onboarding-signal";
import type {
	CountArticlesByUser,
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesByUser,
	MarkArticleViewed,
	MarkSummaryToggled,
	SaveArticle,
	SaveArticleGlobally,
	UpdateArticleStatus,
} from "@packages/provider-contracts/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { ContentProvider, ReadArticleContent } from "@packages/provider-contracts/article-store";
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
import type {
	FindOAuthClient,
	OAuthModel,
	RegisterOAuthClient,
	ValidateAccessToken,
	ValidateOAuthRedirectUri,
} from "@packages/provider-contracts/oauth";
import { HutchLogger } from "@packages/hutch-logger";
import type { AnalyticsEvent } from "./web/middleware/analytics";
import { initAuthRoutes } from "./web/auth/auth.page";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import { createClickAttributionMiddleware } from "./web/click-attribution.middleware";
import { createVisitorIdMiddleware } from "./web/visitor-id.middleware";
import { initGoogleAuthRoutes } from "./web/auth/google-auth.page";
import { initAppleAuthRoutes } from "./web/auth/apple-auth.page";
import { initResolveLogin } from "@packages/web-session";
import { isHttpsOrigin } from "./web/cookie-options";
import { initForgotPasswordRoutes } from "./web/auth/forgot-password.page";
import { initQueueRoutes } from "./web/pages/queue/queue.page";
import {
	ChromelessReader,
	RegularReader,
} from "./web/shared/article-body/reader-actions/reader-actions.component";
import { QUEUE_PATH } from "./web/pages/queue/queue.url";
import { initImportSessionRoutes } from "./web/pages/import/import.page";
import type { ImportSessionStore } from "@packages/domain/import-session";
import { DEFAULT_INBOX_ALIAS } from "@packages/domain/inbox";
import type { InboxAddressStore, InboxEmailLinkStore, InboxEmailStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { ExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import type { HttpErrorMessageMapping } from "./web/pages/queue/queue.error";
import { initSaveRoutes } from "./web/pages/save/save.page";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import { initViewRoutes } from "./web/pages/view/view.page";
import type { ExpiryCountdown } from "./web/pages/view/view-expiry";
import { initAdminRecrawlRoutes } from "./web/pages/admin/recrawl.page";
import { initExportRoutes } from "./web/pages/export/export.page";
import { initInboxRoutes } from "./web/pages/inbox/inbox.page";
import { initAccountRoutes } from "./web/pages/account/account.page";
import { initAgentSkills } from "./web/agent-skills/agent-skills";
import { initMcpServer } from "./web/mcp/mcp-server";
import { initMcpArticleOperations } from "./web/mcp/article-operations";
import { initMcpRoutes } from "./web/mcp/mcp.routes";
import { buildMcpServerCard } from "./web/mcp/server-card";
import { initResolveSaveAccess } from "./web/mcp/save-access";
import { initResolveToolAccess } from "./web/mcp/tool-access";
import { initSaveArticleFromUrl } from "./web/shared/save-article/save-article-from-url";
import type { FoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { initDualAuth } from "./web/dual-auth.middleware";
import { initMarkExtensionInstalled } from "./web/mark-extension-installed.middleware";
import { initOAuthRoutes } from "./web/oauth/oauth.routes";
import { Base } from "./web/base.component";
import { initBuildBannerState } from "./web/banner-state";
import type { GetChangelogBanner } from "./web/changelog-banner-source";
import { changelogDismissMiddleware } from "./web/changelog-dismiss.middleware";
import { initChangelogDismissRoute } from "./web/pages/banner/changelog-dismiss.route";
import { sendComponent, wantsMarkdown } from "@packages/web-shell";
import { wantsSiren } from "./web/content-negotiation";
import { CONTENT_SIGNAL_VALUE, contentSignalMiddleware } from "./web/content-signal.middleware";
import { linkHeaderMiddleware } from "./web/link-header.middleware";
import { AGENT_SCOPES_SUPPORTED, buildAgentAuthMetadata, renderAuthMarkdown } from "./web/agent-auth";
import { QuerystringFeatureToggle } from "./web/feature-toggle";
import { HomePage } from "./web/pages/home";
import { McpConnectPage } from "./web/pages/mcp";
import { PrivacyPage } from "./web/pages/privacy";
import { TermsPage } from "./web/pages/terms";
import { HelpAddLinksPage } from "./web/pages/help";
import { E2EFixturePage } from "./web/pages/e2e-fixture";
import { createE2EFixturePdf } from "./web/pages/e2e-fixture-pdf";
import { initInstallRoutes } from "./web/pages/install";
import { initLandingRoutes } from "./web/pages/landing";
import { detectInstallBrowser } from "./web/onboarding/extension-install";
import { NotFoundPage } from "./web/pages/not-found";
import { initGetEffectiveAccess } from "./domain/access/effective-access";
import { initRequireWriteAccess } from "./web/middleware/require-write-access.middleware";
import { initResolveVerificationStatus } from "./web/middleware/resolve-verification-status.middleware";
import { requireNotLocked } from "./web/middleware/require-not-locked.middleware";
import { requireEnv, getEnv } from "@packages/require-env";
import "./web/session.types";

export const PORT = requireEnv("PORT");

const noop = () => {};

interface AppDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	appOrigin: string;
	staticBaseUrl: string;
	hashPassword: (password: string) => Promise<string>;
	createUser: CreateUser;
	createUserWithPasswordHash: CreateUserWithPasswordHash;
	createGoogleUser: CreateGoogleUser;
	createAppleUser: CreateAppleUser;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	getSessionUserId: GetSessionUserId;
	destroySession: DestroySession;
	destroyUserSessions: DestroyUserSessions;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	findUserById: FindUserById;
	googleAuth?: {
		exchangeGoogleCode: ExchangeGoogleCode;
		clientId: string;
		clientSecret: string;
	};
	appleAuth?: {
		exchangeAppleCode: ExchangeAppleCode;
		clientId: string;
		stateSigningSecret: string;
	};
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleFreshness: FindArticleFreshness;
	findArticleUrlById: FindArticleUrlById;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	saveArticle: SaveArticle;
	saveArticleGlobally: SaveArticleGlobally;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
	markSummaryToggled: MarkSummaryToggled;
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
	findOAuthClient: FindOAuthClient;
	validateOAuthRedirectUri: ValidateOAuthRedirectUri;
	registerOAuthClient: RegisterOAuthClient;
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
	getIosAppSignals: GetIosAppSignals;
	recordIosAnyActivity: RecordIosAnyActivity;
	recordIosSavedArticle: RecordIosSavedArticle;
	adminEmails: readonly string[];
	recrawlServiceToken: string;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	readArticleContent: ReadArticleContent;
	httpErrorMessageMapping: HttpErrorMessageMapping;
	logParseError: LogParseError;
	importSessionStore: ImportSessionStore;
	extractLinksFromPageUrl: ExtractLinksFromPageUrl;
	inboxAddressStore: InboxAddressStore;
	inboxEmailStore: InboxEmailStore;
	inboxEmailLinkStore: InboxEmailLinkStore;
	readEmailContent: ContentProvider;
	inboxAddressDomain: string;
	getChangelogBanner: GetChangelogBanner;
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
	paymentMethods: {
		listCards: ListCards;
		beginAddCard: BeginAddCard;
		removeCard: RemoveCard;
		setPrimaryCard: SetPrimaryCard;
	};
	stripePriceId: string;
	stripePublishableKey: string | undefined;
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
	 * the identical save and list paths — including the lockout gate the
	 * extension save clears (resolved here from the bearer-derived userId, since
	 * the request carries no session), so an MCP save is the identical write
	 * rather than a back door around it. Listing stays open while locked, matching
	 * `requireNotLocked`, so only `save_link` is gated; the subscription paywall
	 * is enforced one level up by `resolveToolAccess`. */
	const resolveSaveAccess = initResolveSaveAccess({
		findUserById: deps.findUserById,
		now: deps.now,
	});
	/** The subscription paywall on the MCP surface: a read-only (lapsed)
	 * subscription has a new save (save_link) refused with a renewal upsell while
	 * the read tools stay open, and a trial in its final week gets a
	 * convert-to-annual nudge on successful results. Reads the same effective
	 * access the web banner does, so "lapsed" means the same thing to an agent as
	 * it does in the browser. */
	const resolveToolAccess = initResolveToolAccess({
		getEffectiveAccess,
		now: deps.now,
	});
	const mcpServer = initMcpServer({
		resolveToolAccess,
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
				const { saved } = await initSaveArticleFromUrl(deps)({
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
		...initMcpArticleOperations({
			findArticleById: deps.findArticleById,
			findArticlesByUser: deps.findArticlesByUser,
			readArticleContent: deps.readArticleContent,
			findGeneratedSummary: deps.findGeneratedSummary,
		}),
	});

	const secureCookies = isHttpsOrigin(appOrigin);

	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());
	app.use(changelogDismissMiddleware);
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

	const resolveLogin = initResolveLogin({
		getSessionUserId,
		logger: HutchLogger.from({
			info: noop,
			warn: noop,
			debug: noop,
			error: (...args) => deps.logError(String(args[0])),
		}),
	});
	app.use(async (req: Request, _res: Response, next: NextFunction) => {
		const login = await resolveLogin(req.headers.cookie);
		if (login.isAuthenticated) {
			req.userId = login.userId;
			req.emailVerified = login.emailVerified;
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

	const requireWriteAccess = initRequireWriteAccess({
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		now: deps.now,
	});
	const buildBannerState = initBuildBannerState({
		getEffectiveAccess,
		getChangelogBanner: deps.getChangelogBanner,
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
		/** Blog URLs live in the blog's own sitemap at /blog/sitemap.xml
		 * (advertised in robots.txt), since the blog is a separate deployable. */
		const pages: { loc: string; priority: string; changefreq: string; lastmod: string }[] = [
			{ loc: "/", priority: "1.0", changefreq: "weekly", lastmod: "2026-04-08" },
			{ loc: "/install", priority: "0.8", changefreq: "monthly", lastmod: "2026-03-01" },
			{ loc: "/login", priority: "0.5", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/signup", priority: "0.5", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/privacy", priority: "0.3", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/terms", priority: "0.3", changefreq: "yearly", lastmod: "2026-06-24" },
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
			registration_endpoint: `${dependencies.baseUrl}/oauth/register`,
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

	// Browsers visiting /mcp get the human connection guide; MCP clients (which
	// send Accept: application/json, text/event-stream — never text/html) fall
	// through to the Streamable-HTTP transport below, preserving its 405/POST
	// and 401 bootstrap behaviour unchanged.
	app.get("/mcp", async (req: Request, res: Response, next: NextFunction) => {
		if (!(req.headers.accept ?? "").includes("text/html")) {
			next();
			return;
		}
		sendComponent(req, res, Base(McpConnectPage(), await buildBannerState(req)));
	});

	app.use(
		"/mcp",
		initMcpRoutes({
			validateAccessToken: deps.validateAccessToken,
			mcpServer,
			baseUrl: dependencies.baseUrl,
		}),
	);

	const EXTENSION_ORIGIN_PATTERNS = {
		firefox: /^moz-extension:\/\//,
		chrome: /^chrome-extension:\/\//,
	} satisfies Record<ClientNameInGroup<"browserExtension">, RegExp>;
	const extensionOriginPattern = new RegExp(
		Object.values(EXTENSION_ORIGIN_PATTERNS)
			.map((pattern) => pattern.source)
			.join("|"),
	);
	const isAllowedExtensionOrigin = (origin: string | undefined): boolean =>
		!origin ||
		origin === appOrigin ||
		origin === "https://hutch-app.com" ||
		extensionOriginPattern.test(origin);

	const extensionCors = cors({
		origin: (origin, callback) => callback(null, isAllowedExtensionOrigin(origin)),
		methods: ["GET", "POST", "PUT", "DELETE"],
		allowedHeaders: ["Authorization", "Content-Type", "Accept", "Prefer"],
		maxAge: 86400,
	});

	/** The session-cookie bridge is the only extension endpoint that needs
	 * credentialed CORS: the extension POSTs with credentials:"include" so the
	 * browser stores the Set-Cookie hutch_sid. credentials:true (which also
	 * reflects the specific Origin instead of "*") stays scoped to this route
	 * rather than loosening the bearer-only endpoints. */
	const sessionBridgeCors = cors({
		origin: (origin, callback) => callback(null, isAllowedExtensionOrigin(origin)),
		methods: ["POST"],
		allowedHeaders: ["Authorization", "Content-Type"],
		credentials: true,
		maxAge: 86400,
	});

	/** Firefox extensions enforce CORS preflight for fetches with non-simple headers (Accept: application/vnd.siren+json, Authorization). Register OPTIONS so the preflight succeeds; without this it returns 404 and firefox aborts the fetch with NetworkError. */
	app.options("/", extensionCors);
	app.get("/", extensionCors, async (req: Request, res: Response) => {
		if (req.userId) {
			res.redirect(303, QUEUE_PATH);
			return;
		}
		if (wantsSiren(req) && !wantsMarkdown(req)) {
			res.redirect(303, QUEUE_PATH);
			return;
		}

		const browser = detectInstallBrowser(req);
		const userCount = await countUsers().catch(() => 0);
		const banner = await buildBannerState(req);
		// Gate the client A/B split redirect on humans: bots keep the canonical `/`
		// (control) instead of following a client redirect into a noindex arm.
		const abSplit = !isbot(req.get("user-agent"));
		sendComponent(
			req,
			res,
			Base(HomePage({ userCount, staticBaseUrl, browser, foundingAllocation, abSplit }), banner),
		);
	});

	app.get("/privacy", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(PrivacyPage(), await buildBannerState(req)));
	});

	app.get("/terms", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(TermsPage(), await buildBannerState(req)));
	});

	// Bare (HtmlPage, not Base) so the iOS Share-help sheet can render it in a
	// WKWebView without site chrome; public like /privacy. The current iOS client
	// holds this path client-side; the /queue collection still advertises it via the
	// add-links-help rel so older installed clients resolve the help URL from there.
	// Either way the copy ships via a hutch deploy rather than an App Store review.
	app.get("/help/add-links", (req: Request, res: Response) => {
		sendComponent(req, res, HelpAddLinksPage());
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
		 * Path-uniqued PDF fixture for the extension's pdf-save-flow staging e2e.
		 * The `:id` segment is ignored — bytes are
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

	// A/B landing arms for the homepage split (`/landing-a`, `/landing-b`),
	// reached by the client-side redirect from `/`. Same guest render as `/`.
	app.use(
		initLandingRoutes({ buildBannerState, countUsers, foundingAllocation, staticBaseUrl }),
	);

	/** Same-origin dismissal endpoint for the site-wide changelog banner; served
	 * here on $default even when the close button is clicked on a /blog page. */
	app.use(initChangelogDismissRoute({ secureCookies }));

	/** Every account-creation path (password, trial, checkout, Google) funnels
	 * its user creation through these two deps, so wrapping them here provisions
	 * exactly one forwarding address per new account at the single composition
	 * seam. Best-effort: a failure is logged for alerting but never blocks
	 * signup — the inbox page's "Create Inbox Email" CTA is the recovery path. */
	const provisionInboxAddressOnSignup = async (userId: UserId): Promise<void> => {
		try {
			await deps.inboxAddressStore.createAddress({
				userId,
				domain: deps.inboxAddressDomain,
				name: DEFAULT_INBOX_ALIAS,
			});
		} catch (error) {
			deps.logError(
				"[Inbox] Failed to provision a forwarding address at signup",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	};
	const createUserWithPasswordHash: CreateUserWithPasswordHash = async (input) => {
		const result = await deps.createUserWithPasswordHash(input);
		if (result.ok) await provisionInboxAddressOnSignup(result.userId);
		return result;
	};
	const createGoogleUser: CreateGoogleUser = async (input) => {
		const result = await deps.createGoogleUser(input);
		if (result.ok) await provisionInboxAddressOnSignup(result.userId);
		return result;
	};
	const createAppleUser: CreateAppleUser = async (input) => {
		const result = await deps.createAppleUser(input);
		if (result.ok) await provisionInboxAddressOnSignup(result.userId);
		return result;
	};

	const featureToggle = new QuerystringFeatureToggle();

	const authRouter = initAuthRoutes({
		hashPassword: deps.hashPassword,
		createUserWithPasswordHash,
		findUserByEmail: deps.findUserByEmail,
		verifyCredentials: deps.verifyCredentials,
		validateAccessToken: deps.validateAccessToken,
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
			loginAccount: deps.rateLimitRules.loginAccount,
			signup: deps.rateLimitRules.signup,
		},
		appleEnabled: Boolean(deps.appleAuth),
	});
	app.use("/auth/session", sessionBridgeCors);
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
			createGoogleUser,
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
			appleEnabled: Boolean(deps.appleAuth),
		});
		app.use(googleAuthRouter);
	}

	if (deps.appleAuth) {
		const appleAuthRouter = initAppleAuthRoutes({
			appleClientId: deps.appleAuth.clientId,
			stateSigningSecret: deps.appleAuth.stateSigningSecret,
			appOrigin,
			baseUrl: deps.baseUrl,
			staticBaseUrl,
			secureCookies,
			createSession: deps.createSession,
			createAppleUser,
			findUserByEmail: deps.findUserByEmail,
			countUsers,
			markEmailVerified: deps.markEmailVerified,
			exchangeAppleCode: deps.appleAuth.exchangeAppleCode,
			upsertTrialing: deps.subscriptionProviders.upsertTrialing,
			createTrialEndSchedule: deps.trialScheduler.createTrialEndSchedule,
			sendEmail: deps.sendEmail,
			logError: deps.logError,
			now: deps.now,
			conversionLogger: deps.conversionLogger,
			foundingAllocation,
		});
		app.use(appleAuthRouter);
	}

	const forgotPasswordRouter = initForgotPasswordRoutes({
		sendEmail: deps.sendEmail,
		userExistsByEmail: deps.userExistsByEmail,
		findUserByEmail: deps.findUserByEmail,
		updatePassword: deps.updatePassword,
		destroyUserSessions: deps.destroyUserSessions,
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

	const queueRouter = initQueueRoutes({
		validateSaveableUrl: deps.validateSaveableUrl,
		appOrigin,
		findArticlesByUser: deps.findArticlesByUser,
		countArticlesByUser: deps.countArticlesByUser,
		findArticleById: deps.findArticleById,
		findArticleByUrl: deps.findArticleByUrl,
		findArticleFreshness: deps.findArticleFreshness,
		findArticleUrlById: deps.findArticleUrlById,
		saveArticle: deps.saveArticle,
		deleteArticle: deps.deleteArticle,
		updateArticleStatus: deps.updateArticleStatus,
		markArticleViewed: deps.markArticleViewed,
		markSummaryToggled: deps.markSummaryToggled,
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
		regularReader: RegularReader,
		chromelessReader: ChromelessReader,
		httpErrorMessageMapping: deps.httpErrorMessageMapping,
		getIosAppSignals: deps.getIosAppSignals,
		recordIosAnyActivity: deps.recordIosAnyActivity,
		recordIosSavedArticle: deps.recordIosSavedArticle,
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
		requireNotLocked,
		requireWriteAccess,
		consumeRateLimit: deps.consumeRateLimit,
		importRateLimit: deps.rateLimitRules.import,
		importFromUrlRateLimit: deps.rateLimitRules.importFromUrl,
	});
	/** Public on purpose: a logged-out visitor can upload, review, and toggle a
	 * selection before being asked to sign up. Auth is enforced only at commit
	 * (the sole content-creating route), where `redirectAnonymousToSignup` and the
	 * `requireNotLocked`/`requireWriteAccess` gates run as route middleware. */
	app.use("/import", importRouter);

	const saveRouter = initSaveRoutes({ buildBannerState, analytics: deps.analytics, salt: deps.salt, now: deps.now, secureCookies, generatePendingSaveId: randomUUID });
	app.use("/save", saveRouter);

	const viewRouter = initViewRoutes({
		validateSaveableUrl: deps.validateSaveableUrl,
		appOrigin,
		findArticleByUrl: deps.findArticleByUrl,
		findArticleFreshness: deps.findArticleFreshness,
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
		findArticleFreshness: deps.findArticleFreshness,
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

	const inboxRouter = initInboxRoutes({
		featureToggle,
		inboxAddressStore: deps.inboxAddressStore,
		inboxEmailStore: deps.inboxEmailStore,
		inboxEmailLinkStore: deps.inboxEmailLinkStore,
		readEmailContent: deps.readEmailContent,
		inboxAddressDomain: deps.inboxAddressDomain,
		logError: deps.logError,
		buildBannerState,
		requireNotLocked,
		requireWriteAccess,
		now: deps.now,
	});
	app.use("/inbox", requireAuth, inboxRouter);

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
		listCards: deps.paymentMethods.listCards,
		beginAddCard: deps.paymentMethods.beginAddCard,
		removeCard: deps.paymentMethods.removeCard,
		setPrimaryCard: deps.paymentMethods.setPrimaryCard,
		stripePublishableKey: deps.stripePublishableKey,
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
		findClient: deps.findOAuthClient,
		validateRedirectUri: deps.validateOAuthRedirectUri,
		registerClient: deps.registerOAuthClient,
		destroyUserSessions: deps.destroyUserSessions,
		consumeRateLimit: deps.consumeRateLimit,
		registerRateLimitRule: deps.rateLimitRules.oauthRegister,
		tokenRateLimitRule: deps.rateLimitRules.oauthToken,
	});
	app.use("/oauth/token", extensionCors);
	app.use("/oauth/revoke", extensionCors);
	app.use("/oauth", oauthRouter);

	app.use(async (req: Request, res: Response) => {
		sendComponent(req, res, Base(NotFoundPage(), await buildBannerState(req)));
	});

	return app;
}
