import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import type {
	InboxAddressStore,
	InboxEmailLinkStore,
	InboxEmailStore,
} from "@packages/domain/inbox";
import type { ContentProvider } from "@packages/provider-contracts/article-store";
import type {
	FindUserById,
	MarkSessionEmailVerified,
} from "@packages/provider-contracts/auth";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import type { ResolveLogin } from "@packages/web-session";
import { QuerystringFeatureToggle } from "@packages/web-shell";
import { initGetEffectiveAccess } from "@packages/subscription-access";
import { initBuildBannerState } from "./web/banner-state";
import type { GetChangelogBanner } from "./web/changelog-banner-source";
import { changelogDismissMiddleware } from "./web/changelog-dismiss.middleware";
import { requireAuth } from "./web/middleware/require-auth";
import { requireNotLocked } from "./web/middleware/require-not-locked.middleware";
import { initRequireWriteAccess } from "./web/middleware/require-write-access.middleware";
import { initResolveVerificationStatus } from "./web/middleware/resolve-verification-status.middleware";
import { initInboxRoutes } from "./web/pages/inbox/inbox.page";
import "./web/session.types";

export const PORT = 3300;

/** Composition root for the inbox deployable: the /inbox pages behind hutch's
 * API Gateway. Env-free — the entry points read the environment and pass
 * everything in — so the whole app composes against in-memory fixtures in
 * tests. Login state is resolved from hutch's session cookie exactly as hutch
 * resolves it (same middleware order: cookies → changelog dismissal → login →
 * verification standing → the auth-gated router), so a reader moving between
 * hutch pages and these pages never sees a different standing. */
export function createInboxApp(
	config: { inboxAddressDomain: string },
	deps: {
		resolveLogin: ResolveLogin;
		findUserById: FindUserById;
		markSessionEmailVerified: MarkSessionEmailVerified;
		findSubscriptionByUserId: FindSubscriptionByUserId;
		getChangelogBanner: GetChangelogBanner;
		inboxAddressStore: InboxAddressStore;
		inboxEmailStore: InboxEmailStore;
		inboxEmailLinkStore: InboxEmailLinkStore;
		readEmailContent: ContentProvider;
		logError: (message: string, error?: Error) => void;
		now: () => Date;
	},
): Express {
	const app: Express = express();
	app.disable("x-powered-by");

	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());
	app.use(changelogDismissMiddleware);

	app.use(async (req: Request, _res: Response, next: NextFunction) => {
		const login = await deps.resolveLogin(req.headers.cookie);
		if (login.isAuthenticated) {
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
	const requireWriteAccess = initRequireWriteAccess({
		findSubscriptionByUserId: deps.findSubscriptionByUserId,
		now: deps.now,
	});
	const buildBannerState = initBuildBannerState({
		getEffectiveAccess,
		getChangelogBanner: deps.getChangelogBanner,
		now: deps.now,
	});
	const featureToggle = new QuerystringFeatureToggle();

	const inboxRouter = initInboxRoutes({
		featureToggle,
		inboxAddressStore: deps.inboxAddressStore,
		inboxEmailStore: deps.inboxEmailStore,
		inboxEmailLinkStore: deps.inboxEmailLinkStore,
		readEmailContent: deps.readEmailContent,
		inboxAddressDomain: config.inboxAddressDomain,
		logError: deps.logError,
		buildBannerState,
		requireNotLocked,
		requireWriteAccess,
		now: deps.now,
	});
	app.use("/inbox", requireAuth, inboxRouter);

	return app;
}
