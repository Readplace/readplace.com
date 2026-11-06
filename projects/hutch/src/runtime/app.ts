/* c8 ignore start -- composition root, no logic to test */
import { GUEST_UPLOAD_KINDS } from "./web/pages/upload/upload-review.page";
import assert from "node:assert";
import { randomInt } from "node:crypto";
import type { Express } from "express";
import { KEEP_OFFER_ENDS_AT } from "./domain/engagement/keep-offer";
import type { WebLogger } from "./domain/logger";
import { hashPassword } from "@packages/domain/user";
import { validateSaveableUrl } from "@packages/domain/article";
import { createApp } from "./server";
import { initProdProviders } from "./providers/prod-providers";
import { initFetchFirefoxDownloadUrl } from "./web/pages/install";
import { readplaceUnwrapPreprocessor } from "./web/pages/view/readplace-unwrap-preprocessor";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "./web/shared/article-body/reader-slot/section-pages";
import { unwrappedPreProcessors, withUnwrapPreprocessing } from "./web/unwrap-preprocessors";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import type { SubscriptionLogEvent } from "./observability/subscription-events";
import type { ActivationThresholdReachedEvent } from "./domain/engagement/funnel-events";
import type { LifecycleEmailSentEvent } from "./observability/lifecycle-email-events";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { httpErrorMessageMapping } from "./web/pages/readlist/readlist.error";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { initCachedUserCount } from "./web/auth/cached-user-count";
import { readNewsletterCatalogSeed } from "./domain/newsletter-catalog/newsletter-catalog-seed";
import { Logger, consoleLogger, formatErrorLogLine } from "@packages/logger";
import { getEnv, requireEnv } from "@packages/require-env";

type AssemblyProvidedKeys =
	| "validateSaveableUrl"
	| "appOrigin"
	| "readerSectionThresholdBytes"
	| "staticBaseUrl"
	| "hashPassword"
	| "fetchFirefoxDownloadUrl"
	| "adminEmails"
	| "recrawlServiceToken"
	| "baseUrl"
	| "logError"
	| "httpErrorMessageMapping"
	| "now"
	| "drawRandomByte"
	| "botDefenseLogger"
	| "conversionLogger"
	| "subscriptionLogger"
	| "funnelLogger"
	| "analytics"
	| "authDiagnosticsLogger"
	| "salt"
	| "keepOfferCouponId"
	| "keepOfferEndsAt"
	| "guestUploadKinds"
	| "foundingAllocation"
	| "newsletterCatalogSeed";
export type ReadplaceProviders = Omit<Parameters<typeof createApp>[0], AssemblyProvidedKeys>;

function parseAdminEmails(raw: string): readonly string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function assembleReadplaceApp(input: {
	appOrigin: string;
	initProviders: (deps: { appOrigin: string }) => ReadplaceProviders;
}) {
	const { appOrigin } = input;
	const providers = input.initProviders({ appOrigin });
	const staticBaseUrl = requireEnv("STATIC_BASE_URL");
	const foundingMemberLimit = Number.parseInt(requireEnv("FOUNDING_MEMBER_LIMIT"), 10);
	assert(
		Number.isInteger(foundingMemberLimit) && foundingMemberLimit > 0,
		"FOUNDING_MEMBER_LIMIT must be a positive integer",
	);
	const adminEmails = parseAdminEmails(requireEnv("ADMIN_EMAILS"));
	const recrawlServiceToken = requireEnv("RECRAWL_SERVICE_TOKEN");
	const salt = requireEnv("ANALYTICS_SALT");
	const analyticsLogger = Logger.fromJSON<AnalyticsEvent>();

	const keepOfferCouponId = requireEnv("STRIPE_KEEP_OFFER_COUPON_ID");

	const app = createApp({
		keepOfferCouponId,
		keepOfferEndsAt: KEEP_OFFER_ENDS_AT,
		guestUploadKinds: GUEST_UPLOAD_KINDS,
		validateSaveableUrl: withUnwrapPreprocessing(
			validateSaveableUrl,
			unwrappedPreProcessors(readplaceUnwrapPreprocessor),
			{ selfHost: new URL(appOrigin).host },
		),
		appOrigin,
		readerSectionThresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES,
		staticBaseUrl,
		hashPassword,
		fetchFirefoxDownloadUrl: initFetchFirefoxDownloadUrl({ fetch }),
		...providers,
		countUsers: initCachedUserCount({ countUsers: providers.countUsers, now: () => Date.now(), ttlMs: 60_000 }),
		adminEmails,
		recrawlServiceToken,
		baseUrl: appOrigin,
		logError: (message, error) =>
			Logger.from(consoleLogger).error(
				formatErrorLogLine({ message, error, now: () => new Date() }),
			),
		httpErrorMessageMapping,
		now: () => new Date(),
		drawRandomByte: () => randomInt(256),
		botDefenseLogger: Logger.fromJSON<BotDefenseEvent>(),
		conversionLogger: Logger.fromJSON<ConversionEvent>(),
		subscriptionLogger: Logger.fromJSON<SubscriptionLogEvent>(),
		funnelLogger: Logger.fromJSON<ActivationThresholdReachedEvent | LifecycleEmailSentEvent>(),
		analytics: analyticsLogger,
		authDiagnosticsLogger: Logger.fromJSON<Record<string, unknown>>(),
		salt,
		foundingAllocation: initFoundingAllocation({ foundingMemberLimit }),
		newsletterCatalogSeed: readNewsletterCatalogSeed(),
	});

	return { app, analyticsLogger };
}

export function createReadplaceApp() {
	return assembleReadplaceApp({ appOrigin: requireEnv("APP_ORIGIN"), initProviders: initProdProviders });
}

export const localServer = (expressApp: Express, logger: WebLogger): void => {
	const port = getEnv("PORT") || "3000";
	expressApp.listen(Number.parseInt(port, 10)).on("listening", () => {
		logger.info(`Local server running on http://localhost:${port}`);
	});
};
/* c8 ignore stop */
