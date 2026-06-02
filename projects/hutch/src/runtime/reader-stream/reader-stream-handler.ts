import type { HutchLogger } from "@packages/hutch-logger";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
} from "@packages/test-fixtures/providers/article-crawl";

/**
 * Server-Sent Events handler that streams partial-content snapshots from
 * the article-crawl row to the parent-side reader client.
 *
 * Loop: every `pollIntervalMs` (250ms in prod), read the crawl state from
 * DynamoDB. When the partial-content version has advanced, emit the *delta*
 * (bytes past `fromLength`) as an `event: chunk` frame. When the row
 * transitions terminal (ready / failed / unsupported), emit `event: done`
 * and close. A `connectionMaxMs` cap (60s in prod) forces a periodic
 * reconnect — defends against stuck connections.
 *
 * The handler is partial-application shaped so the entry point's
 * `streamifyResponse` wiring stays a one-liner and unit tests can drive
 * the loop deterministically without touching `awslambda`.
 */

export interface ReaderStreamRequest {
	/** Raw query string from the Function URL invocation
	 * (`?url=https%3A%2F%2F...&from=42`). The handler parses + validates. */
	queryString: string;
	/** The Cookie header from the request, used to extract the session
	 * cookie for authentication. May be undefined for anonymous requests. */
	cookieHeader: string | undefined;
}

export interface ReaderStreamResponse {
	/** Write a single SSE frame (caller chunks `event: type\ndata: …\n\n`
	 * exactly as the client expects). */
	write: (frame: string) => void;
	/** End the response and close the underlying socket. */
	end: () => void;
	/** Set response headers (called once before the first `write`). */
	setHeaders: (headers: Record<string, string>) => void;
}

export interface ReaderStreamHandlerDeps {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	/** Used to authenticate the request via the session cookie. Returns
	 * `null` for anonymous (no session, expired session, malformed
	 * cookie). Anonymous requests are still allowed — `/view` is a public
	 * page and the streaming reader should work for non-logged-in users
	 * the same way the HTML poll does. Shape matches the production
	 * provider so the composition root can pass it directly. */
	getSessionUserId: (
		sessionId: string,
	) => Promise<{ userId: string; emailVerified: boolean } | null>;
	logger: HutchLogger;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	/** Polling interval between DynamoDB reads. 250 in prod gives a
	 * tight feedback loop without hammering DDB. */
	pollIntervalMs: number;
	/** Maximum lifetime of a single SSE connection. 60s in prod —
	 * forces clients to reconnect with `?from=<length>` to defend
	 * against stuck connections that consume Lambda concurrency. */
	connectionMaxMs: number;
}

const SESSION_COOKIE_NAME = "hutch_sid";

export function initReaderStreamHandler(deps: ReaderStreamHandlerDeps) {
	return async (
		request: ReaderStreamRequest,
		response: ReaderStreamResponse,
	): Promise<void> => {
		const parsed = parseRequest(request);
		if (parsed.kind === "invalid") {
			response.setHeaders({
				"content-type": "text/plain",
				"cache-control": "no-store",
			});
			response.write(`bad request: ${parsed.reason}`);
			response.end();
			return;
		}

		// Authenticate. Anonymous is allowed for public /view pages, so a
		// missing or invalid cookie isn't a 401 — we just don't carry a user
		// identity into the loop. The findArticleCrawlStatus provider doesn't
		// need it today; this surface stays here so per-user gating can be
		// added later without re-plumbing.
		const sessionId = extractSessionCookie(request.cookieHeader);
		if (sessionId) {
			await deps.getSessionUserId(sessionId).catch((error) => {
				deps.logger.debug("[reader-stream] session lookup failed", {
					error: String(error),
				});
				return null;
			});
		}

		response.setHeaders({
			"content-type": "text/event-stream",
			"cache-control": "no-store",
			"x-accel-buffering": "no",
		});

		const { url, fromLength } = parsed;
		const startedAtMs = deps.now();
		let lastVersion = -1;
		let lastEmittedLength = fromLength;

		while (deps.now() - startedAtMs < deps.connectionMaxMs) {
			let crawl: ArticleCrawl | undefined;
			try {
				crawl = await deps.findArticleCrawlStatus(url);
			} catch (error) {
				deps.logger.warn("[reader-stream] findArticleCrawlStatus failed", {
					url,
					error: String(error),
				});
				await deps.sleep(deps.pollIntervalMs);
				continue;
			}

			const terminal = isTerminal(crawl);
			if (terminal) {
				response.write(`event: done\ndata: ${terminal}\n\n`);
				response.end();
				return;
			}

			if (
				crawl?.status === "pending" &&
				crawl.partial &&
				crawl.partial.version > lastVersion &&
				crawl.partial.content.length > lastEmittedLength
			) {
				const delta = crawl.partial.content.slice(lastEmittedLength);
				lastVersion = crawl.partial.version;
				lastEmittedLength = crawl.partial.content.length;
				response.write(`event: chunk\ndata: ${JSON.stringify(delta)}\n\n`);
			}

			await deps.sleep(deps.pollIntervalMs);
		}
		// Time cap reached without a terminal — emit a heartbeat-shaped
		// close so the client can reconnect with the right `from` offset.
		response.write(`event: reconnect\ndata: ${lastEmittedLength}\n\n`);
		response.end();
	};
}

interface ValidRequest {
	kind: "valid";
	url: string;
	fromLength: number;
}

interface InvalidRequest {
	kind: "invalid";
	reason: string;
}

export function parseRequest(request: ReaderStreamRequest): ValidRequest | InvalidRequest {
	const params = new URLSearchParams(request.queryString);
	const url = params.get("url");
	if (!url) return { kind: "invalid", reason: "missing 'url' query param" };
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return { kind: "invalid", reason: "url must be http(s)" };
		}
	} catch {
		return { kind: "invalid", reason: "url is not parseable" };
	}
	const fromRaw = params.get("from");
	const fromLength = fromRaw === null ? 0 : Number(fromRaw);
	if (!Number.isFinite(fromLength) || fromLength < 0) {
		return { kind: "invalid", reason: "'from' must be a non-negative integer" };
	}
	return { kind: "valid", url, fromLength };
}

export function extractSessionCookie(cookieHeader: string | undefined): string | undefined {
	if (!cookieHeader) return undefined;
	const pairs = cookieHeader.split(/;\s*/);
	for (const pair of pairs) {
		const eq = pair.indexOf("=");
		if (eq < 0) continue;
		const name = pair.slice(0, eq).trim();
		if (name !== SESSION_COOKIE_NAME) continue;
		const value = pair.slice(eq + 1).trim();
		return value.length > 0 ? value : undefined;
	}
	return undefined;
}

function isTerminal(crawl: ArticleCrawl | undefined): string | undefined {
	if (!crawl) return undefined;
	if (crawl.status === "ready") return "ready";
	if (crawl.status === "failed") return "failed";
	if (crawl.status === "unsupported") return "unsupported";
	return undefined;
}
