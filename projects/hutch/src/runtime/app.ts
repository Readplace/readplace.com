/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import { randomInt } from "node:crypto";
import type { Express } from "express";
import type { Logger } from "./domain/logger";
import { hashPassword } from "@packages/domain/user";
import { validateSaveableUrl } from "@packages/domain/article";
import { createApp } from "./server";
import { initProdProviders } from "./providers/prod-providers";
import { initChangelogBannerSource } from "./web/changelog-banner-source";
import { readplaceUnwrapPreprocessor } from "./web/pages/view/readplace-unwrap-preprocessor";
import { unwrappedPreProcessors, withUnwrapPreprocessing } from "./web/unwrap-preprocessors";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import type { SubscriptionLogEvent } from "./observability/subscription-events";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { httpErrorMessageMapping } from "./web/pages/queue/queue.error";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { initCachedUserCount } from "./web/auth/cached-user-count";
import { HutchLogger, consoleLogger, formatErrorLogLine } from "@packages/hutch-logger";
import { getEnv, requireEnv } from "@packages/require-env";

type AssemblyProvidedKeys =
	| "validateSaveableUrl"
	| "appOrigin"
	| "staticBaseUrl"
	| "hashPassword"
	| "adminEmails"
	| "recrawlServiceToken"
	| "baseUrl"
	| "logError"
	| "httpErrorMessageMapping"
	| "getChangelogBanner"
	| "now"
	| "drawRandomByte"
	| "botDefenseLogger"
	| "conversionLogger"
	| "subscriptionLogger"
	| "analytics"
	| "salt"
	| "foundingAllocation";
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
	const analyticsLogger = HutchLogger.fromJSON<AnalyticsEvent>();

	// Decorative, cached, fail-open source for the site-wide changelog banner.
	// Points at blog-site's fragment endpoint via hutch's own API Gateway (set in
	// infra); a slow or down source never blocks a page render.
	const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
		fetch: globalThis.fetch,
		sourceUrl: requireEnv("CHANGELOG_BANNER_URL"),
		now: () => Date.now(),
		ttlMs: 300_000,
		timeoutMs: 800,
		logger: HutchLogger.from(consoleLogger),
	});
	void refreshChangelogBanner();

	const app = createApp({
		validateSaveableUrl: withUnwrapPreprocessing(
			validateSaveableUrl,
			unwrappedPreProcessors(readplaceUnwrapPreprocessor),
			{ selfHost: new URL(appOrigin).host },
		),
		appOrigin,
		staticBaseUrl,
		hashPassword,
		...providers,
		countUsers: initCachedUserCount({ countUsers: providers.countUsers, now: () => Date.now(), ttlMs: 60_000 }),
		adminEmails,
		recrawlServiceToken,
		baseUrl: appOrigin,
		logError: (message, error) =>
			HutchLogger.from(consoleLogger).error(
				formatErrorLogLine({ message, error, now: () => new Date() }),
			),
		httpErrorMessageMapping,
		getChangelogBanner,
		now: () => new Date(),
		drawRandomByte: () => randomInt(256),
		botDefenseLogger: HutchLogger.fromJSON<BotDefenseEvent>(),
		conversionLogger: HutchLogger.fromJSON<ConversionEvent>(),
		subscriptionLogger: HutchLogger.fromJSON<SubscriptionLogEvent>(),
		analytics: analyticsLogger,
		salt,
		foundingAllocation: initFoundingAllocation({ foundingMemberLimit }),
	});

	return { app, analyticsLogger };
}

export function createReadplaceApp() {
	return assembleReadplaceApp({ appOrigin: requireEnv("APP_ORIGIN"), initProviders: initProdProviders });
}

export const localServer = (expressApp: Express, logger: Logger): void => {
	const port = getEnv("PORT") || "3000";
	expressApp.listen(Number.parseInt(port, 10)).on("listening", () => {
		logger.info(`Local server running on http://localhost:${port}`);
	});
};
/* c8 ignore stop */
