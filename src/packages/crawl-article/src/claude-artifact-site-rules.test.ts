import { initClaudeArtifactSiteRules } from "./claude-artifact-site-rules";
import type { CrawlFetch, CrawlFetchInit } from "./crawl-fetch";
import { MAX_HTML_BYTES } from "./html-body-limit";

const ARTIFACT = "https://claude.ai/artifact/InventedArtifactId123";
const FRAME_HOST = "00000000-0000-4000-8000-000000000000.frame.claudeusercontent.com";
const LATEST = `https://${FRAME_HOST}/_f/latest/`;
const VERSION = `https://${FRAME_HOST}/_f/invented-version/`;
const FRAME_HTML = "<!DOCTYPE html><html><head><title>Invented artifact</title></head><body><article><p>The invented artifact body.</p></article></body></html>";

function shellHtml(host: string): string {
	return `<!DOCTYPE html><html><head><title>Claude Artifact</title></head><body><div id="frame-slot" data-frame-uchost="${host}"></div><p>Page not found</p></body></html>`;
}

type FrameAnswer = { status: number; body?: string | Uint8Array; contentType?: string; hops?: readonly string[] };

type Recorded = { url: string; init: CrawlFetchInit };

function fakeFetch(params: { shell: { status: number; body: string }; frame?: FrameAnswer; requests?: Recorded[] }): CrawlFetch {
	return async (url, init) => {
		params.requests?.push({ url, init });
		if (url === ARTIFACT) return new Response(params.shell.body, { status: params.shell.status, headers: { "content-type": "text/html" } });
		const frame = params.frame ?? { status: 200, body: FRAME_HTML, contentType: "text/html; charset=utf-8", hops: [VERSION] };
		let from = url;
		for (const toUrl of frame.hops ?? []) {
			init.onRedirect?.({ fromUrl: from, toUrl });
			from = toUrl;
		}
		const headers = new Headers();
		if (frame.contentType !== undefined) headers.set("content-type", frame.contentType);
		return new Response(frame.body ?? null, { status: frame.status, headers });
	};
}

function siteWith(params: { shell?: { status: number; body: string }; frame?: FrameAnswer; requests?: Recorded[] }) {
	return initClaudeArtifactSiteRules({
		crawlFetch: fakeFetch({ shell: params.shell ?? { status: 200, body: shellHtml(FRAME_HOST) }, frame: params.frame, requests: params.requests }),
		logError: () => {},
	});
}

