import { CUSTOM_EMAILS_PATH, INBOX_PATH } from "@packages/domain/inbox";
import { resolve } from "node:path";
import {
	createCrossSiteRequestMiddleware,
	createCspNonceMiddleware,
	generateCspNonce,
	sendContentSecurityPolicy,
} from "@packages/web-shell";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import type {
	InboxAddressStore,
	InboxEmailLinkStore,
	InboxEmailStore,
	InboxSavedLinkStore,
} from "@packages/domain/inbox";
import type { ContentProvider, HasHeldLinks, HasNewsletterLink } from "@packages/provider-contracts/article-store";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import type {
	FindUserById,
	MarkSessionEmailVerified,
} from "@packages/provider-contracts/auth";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import type { UserId } from "@packages/domain/user";
import type { SaveAttemptId, SaveProvenance, SaveTrigger } from "@packages/domain/article";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { ResolveLogin } from "@packages/web-session";
import type { Logger, LogError } from "@packages/logger";
import {
	type AnalyticsEvent,
	createAnalyticsMiddleware,
	createClickAttributionMiddleware,
	createVisitorIdMiddleware,
	utmValidationMiddleware,
} from "@packages/web-analytics";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { initGetEffectiveAccess } from "@packages/subscription-access";
import { initBuildBannerState } from "./web/banner-state";
import { requireAuth } from "./web/middleware/require-auth";
import { initRequireNotLocked } from "./web/middleware/require-not-locked.middleware";
import { initRequirePaidFeatures } from "./web/middleware/require-paid-features.middleware";
import { initResolveVerificationStatus } from "./web/middleware/resolve-verification-status.middleware";
import { initCustomEmailsRoutes } from "./web/pages/inbox/custom-emails.page";
import type { FindSavedTrackerDestination } from "./domain/inbox/find-saved-tracker-destination";
import { type InboxReadlistFitDependencies, initInboxRoutes } from "./web/pages/inbox/inbox.page";
import "./web/session.types";
import type { NewsletterLinksDependencies } from "./web/pages/newsletter-links/newsletter-links.page";
import { initNewsletterLinksRoutes } from "./web/pages/newsletter-links/newsletter-links.page";
import { NEWSLETTER_LINKS_PATH } from "./web/pages/newsletter-links/newsletter-links.url";

/** Where local dev prefers to listen. The dev server steps to the next free
 * port when something already holds this one, so two checkouts can both run. */
export const PORT = 3300;

/** Composition root for the inbox deployable: the /inbox pages behind hutch's
 * API Gateway. Env-free — the entry points read the environment and pass
 * everything in — so the whole app composes against in-memory fixtures in
 * tests. Login state is resolved from hutch's session cookie exactly as hutch
 * resolves it (same middleware order: cookies → login →
 * verification standing → the auth-gated router), so a reader moving between
 * hutch pages and these pages never sees a different standing. */
