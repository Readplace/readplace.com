import { noExtract, noRecovery, noTransform, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";
import { type CrawlFetch, PROXIED_CRAWL_HEADERS_MILLISECONDS } from "./crawl-fetch";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { readBodyWithCap } from "./read-capped-body";

type OpenFileViewer = { viewer: URL; file: string };

function openFileViewer(url: string): OpenFileViewer | undefined {
	if (!URL.canParse(url)) return undefined;
	const viewer = new URL(url);
	if (viewer.protocol !== "https:" || viewer.hostname !== "investor.mercadolibre.com") return undefined;
	if (viewer.username !== "" || viewer.password !== "" || viewer.port !== "") return undefined;
	if (viewer.pathname !== "/open-file") return undefined;
	const files = viewer.searchParams.getAll("file");
	if (files.length !== 1 || files[0] === "") return undefined;
	return { viewer, file: files[0] };
}

function embeddedPdfTarget(params: OpenFileViewer & { html: string }): string | undefined {
	const { document } = parseHTML(params.html);
	const src = document.querySelector("iframe.open-file-page__viewer")?.getAttribute("src");
	if (typeof src !== "string" || !URL.canParse(src, params.viewer.href)) return undefined;
	const target = new URL(src, params.viewer);
	if (target.origin !== params.viewer.origin || target.pathname !== "/open-file/pdf" || target.hash !== "") return undefined;
	const keys = [...target.searchParams.keys()];
	if (keys.length !== 1 || keys[0] !== "file" || target.searchParams.get("file") !== params.file) return undefined;
	return target.href;
}

export function initMercadoLibreOpenFileSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	return {
		matches: ({ url }) => openFileViewer(url) !== undefined,
		onCrawl: async ({ url }) => {
			const viewer = openFileViewer(url);
			if (viewer === undefined) return { kind: "skip" };
			try {
				const response = await deps.crawlFetch(url, { budgetMs: PROXIED_CRAWL_HEADERS_MILLISECONDS });
				if (!response.ok) return { kind: "skip" };
				const html = (await readBodyWithCap(response, MAX_HTML_BYTES.bytes)).toString("utf8");
				const target = embeddedPdfTarget({ ...viewer, html });
				if (target === undefined) return { kind: "skip" };
				return { kind: "redirect", url: target };
			} catch (error) {
				deps.logError("[CrawlArticle] MercadoLibre open-file viewer resolution failed", error instanceof Error ? error : undefined);
				return { kind: "skip" };
			}
		},
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
