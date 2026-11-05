import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Logger } from "@packages/logger";
import type { AuthenticatedUserId } from "@packages/domain/user";
import { viewerOf } from "@packages/viewer-identity";
import { ANALYTICS_EVENTS, INTERNAL_CLICK_MEDIUM, STREAMS } from "./events";
import type { AnalyticsEvent } from "./analytics-event.types";
import { classifyBrowser, classifyDeviceClass, classifyOsFamily } from "./user-agent";
import {
	extractMediumPostId,
	extractPageviewUtm,
	extractQueryString,
	extractReferrerHost,
	isEmailClick,
	isInternalClick,
	pageviewExperiments,
	pageviewSortOrders,
	shouldCountClick,
	shouldCountEmailClick,
	shouldLog,
} from "./countable-request";
import { hashIp } from "./build-events";

declare global {
	namespace Express {
		interface Request {
			userId?: AuthenticatedUserId;
		}
	}
}

export function createAnalyticsMiddleware(deps: {
	logger: Logger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
	isStaticAssetPath: (path: string) => boolean;
	ownHost: string;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		/** Capture the request path up front. A sub-router mount (e.g. blog-site's
		 * `/blog`) trims its prefix from req.url before the deferred `finish`
		 * handler runs, so reading req.path there would drop the mount prefix and
		 * misclassify the pageview (and defeat the `/blog/...` SKIP_PATHS). */
		const path = req.path;
		res.on("finish", () => {
			const userAgent = req.get("user-agent");
			if (isInternalClick(req) && shouldCountClick({ req, res, ownHost: deps.ownHost })) {
				deps.logger.info({
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.click,
					timestamp: deps.now().toISOString(),
					path,
					utm_source: extractQueryString(req, "utm_source"),
					utm_medium: INTERNAL_CLICK_MEDIUM,
					utm_content: extractQueryString(req, "utm_content"),
					utm_term: extractQueryString(req, "utm_term"),
					device_class: classifyDeviceClass(userAgent),
					browser: classifyBrowser(userAgent),
					os_family: classifyOsFamily(userAgent),
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					visitor_id: req.visitorId ?? null,
					is_authenticated: req.userId ? 1 : 0,
				});
			}
			if (isEmailClick(req) && shouldCountEmailClick({ req, res, ownHost: deps.ownHost })) {
				deps.logger.info({
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.emailClick,
					timestamp: deps.now().toISOString(),
					path,
					status_code: res.statusCode,
					utm_source: extractQueryString(req, "utm_source"),
					utm_campaign: extractQueryString(req, "utm_campaign"),
					utm_content: extractQueryString(req, "utm_content"),
					utm_term: extractQueryString(req, "utm_term"),
					device_class: classifyDeviceClass(userAgent),
					browser: classifyBrowser(userAgent),
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					visitor_id: req.visitorId ?? null,
					is_authenticated: req.userId ? 1 : 0,
					user_id: req.userId ?? null,
				});
			}
			if (
				!shouldLog({
					req,
					path,
					statusCode: res.statusCode,
					isStaticAssetPath: deps.isStaticAssetPath,
					ownHost: deps.ownHost,
				})
			)
				return;
			const exposure = pageviewExperiments.get(res);
			deps.logger.info({
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.pageview,
				timestamp: deps.now().toISOString(),
				path,
				...extractPageviewUtm(req),
				referrer_host: extractReferrerHost(req),
				medium_post_id: extractMediumPostId(req),
				experiment: exposure?.experiment,
				experiment_variant: exposure?.variant,
				sort_order: pageviewSortOrders.get(res),
				device_class: classifyDeviceClass(userAgent),
				browser: classifyBrowser(userAgent),
				os_family: classifyOsFamily(userAgent),
				visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
				visitor_id: req.visitorId ?? null,
				is_authenticated: req.userId ? 1 : 0,
			});
		});
		next();
	};
}
