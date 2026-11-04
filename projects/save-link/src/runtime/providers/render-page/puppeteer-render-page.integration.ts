import assert from "node:assert/strict";
import { createServer, request as forwardRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import chromium from "@sparticuz/chromium";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { classifyRenderedDocument } from "./classify-rendered-document";
import { initProxiedRenderRequestFilter } from "./proxied-render-request-filter";
import { initPuppeteerRenderPage } from "./puppeteer-render-page";
import type { RenderOutcome, RenderProxy } from "./render-page.types";
import { type CreateRenderRequestFilter, initRenderRequestFilter, type RejectRenderRequest } from "./render-request-filter";

const PROXY_USERNAME = "render-zone-user";
const PROXY_PASSWORD = "render-zone-secret";
const ARTICLE_MARKER = "The harbour authority voted on Tuesday to keep the night ferry running through the winter timetable.";
const HYDRATED_MARKER = "Councillors said the late crossing carries more shift workers than any other service on the route.";
const CROSS_SITE_MARKER = "A review of the timetable returns to the authority in March with passenger counts for each sailing.";
const FILLER = "Ferry passengers queued at the terminal while the harbour master read the revised sailing notice aloud. ".repeat(4);
const TEST_ONLY_SKIPPED_TYPES = new Set(["image", "media", "font"]);

const testOnlyLoopbackAllowed: RejectRenderRequest = async ({ resourceType }) => (TEST_ONLY_SKIPPED_TYPES.has(resourceType) ? "type" : undefined);

function listen(server: Server): Promise<number> {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			assert(address !== null && typeof address === "object", "a listening server has an address");
			resolve((address satisfies AddressInfo).port);
		});
	});
}

function close(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.closeAllConnections();
		server.close(() => resolve());
	});
}

function articleOrigin(crossSiteOrigin: () => string) {
	const pages: Record<string, { type: string; body: () => string }> = {
		"/story": {
			type: "text/html",
			body: () => `<!doctype html>
<html>
<head>
	<title>Night ferry kept</title>
	<link rel="stylesheet" href="/hide-until-hydrated.css">
	<script src="/hydrate.js"></script>
	<script src="${crossSiteOrigin()}/widget.js"></script>
</head>
<body>
	<article class="story">
		<h1>Night ferry kept</h1>
		<p>${ARTICLE_MARKER}</p>
		<p>${FILLER}</p>
	</article>
	<script>
		window.addEventListener("load", () => {
			document.documentElement.dataset.articleDisplay = getComputedStyle(document.querySelector(".story")).display;
		});
	</script>
</body>
</html>`,
		},
		"/hide-until-hydrated.css": { type: "text/css", body: () => ".story { display: none; }" },
		"/hydrate.js": {
			type: "application/javascript",
			body: () => `fetch("/api/story.json").then((response) => response.json()).then(({ paragraph }) => {
	const p = document.createElement("p");
	p.textContent = paragraph;
	document.querySelector(".story").appendChild(p);
});`,
		},
		"/api/story.json": { type: "application/json", body: () => JSON.stringify({ paragraph: HYDRATED_MARKER }) },
	};
	return (request: IncomingMessage, response: ServerResponse) => {
		const path = new URL(request.url ?? "/", "http://origin.invalid").pathname;
		if (path === "/short") {
			response.writeHead(302, { location: "/story" }).end();
			return;
		}
		const page = pages[path];
		if (page === undefined) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": page.type }).end(page.body());
	};
}

function crossSiteOriginHandler(_request: IncomingMessage, response: ServerResponse) {
	response.writeHead(200, { "content-type": "application/javascript" }).end(`document.addEventListener("DOMContentLoaded", () => {
	const p = document.createElement("p");
	p.textContent = ${JSON.stringify(CROSS_SITE_MARKER)};
	document.querySelector(".story").appendChild(p);
});`);
}

function recordingProxy(proxied: string[]) {
	const expectedAuthorization = `Basic ${Buffer.from(`${PROXY_USERNAME}:${PROXY_PASSWORD}`).toString("base64")}`;
	return (request: IncomingMessage, response: ServerResponse) => {
		if (request.headers["proxy-authorization"] !== expectedAuthorization) {
			response.writeHead(407, { "proxy-authenticate": 'Basic realm="render-zone"' }).end();
			return;
		}
		const target = new URL(request.url ?? "");
		proxied.push(`${target.host}${target.pathname}`);
		const { "proxy-authorization": _credential, ...headers } = request.headers;
		const upstream = forwardRequest(target, { method: request.method, headers }, (answer) => {
			response.writeHead(answer.statusCode ?? 502, answer.headers);
			answer.pipe(response);
		});
		upstream.on("error", () => response.writeHead(502).end());
		request.pipe(upstream);
	};
}

const parser = initReadabilityParser({
	crawlArticle: async () => ({ status: "failed", reason: "the integration test parses rendered HTML only" }),
	siteRules: [],
	readabilityAdditions,
	logError: () => undefined,
});

function extractedText(outcome: RenderOutcome, url: string): string {
	assert.equal(outcome.kind, "rendered");
	assert(outcome.kind === "rendered");
	const parsed = parser.parseHtml({ url, documentUrl: outcome.finalUrl, html: outcome.html, thumbnailUrl: null });
	assert(parsed.ok, "the rendered page yields a readable article");
	return parsed.article.content;
}

function articleDisplay(outcome: RenderOutcome): string | undefined {
	assert(outcome.kind === "rendered");
	return /data-article-display="([^"]+)"/.exec(outcome.html)?.[1];
}