describe("Claude artifact site rules", () => {
	it.each([
		[ARTIFACT, true],
		[`${ARTIFACT}?utm_source=newsletter`, true],
		["https://claude.ai/artifact/Invented-Artifact_Id123", true],
		["http://claude.ai/artifact/InventedArtifactId123", false],
		["https://user:pw@claude.ai/artifact/InventedArtifactId123", false],
		["https://claude.ai:8443/artifact/InventedArtifactId123", false],
		["https://www.claude.ai/artifact/InventedArtifactId123", false],
		["https://claude.ai/artifact/", false],
		["https://claude.ai/artifact/InventedArtifactId123/", false],
		["https://claude.ai/artifact/InventedArtifactId123/edit", false],
		["https://claude.ai/share/InventedArtifactId123", false],
		["https://claude.ai/public/artifacts/InventedArtifactId123", false],
		["invalid", false],
	])("claims only a claude.ai artifact page: %s", (url, expected) => {
		expect(siteWith({}).matches({ url, hostname: "claude.ai" })).toBe(expected);
	});

	it("returns the frame document fetched from the shell's frame host", async () => {
		const requests: Recorded[] = [];
		expect(await siteWith({ requests }).onCrawl({ url: ARTIFACT })).toEqual({ kind: "content", html: FRAME_HTML });
		expect(requests.map((request) => request.url)).toEqual([ARTIFACT, LATEST]);
	});

	it("asks the frame host for the document as an iframe", async () => {
		const requests: Recorded[] = [];
		await siteWith({ requests }).onCrawl({ url: ARTIFACT });
		expect(requests[0]?.init.headers).toBeUndefined();
		expect(requests[1]?.init.headers).toEqual({ "sec-fetch-dest": "iframe" });
	});

	it("returns a frame document served without a redirect", async () => {
		const frame = { status: 200, body: FRAME_HTML, contentType: "text/html", hops: [] };
		expect(await siteWith({ frame }).onCrawl({ url: ARTIFACT })).toEqual({ kind: "content", html: FRAME_HTML });
	});

	it("declines a non-artifact URL when called directly", async () => {
		const requests: Recorded[] = [];
		expect(await siteWith({ requests }).onCrawl({ url: "https://claude.ai/share/InventedArtifactId123" })).toEqual({ kind: "skip" });
		expect(requests).toEqual([]);
	});

	it.each([403, 404, 500])("declines when the shell answers %i", async (status) => {
		const requests: Recorded[] = [];
		expect(await siteWith({ shell: { status, body: shellHtml(FRAME_HOST) }, requests }).onCrawl({ url: ARTIFACT })).toEqual({ kind: "skip" });
		expect(requests).toHaveLength(1);
	});

	it.each([
		"",
		"claude.ai",
		"00000000-0000-4000-8000-000000000000.frame.claudeusercontent.com.example.net",
		"00000000-0000-4000-8000-00000000000A.frame.claudeusercontent.com",
		"x00000000-0000-4000-8000-000000000000.frame.claudeusercontent.com",
		"00000000-0000-4000-8000-000000000000.claudeusercontent.com",
		"https://00000000-0000-4000-8000-000000000000.frame.claudeusercontent.com",
	])("declines a shell whose frame host is not a frame host: '%s'", async (host) => {
		const requests: Recorded[] = [];
		expect(await siteWith({ shell: { status: 200, body: shellHtml(host) }, requests }).onCrawl({ url: ARTIFACT })).toEqual({ kind: "skip" });
		expect(requests).toHaveLength(1);
	});

	it.each([
		"<html><body><p>Page not found</p></body></html>",
		`<html><body><div id="frame-slot"></div></body></html>`,
		`<html><body><div class="frame-slot" data-frame-uchost="${FRAME_HOST}"></div></body></html>`,
	])("declines a shell without a frame slot host", async (body) => {
		expect(await siteWith({ shell: { status: 200, body } }).onCrawl({ url: ARTIFACT })).toEqual({ kind: "skip" });
	});

	it.each([
		{ name: "a 403", frame: { status: 403, body: FRAME_HTML, contentType: "text/html", hops: [VERSION] } },
		{ name: "a 404", frame: { status: 404, body: FRAME_HTML, contentType: "text/html", hops: [VERSION] } },
		{ name: "a JSON body", frame: { status: 200, body: "{}", contentType: "application/json", hops: [VERSION] } },
		{ name: "an XHTML-looking type", frame: { status: 200, body: FRAME_HTML, contentType: "text/htmlx", hops: [VERSION] } },
		{ name: "no content type", frame: { status: 200, body: new TextEncoder().encode(FRAME_HTML), hops: [VERSION] } },
		{ name: "two redirects", frame: { status: 200, body: FRAME_HTML, contentType: "text/html", hops: [VERSION, `${VERSION}again/`] } },
		{ name: "a redirect to claude.ai", frame: { status: 200, body: FRAME_HTML, contentType: "text/html", hops: [ARTIFACT] } },
		{ name: "a redirect to another frame host", frame: { status: 200, body: FRAME_HTML, contentType: "text/html", hops: ["https://11111111-1111-4111-8111-111111111111.frame.claudeusercontent.com/_f/invented-version/"] } },
		{ name: "a plain-HTTP redirect", frame: { status: 200, body: FRAME_HTML, contentType: "text/html", hops: [`http://${FRAME_HOST}/_f/invented-version/`] } },
	])("declines a frame answer with $name", async ({ frame }) => {
		expect(await siteWith({ frame }).onCrawl({ url: ARTIFACT })).toEqual({ kind: "skip" });
	});

	it("declines without logging a frame document over the HTML byte cap", async () => {
		const logError = jest.fn();
		const frame = { status: 200, body: "a".repeat(MAX_HTML_BYTES.bytes + 1), contentType: "text/html", hops: [VERSION] };
		const site = initClaudeArtifactSiteRules({ crawlFetch: fakeFetch({ shell: { status: 200, body: shellHtml(FRAME_HOST) }, frame }), logError });
		expect(await site.onCrawl({ url: ARTIFACT })).toEqual({ kind: "skip" });
		expect(logError).not.toHaveBeenCalled();
	});

	it.each([new Error("network failure"), "network failure"])("logs and declines on a fetch error", async (error) => {
		const logError = jest.fn();
		const site = initClaudeArtifactSiteRules({ crawlFetch: async () => { throw error; }, logError });
		expect(await site.onCrawl({ url: ARTIFACT })).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] Claude artifact frame fetch failed", error instanceof Error ? error : undefined);
	});
});
