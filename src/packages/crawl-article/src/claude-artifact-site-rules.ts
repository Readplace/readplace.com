import { noExtract, noRecovery, noTransform, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";
import { type CrawlFetch, PROXIED_CRAWL_HEADERS_MILLISECONDS } from "./crawl-fetch";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { BodyTooLargeError, readBodyWithCap } from "./read-capped-body";

const ARTIFACT_PATH = /^\/artifact\/[A-Za-z0-9_-]+$/;
const FRAME_HOST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.frame\.claudeusercontent\.com$/;

function isArtifactPage(url: string): boolean {
	if (!URL.canParse(url)) return false;
	const page = new URL(url);
	if (page.protocol !== "https:" || page.hostname !== "claude.ai") return false;
	if (page.username !== "" || page.password !== "" || page.port !== "") return false;
	return ARTIFACT_PATH.test(page.pathname);
}

function frameHost(shellHtml: string): string | undefined {
	const { document } = parseHTML(shellHtml);
	const host = document.querySelector("#frame-slot")?.getAttribute("data-frame-uchost");
	if (typeof host !== "string" || !FRAME_HOST.test(host)) return undefined;
	return host;
}

function staysOnFrameHost(params: { hops: readonly string[]; host: string }): boolean {
	if (params.hops.length > 1) return false;
	return params.hops.every((hop) => {
		const target = new URL(hop);
		return target.protocol === "https:" && target.host === params.host;
	});
}

function isHtml(response: Response): boolean {
	return /^text\/html\s*(;|$)/i.test(response.headers.get("content-type") ?? "");
}

export function initClaudeArtifactSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	return {
		matches: ({ url }) => isArtifactPage(url),
		onCrawl: async ({ url }) => {
			if (!isArtifactPage(url)) return { kind: "skip" };
			try {
				const shell = await deps.crawlFetch(url, { budgetMs: PROXIED_CRAWL_HEADERS_MILLISECONDS });
				if (shell.status !== 200) return { kind: "skip" };
				const host = frameHost((await readBodyWithCap(shell, MAX_HTML_BYTES.bytes)).toString("utf8"));
				if (host === undefined) return { kind: "skip" };
				const hops: string[] = [];
				const frame = await deps.crawlFetch(`https://${host}/_f/latest/`, {
					budgetMs: PROXIED_CRAWL_HEADERS_MILLISECONDS,
					headers: { "sec-fetch-dest": "iframe" },
					onRedirect: ({ toUrl }) => hops.push(toUrl),
				});
				if (!staysOnFrameHost({ hops, host }) || frame.status !== 200 || !isHtml(frame)) return { kind: "skip" };
				const html = (await readBodyWithCap(frame, MAX_HTML_BYTES.bytes)).toString("utf8");
				return { kind: "content", html };
			} catch (error) {
				if (error instanceof BodyTooLargeError) return { kind: "skip" };
				deps.logError("[CrawlArticle] Claude artifact frame fetch failed", error instanceof Error ? error : undefined);
				return { kind: "skip" };
			}
		},
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
