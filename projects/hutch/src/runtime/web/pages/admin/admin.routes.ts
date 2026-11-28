import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import {
	ADMIN_MFA_PATH,
	initRefuseAdminAccess,
	initRequireAdmin,
	type SecondFactorPolicy,
	serviceTokenPolicy,
} from "@packages/admin-gate";
import { CANARY_REPORTS_PATH } from "@packages/provider-contracts/canary-report";
import { withSyntacticUnwrap } from "@packages/save-article";
import type { AppDependencies } from "../../../server";
import { initUpdateNewsletterCatalog } from "../../../domain/newsletter-catalog/update-newsletter-catalog";
import type { EmitLifecycleEmailSent } from "../../../observability/lifecycle-email-events";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import { initAdminIndexHandler } from "./admin-index.page";
import { ADMIN_INDEX_STYLES } from "./admin-index.styles";
import { initAdminNewslettersRoutes } from "./admin-newsletters.page";
import { initAdminCanaryReportRoutes } from "./canary-report.page";
import { initAdminExtendTrialRoutes } from "./extend-trial.page";
import { initAdminFounderNotesRoutes } from "./founder-notes.page";
import { initAdminRecrawlRoutes } from "./recrawl.page";
import { initAdminMfaRoutes } from "./admin-mfa.page";

function noStore(_req: Request, res: Response, next: NextFunction): void {
	res.setHeader("Cache-Control", "no-store");
	next();
}

export function initAdminRoutes(
	deps: Pick<
		AppDependencies,
		| "findArticleByUrl"
		| "findItemOwner"
		| "resolveCanonicalIdentity"
		| "resolveWrapperTarget"
		| "findArticleFreshness"
		| "findArticleCrawlVersions"
		| "readArticleContent"
		| "findGeneratedSummary"
		| "findArticleCrawlStatus"
		| "forceMarkCrawlPending"
		| "publishRecrawlLinkInitiated"
		| "findUserByEmail"
		| "subscriptionProviders"
		| "trialScheduler"
		| "logError"
		| "now"
		| "readNewsletterCatalog"
		| "writeNewsletterCatalog"
		| "newsletterCatalogSeed"
		| "findCanaryReport"
		| "adminEmails"
		| "readAdminTotpSecrets"
		| "adminMfaAttemptRule"
		| "markSessionAdminMfaVerified"
		| "findSessionAdminMfaVerifiedAt"
		| "consumeRateLimit"
		| "recrawlServiceToken"
		| "readerSectionThresholdBytes"
	>,
	built: { appOrigin: string; buildBannerState: BuildBannerState; emitLifecycleEmailSent: EmitLifecycleEmailSent },
): Router {
	const { appOrigin, buildBannerState, emitLifecycleEmailSent } = built;
	const router = express.Router();
	const refuse = initRefuseAdminAccess({ base: Base, bannerStateFor: buildBannerState, styles: ADMIN_INDEX_STYLES });
	const secondFactor: SecondFactorPolicy = {
		kind: "enforced",
		findSessionAdminMfaVerifiedAt: deps.findSessionAdminMfaVerifiedAt,
		now: deps.now,
	};
	const withServiceToken = initRequireAdmin({
		findUserByEmail: deps.findUserByEmail,
		adminEmails: deps.adminEmails,
		serviceToken: serviceTokenPolicy(deps.recrawlServiceToken),
		secondFactor,
		refuse,
	});
	const sessionOnly = initRequireAdmin({
		findUserByEmail: deps.findUserByEmail,
		adminEmails: deps.adminEmails,
		serviceToken: { kind: "refused" },
		secondFactor,
		refuse,
	});
	const challengeOnly = initRequireAdmin({
		findUserByEmail: deps.findUserByEmail,
		adminEmails: deps.adminEmails,
		serviceToken: { kind: "refused" },
		secondFactor: { kind: "being-challenged" },
		refuse,
	});

	router.use(
		ADMIN_MFA_PATH,
		noStore,
		challengeOnly,
		initAdminMfaRoutes({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			readAdminTotpSecrets: deps.readAdminTotpSecrets,
			markSessionAdminMfaVerified: deps.markSessionAdminMfaVerified,
			consumeRateLimit: deps.consumeRateLimit,
			attemptRule: deps.adminMfaAttemptRule,
			now: deps.now,
			buildBannerState,
		}),
	);

	const adminRecrawlRouter = initAdminRecrawlRoutes({
		appOrigin,
		findArticleByUrl: deps.findArticleByUrl,
		findItemOwner: deps.findItemOwner,
		resolveCanonicalIdentity: deps.resolveCanonicalIdentity,
		resolveWrapperTarget: withSyntacticUnwrap(deps.resolveWrapperTarget),
		findArticleFreshness: deps.findArticleFreshness,
		findArticleCrawlVersions: deps.findArticleCrawlVersions,
		readArticleContent: deps.readArticleContent,
		findGeneratedSummary: deps.findGeneratedSummary,
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		forceMarkCrawlPending: deps.forceMarkCrawlPending,
		publishRecrawlLinkInitiated: deps.publishRecrawlLinkInitiated,
		buildBannerState,
		now: deps.now,
		readerSectionThresholdBytes: deps.readerSectionThresholdBytes,
	});
	router.use("/admin/recrawl", noStore, withServiceToken, adminRecrawlRouter);

	const adminExtendTrialRouter = initAdminExtendTrialRoutes({
		findUserByEmail: deps.findUserByEmail,
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		upsertTrialing: deps.subscriptionProviders.upsertTrialing,
		trialScheduler: deps.trialScheduler,
		logError: deps.logError,
		now: deps.now,
		buildBannerState,
	});
	router.use("/admin/extend-trial", noStore, sessionOnly, adminExtendTrialRouter);

	router.use(
		"/admin/founder-notes",
		noStore,
		sessionOnly,
		initAdminFounderNotesRoutes({
			findUserByEmail: deps.findUserByEmail,
			findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
			recordFounderNote: deps.subscriptionProviders.recordFounderNote,
			emitLifecycleEmailSent,
			now: deps.now,
			buildBannerState,
		}),
	);

	router.use(
		"/admin/newsletters",
		noStore,
		sessionOnly,
		initAdminNewslettersRoutes({
			readNewsletterCatalog: deps.readNewsletterCatalog,
			updateNewsletterCatalog: initUpdateNewsletterCatalog({
				readCatalog: deps.readNewsletterCatalog,
				writeCatalog: deps.writeNewsletterCatalog,
				maxAttempts: 3,
			}),
			newsletterCatalogSeed: deps.newsletterCatalogSeed,
			now: deps.now,
			logError: deps.logError,
			buildBannerState,
		}),
	);
	router.use(
		CANARY_REPORTS_PATH,
		noStore,
		sessionOnly,
		initAdminCanaryReportRoutes({
			findCanaryReport: deps.findCanaryReport,
			buildBannerState,
		}),
	);
	router.get("/admin", noStore, sessionOnly, initAdminIndexHandler({ buildBannerState }));

	return router;
}
