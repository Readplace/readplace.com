import { noExtract, noRecovery, noTransform, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";
import { type CrawlFetch, PROXIED_CRAWL_HEADERS_MILLISECONDS } from "./crawl-fetch";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { readBodyWithCap } from "./read-capped-body";

type GalleyViewer = { viewer: URL; prefix: string; articleId: string; galleyId: string };

function galleyViewer(url: string): GalleyViewer | undefined {
	if (!URL.canParse(url)) return undefined;
	const viewer = new URL(url);
	if (viewer.protocol !== "https:" && viewer.protocol !== "http:") return undefined;
	if (viewer.username !== "" || viewer.password !== "") return undefined;
	const match = /^(.*)\/article\/view\/(\d+)\/(\d+)$/.exec(viewer.pathname);
	if (match === null) return undefined;
	const [, prefix, articleId, galleyId] = match;
	return { viewer, prefix, articleId, galleyId };
}

function pdfGalleyTarget(params: GalleyViewer & { html: string }): string | undefined {
	const { document } = parseHTML(params.html);
	const generator = document.querySelector('meta[name="generator"]')?.getAttribute("content");
	if (!generator?.startsWith("Open Journal Systems")) return undefined;
	if (document.querySelector("#pdfCanvasContainer") === null) return undefined;
	const href = document.querySelector("a.download")?.getAttribute("href");
	if (typeof href !== "string" || !URL.canParse(href, params.viewer.href)) return undefined;
	const target = new URL(href, params.viewer);
	if (target.origin !== params.viewer.origin || target.search !== "" || target.hash !== "") return undefined;
	const download = /^(.*)\/article\/download\/(\d+)\/(\d+)(?:\/\d+)?$/.exec(target.pathname);
	if (download === null) return undefined;
	const [, prefix, articleId, galleyId] = download;
	if (prefix !== params.prefix || articleId !== params.articleId || galleyId !== params.galleyId) return undefined;
	return target.href;
}

export function initOjsGalleySiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	return {
		matches: ({ url }) => galleyViewer(url) !== undefined,
		onCrawl: async ({ url }) => {
			const viewer = galleyViewer(url);
			if (viewer === undefined) return { kind: "skip" };
			try {
				const response = await deps.crawlFetch(url, { budgetMs: PROXIED_CRAWL_HEADERS_MILLISECONDS });
				if (!response.ok) return { kind: "skip" };
				const html = (await readBodyWithCap(response, MAX_HTML_BYTES.bytes)).toString("utf8");
				const target = pdfGalleyTarget({ ...viewer, html });
				if (target === undefined) return { kind: "skip" };
				return { kind: "redirect", url: target };
			} catch (error) {
				deps.logError("[CrawlArticle] OJS galley viewer resolution failed", error instanceof Error ? error : undefined);
				return { kind: "skip" };
			}
		},
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
