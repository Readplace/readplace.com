import { noExtract, noRecovery, noTransform, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";
import { type CrawlFetch, PROXIED_CRAWL_HEADERS_MILLISECONDS } from "./crawl-fetch";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { readBodyWithCap } from "./read-capped-body";

function documentLanding(url: string): { landing: URL; publicationId: string } | undefined {
	if (!URL.canParse(url)) return undefined;
	const landing = new URL(url);
	if (landing.protocol !== "https:" && landing.protocol !== "http:") return undefined;
	if (landing.hostname !== "www.gallup.com" || landing.username !== "" || landing.password !== "") return undefined;
	const match = /^\/analytics\/(\d+)\/[^/]+\.aspx$/.exec(landing.pathname);
	if (match === null) return undefined;
	return { landing, publicationId: match[1] };
}

function declaredDocument(params: { landing: URL; publicationId: string; html: string }): string | undefined {
	const { document } = parseHTML(params.html);
	const content = document.querySelectorAll("main.sa-document article.o-article .article-content");
	if (content.length !== 1) return undefined;
	const declarations = content[0].querySelectorAll("a.gel-icon-document-pdf-solid");
	const targets = new Set<string>();
	for (const declaration of declarations) {
		const href = declaration.getAttribute("href");
		if (href === null || !URL.canParse(href, params.landing.href)) return undefined;
		const target = new URL(href, params.landing);
		if (target.origin !== params.landing.origin || target.username !== "" || target.password !== "" || target.search !== "" || target.hash !== "") return undefined;
		const download = /^\/file\/analytics\/(\d+)\/[^/]+\.pdf$/.exec(target.pathname);
		if (download === null || download[1] !== params.publicationId) return undefined;
		targets.add(target.href);
	}
	if (targets.size !== 1) return undefined;
	return targets.values().next().value;
}

export function initGallupDocumentSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	return {
		matches: ({ url }) => documentLanding(url) !== undefined,
		onCrawl: async ({ url }) => {
			const landing = documentLanding(url);
			if (landing === undefined) return { kind: "skip" };
			try {
				const response = await deps.crawlFetch(url, { budgetMs: PROXIED_CRAWL_HEADERS_MILLISECONDS });
				if (!response.ok) return { kind: "skip" };
				const html = (await readBodyWithCap(response, MAX_HTML_BYTES.bytes)).toString("utf8");
				const target = declaredDocument({ ...landing, html });
				if (target === undefined) return { kind: "skip" };
				return { kind: "redirect", url: target };
			} catch (error) {
				deps.logError("[CrawlArticle] Gallup document resolution failed", error instanceof Error ? error : undefined);
				return { kind: "skip" };
			}
		},
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