export function createInboxApp(
	config: { inboxAddressDomain: string; imagesCdnBaseUrl: string },
	deps: {
		resolveLogin: ResolveLogin;
		findUserById: FindUserById;
		markSessionEmailVerified: MarkSessionEmailVerified;
		findSubscriptionByUserId: FindSubscriptionByUserId;
		inboxAddressStore: InboxAddressStore;
		inboxEmailStore: InboxEmailStore;
		inboxEmailLinkStore: InboxEmailLinkStore;
		inboxSavedLinkStore: InboxSavedLinkStore;
		readEmailContent: ContentProvider;
		findSavedTrackerDestination: FindSavedTrackerDestination;
		publishSubmitLink: (input: {
			userId: UserId;
			url: string;
			provenance: SaveProvenance;
			readlist: ReadlistSlug;
			saveTrigger: SaveTrigger;
			saveAttemptId: SaveAttemptId;
		}) => Promise<void>;
		publishCrawlPreview: Parameters<typeof initInboxRoutes>[0]["publishCrawlPreview"];
		publishSavedLinkTriaged: Parameters<typeof initInboxRoutes>[0]["publishSavedLinkTriaged"];
		recordEngagementActivity: RecordEngagementActivity;
		logError: LogError;
		now: () => Date;
		analyticsLogger: Logger.Typed<AnalyticsEvent>;
		salt: string;
		generateVisitorId: () => string;
		secureCookies: boolean;
		ownHost: string;
		appOrigin: string;
		edgeSecret: string;
		hasNewsletterLink: HasNewsletterLink;
		hasHeldLinks: HasHeldLinks;
	} & InboxReadlistFitDependencies &
		Pick<
			NewsletterLinksDependencies,
			| "findSavedLinksJob"
			| "requestSavedLinksJob"
			| "withdrawSavedLinksJob"
			| "publishRunSavedLinksJob"
		>,
): Express {
	const app: Express = express();
	app.disable("x-powered-by");

	const isStaticAssetPath = () => false;
	const canonicalizeLandingPath = (path: string) => path;

	app.use(createViewerIdentityMiddleware({ edgeSecret: deps.edgeSecret }));
	app.use(createCspNonceMiddleware({ generateCspNonce }));
	app.use(sendContentSecurityPolicy);
	app.use(utmValidationMiddleware);
	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());
	app.use(createCrossSiteRequestMiddleware({ appOrigin: deps.appOrigin }));
	app.use(
		createVisitorIdMiddleware({
			generateVisitorId: deps.generateVisitorId,
			secure: deps.secureCookies,
			isStaticAssetPath,
		}),
	);
	app.use(
		createClickAttributionMiddleware({
			now: deps.now,
			secure: deps.secureCookies,
			isStaticAssetPath,
			canonicalizeLandingPath,
			ownHost: deps.ownHost,
		}),
	);
	app.use(
		createAnalyticsMiddleware({
			logger: deps.analyticsLogger,
			salt: deps.salt,
			now: deps.now,
			isStaticAssetPath,
			ownHost: deps.ownHost,
		}),
	);

	app.use("/client-dist", express.static(resolve(__dirname, "web", "client-dist")));

	app.use(async (req: Request, _res: Response, next: NextFunction) => {
		const login = await deps.resolveLogin(req.headers.cookie);
		if (login.isAuthenticated && !login.ageLocked) {
			req.userId = login.userId;
			req.emailVerified = login.emailVerified;
		}
		next();
	});

	app.use(
		initResolveVerificationStatus({
			findUserById: deps.findUserById,
			markSessionEmailVerified: deps.markSessionEmailVerified,
			now: deps.now,
		}),
	);

	const getEffectiveAccess = initGetEffectiveAccess({
		findSubscriptionByUserId: deps.findSubscriptionByUserId,
		now: deps.now,
	});
	const requirePaidFeatures = initRequirePaidFeatures({ getEffectiveAccess });
	const buildBannerState = initBuildBannerState({
		getEffectiveAccess,
		findUserById: deps.findUserById,
	});
	const requireNotLocked = initRequireNotLocked({ buildBannerState });
	const recordEngagementActivity: RecordEngagementActivity = async (input) => {
		try {
			await deps.recordEngagementActivity(input);
		} catch (error) {
			deps.logError("Failed to record engagement activity", error instanceof Error ? error : undefined);
		}
	};
	const inboxRouter = initInboxRoutes({
		inboxAddressStore: deps.inboxAddressStore,
		inboxEmailStore: deps.inboxEmailStore,
		inboxEmailLinkStore: deps.inboxEmailLinkStore,
		inboxSavedLinkStore: deps.inboxSavedLinkStore,
		readEmailContent: deps.readEmailContent,
		findSavedTrackerDestination: deps.findSavedTrackerDestination,
		publishSubmitLink: deps.publishSubmitLink,
		publishCrawlPreview: deps.publishCrawlPreview,
		publishSavedLinkTriaged: deps.publishSavedLinkTriaged,
		recordEngagementActivity,
		imagesCdnBaseUrl: config.imagesCdnBaseUrl,
		logError: deps.logError,
		buildBannerState,
		requireNotLocked,
		requirePaidFeatures,
		now: deps.now,
		findSavedArticleForLink: deps.findSavedArticleForLink,
		listReadlistFitOverrides: deps.listReadlistFitOverrides,
		recordReadlistFitOverride: deps.recordReadlistFitOverride,
		deleteReadlistFitOverride: deps.deleteReadlistFitOverride,
		deleteReadlistArticleByUrl: deps.deleteReadlistArticleByUrl,
		listUserSavesForUrl: deps.listUserSavesForUrl,
		publishLinkDequeued: deps.publishLinkDequeued,
		publishFileArticleIntoReadlist: deps.publishFileArticleIntoReadlist,
		hasNewsletterLink: deps.hasNewsletterLink,
		hasHeldLinks: deps.hasHeldLinks,
		findSavedLinksJob: deps.findSavedLinksJob,
		fitChoiceLog: deps.fitChoiceLog,
	});
	app.use(
		NEWSLETTER_LINKS_PATH,
		requireAuth,
		initNewsletterLinksRoutes({
			findSavedLinksJob: deps.findSavedLinksJob,
			requestSavedLinksJob: deps.requestSavedLinksJob,
			withdrawSavedLinksJob: deps.withdrawSavedLinksJob,
			publishRunSavedLinksJob: deps.publishRunSavedLinksJob,
			buildBannerState,
			requireNotLocked,
			requirePaidFeatures,
			now: deps.now,
		}),
	);
	app.use(INBOX_PATH, requireAuth, inboxRouter);
	const customEmailsRouter = initCustomEmailsRoutes({
		inboxAddressStore: deps.inboxAddressStore,
		inboxAddressDomain: config.inboxAddressDomain,
		logError: deps.logError,
		buildBannerState,
		requireNotLocked,
		requirePaidFeatures,
	});
	app.use(CUSTOM_EMAILS_PATH, requireAuth, customEmailsRouter);

	return app;
}
