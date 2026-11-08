import { initCrawlFetch } from "./crawl-fetch";
import { createCurlFetch, type ExecCurl } from "./curl-fetch";
import { redirectable } from "./follow-redirects";

it.each([
	{ h2Directory: "/archive/", curlRedirect: undefined },
	{ h2Directory: "/archive/docs/", curlRedirect: undefined },
	{ h2Directory: "/archive/docs/", curlRedirect: "/different-document" },
])("recovers the document after mixed blocked and landing-page responses: %j", async ({ h2Directory, curlRedirect }) => {
	const pdf = "https://publisher.example/archive/docs/report.pdf";
	const firstLandingPage = "https://publisher.example/archive/";
	const laterUrl = curlRedirect === undefined ? undefined : new URL(curlRedirect, pdf).href;
	const proxyTargets: string[] = [];
	const redirects: string[] = [];
	let primaryCalls = 0;
	let curlCalls = 0;
	const fetch: typeof globalThis.fetch = async (input) => {
		const url = String(input);
		primaryCalls += 1;
		if (primaryCalls === 1) return new Response(null, { status: 302, headers: { location: firstLandingPage } });
		if (primaryCalls === 2) return new Response("denied", { status: 403, headers: { "content-type": "text/html" } });
		proxyTargets.push(url);
		return new Response("%PDF-1.7 recovered", { status: 200, headers: { "content-type": "application/pdf" } });
	};
	const fetchH2 = redirectable(async url => url === pdf
		? new Response(null, { status: 302, headers: { location: h2Directory } })
		: new Response("<html>archive index</html>", { status: 200, headers: { "content-type": "text/html" } }), "test-h2");
	const execCurl: ExecCurl = (_args, callback) => {
		let close = () => {};
		setImmediate(() => {
			curlCalls += 1;
			if (curlCalls === 1 && laterUrl !== undefined) {
				callback(null, Buffer.from(`HTTP/1.1 302 Found\r\nlocation: ${laterUrl}\r\n\r\n`));
			} else {
				callback(Object.assign(new Error("timed out"), { name: "TimeoutError" }), Buffer.alloc(0));
			}
			close();
		});
		return { kill: () => {}, onClose: listener => { close = listener; } };
	};
	const crawlFetch = initCrawlFetch({
		fetch,
		fetchH2,
		fetchCurl: createCurlFetch({ execCurl, resolvePinnedAddress: async () => "93.184.216.34" }),
		personas: [{ name: "test", headers: {} }],
		isBlocked: () => false,
		logInfo: () => {},
		egress: { kind: "direct-then-proxy", proxyUrl: "http://proxy.example:8080" },
		rateLimitRetryDelaysMs: [],
	});

	const response = await crawlFetch(pdf, { budgetMs: 145_000, onRedirect: hop => { redirects.push(hop.toUrl); } });

	expect(proxyTargets).toEqual([laterUrl ?? pdf]);
	expect(response.url).toBe(laterUrl ?? pdf);
	expect(await response.text()).toBe("%PDF-1.7 recovered");
	expect(redirects).toEqual([
		firstLandingPage,
		new URL(h2Directory, pdf).href,
		...(laterUrl === undefined ? [] : [laterUrl]),
	]);
});
