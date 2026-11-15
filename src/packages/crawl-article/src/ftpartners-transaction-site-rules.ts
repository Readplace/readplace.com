import { noExtract, noRecovery, noTransform, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";
import { type CrawlFetch, PROXIED_CRAWL_HEADERS_MILLISECONDS } from "./crawl-fetch";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { readBodyWithCap } from "./read-capped-body";

const PREVIEW_DECLARATION = "adobeDCView.previewFile(";
const DECLARED_LOCATION = /^\s*\{\s*content\s*:\s*\{\s*location\s*:\s*\{\s*url\s*:\s*"([^"]*)"/;

function isTransactionLanding(url: string): boolean {
	if (!URL.canParse(url)) return false;
	const landing = new URL(url);
	if (landing.protocol !== "https:" && landing.protocol !== "http:") return false;
	if (landing.hostname !== "ftpartners.com" || landing.username !== "" || landing.password !== "") return false;
	return /^\/transactions\/[^/]+\/?$/.test(landing.pathname);
}

function declaredDocument(params: { landing: URL; html: string }): string | undefined {
	const { document } = parseHTML(params.html);
	const declarations: string[] = [];
	for (const script of document.querySelectorAll("script")) {
		declarations.push(...String(script.textContent).split(PREVIEW_DECLARATION).slice(1));
	}
	if (declarations.length !== 1) return undefined;
	const location = DECLARED_LOCATION.exec(declarations[0]);
	if (location === null || !URL.canParse(location[1], params.landing.href)) return undefined;
	const target = new URL(location[1], params.landing);
	if (target.origin !== params.landing.origin || target.username !== "" || target.password !== "" || target.search !== "" || target.hash !== "") return undefined;
	if (!target.pathname.endsWith(".pdf")) return undefined;
	return target.href;
}

export function initFtPartnersTransactionSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	return {
		matches: ({ url }) => isTransactionLanding(url),
		onCrawl: async ({ url }) => {
			if (!isTransactionLanding(url)) return { kind: "skip" };
			try {
				const response = await deps.crawlFetch(url, { budgetMs: PROXIED_CRAWL_HEADERS_MILLISECONDS });
				if (!response.ok) return { kind: "skip" };
				const html = (await readBodyWithCap(response, MAX_HTML_BYTES.bytes)).toString("utf8");
				const target = declaredDocument({ landing: new URL(response.url), html });
				if (target === undefined) return { kind: "skip" };
				return { kind: "redirect", url: target };
			} catch (error) {
				deps.logError("[CrawlArticle] FT Partners transaction resolution failed", error instanceof Error ? error : undefined);
				return { kind: "skip" };
			}
		},
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