const packagedChromeAvailable = process.platform === "linux";

describe("puppeteer render page through a Web Unlocker proxy", { skip: packagedChromeAvailable ? false : "the packaged @sparticuz/chromium binary runs on Linux only" }, () => {
	const proxied: string[] = [];
	const articleServer = createServer();
	const crossSiteServer = createServer(crossSiteOriginHandler);
	const proxyServer = createServer(recordingProxy(proxied));
	let articlePort = 0;
	let crossSitePort = 0;
	let proxy: RenderProxy;

	before(async () => {
		articleServer.on("request", articleOrigin(() => `http://localhost:${crossSitePort}`));
		articlePort = await listen(articleServer);
		crossSitePort = await listen(crossSiteServer);
		proxy = { server: `http://127.0.0.1:${await listen(proxyServer)}`, username: PROXY_USERNAME, password: PROXY_PASSWORD };
	});

	after(async () => {
		await Promise.all([close(articleServer), close(crossSiteServer), close(proxyServer)]);
	});

	const renderThrough = async (createRenderRequestFilter: CreateRenderRequestFilter) => {
		proxied.length = 0;
		const renderPage = initPuppeteerRenderPage({
			executablePath: () => chromium.executablePath(),
			launchArgs: [...chromium.args.filter((arg) => arg !== "--disable-web-security"), "--proxy-bypass-list=<-loopback>"],
			headless: "shell",
			createRenderRequestFilter,
			classifyRenderedDocument,
		});
		const url = `http://127.0.0.1:${articlePort}/short`;
		const outcome = await renderPage({ url, egress: { kind: "web-unlocker", proxy }, navigationTimeoutMilliseconds: 30_000 });
		return { outcome, url, proxiedRequests: [...proxied] };
	};

	const legacy = initRenderRequestFilter({ rejectRenderRequest: testOnlyLoopbackAllowed, maxResourceHostBuckets: 100 });
	const sameSiteScripts = (proxiedRequestLimit: number) =>
		initProxiedRenderRequestFilter({
			rejectRenderRequest: testOnlyLoopbackAllowed,
			proxiedRequestLimit,
			maxResourceHostBuckets: 100,
			directRenderRequestFilter: legacy,
		});

	it("loads the stylesheet that hides the article and the cross-site widget under the legacy policy", async () => {
		const { outcome, url, proxiedRequests } = await renderThrough(legacy);

		assert.equal(articleDisplay(outcome), "none");
		assert.deepEqual([...proxiedRequests].sort(), [
			`127.0.0.1:${articlePort}/api/story.json`,
			`127.0.0.1:${articlePort}/hide-until-hydrated.css`,
			`127.0.0.1:${articlePort}/hydrate.js`,
			`127.0.0.1:${articlePort}/short`,
			`127.0.0.1:${articlePort}/story`,
			`localhost:${crossSitePort}/widget.js`,
		]);
		const text = extractedText(outcome, url);
		assert(text.includes(ARTICLE_MARKER) && text.includes(HYDRATED_MARKER) && text.includes(CROSS_SITE_MARKER), "every marker survives the legacy render");
		assert.equal(outcome.requests.policy, "legacy");
	});

	it("blocks the stylesheet and the cross-site widget, follows the redirect, and keeps the same-site hydrated text under same-site-scripts", async () => {
		const { outcome, url, proxiedRequests } = await renderThrough(sameSiteScripts(12));

		assert.equal(articleDisplay(outcome), "block");
		assert.deepEqual([...proxiedRequests].sort(), [
			`127.0.0.1:${articlePort}/api/story.json`,
			`127.0.0.1:${articlePort}/hydrate.js`,
			`127.0.0.1:${articlePort}/short`,
			`127.0.0.1:${articlePort}/story`,
		]);
		const text = extractedText(outcome, url);
		assert(text.includes(ARTICLE_MARKER) && text.includes(HYDRATED_MARKER), "the server-rendered and same-site hydrated markers survive");
		assert.equal(text.includes(CROSS_SITE_MARKER), false, "the article loses text only a cross-site script inserted");
		assert.equal(outcome.requests.policy, "same-site-scripts");
		assert.equal(outcome.requests.continuedProxied, 4);
		assert.equal(outcome.requests.continuedNavigations, 2);
		assert.equal(outcome.requests.abortedBy.type, 1);
		assert.equal(outcome.requests.abortedBy.site, 1);
		assert.deepEqual(
			outcome.resourceHosts.buckets.find(({ route }) => route === "aborted-site"),
			{ documentSite: "127.0.0.1", requestHost: "localhost", resourceType: "script", navigation: false, route: "aborted-site", requests: 1, response2xx: 0, responseOther: 0, failed: 0 },
		);
		assert(outcome.resourceHosts.buckets.filter(({ route }) => route === "proxy").every(({ requests, response2xx, responseOther }) => requests === response2xx + responseOther), "every proxied request settles with a response");
	});

	it("stops at the proxied request cap with the redirect chain counted against it", async () => {
		const { outcome, proxiedRequests } = await renderThrough(sameSiteScripts(2));

		assert.deepEqual([...proxiedRequests].sort(), [`127.0.0.1:${articlePort}/short`, `127.0.0.1:${articlePort}/story`]);
		assert.equal(outcome.requests.continuedProxied, 2);
		assert.equal(outcome.requests.abortedByBudget, 1);
	});
});
