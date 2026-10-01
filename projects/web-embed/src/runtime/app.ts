import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { RenderBase } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	type AnalyticsEvent,
	createAnalyticsMiddleware,
	createClickAttributionMiddleware,
	createVisitorIdMiddleware,
	utmValidationMiddleware,
} from "@packages/web-analytics";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { initEmbedRoutes } from "./embed/embed.page";

export function createEmbedApp(deps: {
	appOrigin: string;
	base: RenderBase;
	resolveLogin: ResolveLogin;
	analyticsLogger: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
	generateVisitorId: () => string;
	secureCookies: boolean;
	ownHost: string;
	edgeSecret: string;
}): Express {
	const app = express();
	app.disable("x-powered-by");

	const isStaticAssetPath = () => false;
	const canonicalizeLandingPath = (path: string) => path;

	app.use(createViewerIdentityMiddleware({ edgeSecret: deps.edgeSecret }));
	app.use(utmValidationMiddleware);
	app.use(cookieParser());
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

	app.use(
		"/embed",
		initEmbedRoutes({ appOrigin: deps.appOrigin, base: deps.base, resolveLogin: deps.resolveLogin }),
	);

	return app;
}
