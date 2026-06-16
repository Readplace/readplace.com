import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";

export interface BotBlockEvent {
	stream: "bot-block";
	event: "blocked";
	path: string;
	user_agent: string;
}

/**
 * Default User-Agent strings of common scripted HTTP clients. Each pattern must
 * be unambiguous — no plausible browser or legitimate crawler shares it.
 * Allow-listing legit crawlers is intentionally avoided: an unknown new crawler
 * (e.g. a future search engine) should pass through, not be silently blocked.
 */
const NAIVE_BOT_UA_PATTERNS: readonly RegExp[] = [
	/^curl\//i,
	/^libcurl\//i,
	/^Wget\//i,
	/^python-requests\//i,
	/^Python-urllib\//i,
	/^aiohttp\//i,
	/^Go-http-client\//i,
	/^Java\//i,
	/^okhttp\//i,
	/^Apache-HttpClient\//i,
	/^node-fetch\//i,
	/^axios\//i,
	/^Ruby\b/i,
	/^Faraday\b/i,
	/^PHP\//i,
	/^GuzzleHttp\//i,
	/^Scrapy\//i,
];

const BOT_BYPASS_PATHS: ReadonlySet<string> = new Set([
	"/robots.txt",
	"/sitemap.xml",
	"/llms.txt",
	"/llms-full.txt",
	"/favicon.ico",
	"/auth.md",
	"/.well-known/oauth-protected-resource",
	"/.well-known/oauth-authorization-server",
	"/.well-known/api-catalog",
]);

/** Machine-targeted discovery namespace: a skills validator or agent may fetch it with a scripted client. */
const BOT_BYPASS_NAMESPACE = "/.well-known/agent-skills/";

const MAX_LOGGED_UA_LENGTH = 200;

export function createBlockNaiveBotMiddleware(deps: {
	logger: HutchLogger.Typed<BotBlockEvent>;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		if (BOT_BYPASS_PATHS.has(req.path) || req.path.startsWith(BOT_BYPASS_NAMESPACE)) {
			next();
			return;
		}
		const ua = req.get("user-agent");
		if (!ua) {
			next();
			return;
		}
		if (NAIVE_BOT_UA_PATTERNS.some((pattern) => pattern.test(ua))) {
			deps.logger.info({
				stream: "bot-block",
				event: "blocked",
				path: req.path,
				user_agent: ua.slice(0, MAX_LOGGED_UA_LENGTH),
			});
			res.status(403).end();
			return;
		}
		next();
	};
}
