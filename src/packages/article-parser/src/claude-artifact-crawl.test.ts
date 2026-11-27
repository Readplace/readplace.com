import { initCrawlArticle, rejectDocumentLandingPage, type CrawlFetch } from "@packages/crawl-article";
import { initArticleSiteRules } from "./article-site-rules";

const ARTIFACT = "https://claude.ai/artifact/InventedArtifactId123";
const FRAME_HOST = "00000000-0000-4000-8000-000000000000.frame.claudeusercontent.com";
const LATEST = `https://${FRAME_HOST}/_f/latest/`;
const VERSION = `https://${FRAME_HOST}/_f/invented-version/`;
const SHELL = `<!DOCTYPE html><html><head><title>Claude Artifact</title></head><body><div id="frame-slot" data-frame-uchost="${FRAME_HOST}"></div><p>Page not found</p></body></html>`;
const FRAME = "<!DOCTYPE html><html><head><title>Invented artifact</title></head><body><article><h1>Invented artifact</h1><p>The invented artifact body the frame host serves.</p></article></body></html>";

function initCrawl(crawlFetch: CrawlFetch) {
	const { siteRules } = initArticleSiteRules({ crawlFetch, logError: () => {} });
	return initCrawlArticle({
		rejectDocumentLandingPage,
		crawlFetch,
		siteRules,
		logError: () => {},
		logInfo: () => {},
		logThumbnailNotDelivered: () => {},
	});
}

function artifactFetch(requested: string[], frameStatus: number): CrawlFetch {
	return async (target, init) => {
		requested.push(target);
		if (target === LATEST) {
			init.onRedirect?.({ fromUrl: LATEST, toUrl: VERSION });
			return new Response(FRAME, { status: frameStatus, headers: { "content-type": "text/html; charset=utf-8" } });
		}
		return new Response(SHELL, { status: 200, headers: { "content-type": "text/html" } });
	};
}

it("crawls the frame document a claude.ai artifact shell names", async () => {
	const requested: string[] = [];
	const crawl = initCrawl(artifactFetch(requested, 200));

	expect(await crawl({ chargeOcrPages: undefined, url: ARTIFACT })).toMatchObject({ status: "fetched", html: FRAME });
	expect(requested).toEqual([ARTIFACT, LATEST]);
});

it("falls back to the ordinary crawl of the shell when the frame host refuses", async () => {
	const requested: string[] = [];
	const crawl = initCrawl(artifactFetch(requested, 403));

	expect(await crawl({ chargeOcrPages: undefined, url: ARTIFACT })).toMatchObject({ status: "fetched", html: SHELL });
	expect(requested).toEqual([ARTIFACT, LATEST, ARTIFACT]);
});
