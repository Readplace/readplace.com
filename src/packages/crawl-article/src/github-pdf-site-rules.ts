import { noExtract, noRecovery, noTransform, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";
import { z } from "zod";
import { type CrawlFetch, PROXIED_CRAWL_HEADERS_MILLISECONDS } from "./crawl-fetch";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { readBodyWithCap } from "./read-capped-body";

const embeddedDataSchema = z.object({
	payload: z.object({
		codeViewBlobLayoutRoute: z.object({
			path: z.string().min(1),
			refInfo: z.object({
				name: z.string().min(1),
				currentOid: z.string().regex(/^[a-f0-9]{40}$/),
				refType: z.enum(["branch", "tag"]),
			}),
			blob: z.object({ rawBlobUrl: z.string() }),
		}),
	}),
});

function isGitHubHttps(url: URL): boolean {
	return url.protocol === "https:" && url.hostname === "github.com" && url.username === "" && url.password === "" && url.port === "";
}

function pdfViewer(url: string): URL | undefined {
	if (!URL.canParse(url)) return undefined;
	const parsed = new URL(url);
	if (!isGitHubHttps(parsed)) return undefined;
	const raw = parsed.searchParams.get("raw");
	if (raw === "1" || raw === "true") return undefined;
	if (!/^\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/blob\/.+\.pdf$/i.test(parsed.pathname)) return undefined;
	return parsed;
}

function rawPdfTarget(params: { viewer: URL; html: string }): string | undefined {
	const { document } = parseHTML(params.html);
	const data = document.querySelector('script[type="application/json"][data-target="react-app.embeddedData"]');
	if (data === null) return undefined;
	const parsed = embeddedDataSchema.safeParse(JSON.parse(data.innerHTML));
	if (!parsed.success) return undefined;
	const { path, refInfo, blob } = parsed.data.payload.codeViewBlobLayoutRoute;
	const [, owner, repository] = params.viewer.pathname.split("/");
	const root = `/${owner}/${repository}`;
	const viewerPath = decodeURIComponent(params.viewer.pathname);
	const refs = [refInfo.name, refInfo.currentOid];
	if (!refs.some((ref) => viewerPath === `${root}/blob/${ref}/${path}`)) return undefined;
	if (!URL.canParse(blob.rawBlobUrl)) return undefined;
	const target = new URL(blob.rawBlobUrl);
	if (!isGitHubHttps(target) || target.search !== "" || target.hash !== "") return undefined;
	const rawPath = decodeURIComponent(target.pathname);
	const qualifiedRef = `refs/${refInfo.refType === "branch" ? "heads" : "tags"}/${refInfo.name}`;
	if (![...refs, qualifiedRef].some((ref) => rawPath === `${root}/raw/${ref}/${path}`)) return undefined;
	return target.href;
}

export function initGitHubPdfSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	return {
		matches: ({ url }) => pdfViewer(url) !== undefined,
		onCrawl: async ({ url }) => {
			const viewer = pdfViewer(url);
			if (viewer === undefined) return { kind: "skip" };
			try {
				const response = await deps.crawlFetch(url, { budgetMs: PROXIED_CRAWL_HEADERS_MILLISECONDS });
				if (!response.ok) return { kind: "failed" };
				const html = (await readBodyWithCap(response, MAX_HTML_BYTES.bytes)).toString("utf8");
				const target = rawPdfTarget({ viewer, html });
				if (target === undefined) return { kind: "failed" };
				return { kind: "redirect", url: target };
			} catch (error) {
				deps.logError("[CrawlArticle] GitHub PDF viewer resolution failed", error instanceof Error ? error : undefined);
				return { kind: "failed" };
			}
		},
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
