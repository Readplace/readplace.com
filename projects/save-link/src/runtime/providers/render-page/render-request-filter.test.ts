import assert from "node:assert/strict";
import type { ResolveAll } from "@packages/crawl-article";
import { initRejectRenderRequest, initRenderRequestFilter, isMainFrameNavigation, type RejectRenderRequest, type RenderRequestVerdict } from "./render-request-filter";

const PRIVATE_ADDRESSES = new Set(["10.0.0.7", "127.0.0.1", "169.254.169.254", "::1"]);
const isBlocked = (address: string) => PRIVATE_ADDRESSES.has(address);

function resolverAnswering(answers: Readonly<Record<string, readonly string[]>>) {
	const lookedUp: string[] = [];
	const resolve: ResolveAll = (hostname, _options, callback) => {
		lookedUp.push(hostname);
		const addresses = answers[hostname];
		if (addresses === undefined) {
			callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), []);
			return;
		}
		callback(
			null,
			addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
		);
	};
	return { resolve, lookedUp };
}

describe("rejectRenderRequest", () => {
	it("lets a document on a public host through", async () => {
		const { resolve } = resolverAnswering({ "example-spa.test": ["203.0.113.10"] });
		const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

		expect(await rejectRenderRequest({ url: "https://example-spa.test/post", resourceType: "document" })).toBeUndefined();
	});

	it("lets a script on a public host through", async () => {
		const { resolve } = resolverAnswering({ "cdn.example-spa.test": ["203.0.113.11"] });
		const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

		expect(await rejectRenderRequest({ url: "http://cdn.example-spa.test/app.js", resourceType: "script" })).toBeUndefined();
	});

	it.each(["image", "media", "font"])("skips a %s request without resolving its host", async (resourceType) => {
		const { resolve, lookedUp } = resolverAnswering({ "cdn.example-spa.test": ["203.0.113.11"] });
		const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

		expect(await rejectRenderRequest({ url: "https://cdn.example-spa.test/asset", resourceType })).toBe("type");
		expect(lookedUp).toEqual([]);
	});

	it.each(["file:///etc/passwd", "ftp://example-spa.test/file", "chrome://settings"])(
		"aborts the non-http(s) request %s",
		async (url) => {
			const { resolve } = resolverAnswering({});
			const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

			expect(await rejectRenderRequest({ url, resourceType: "document" })).toBe("address");
		},
	);

	it("aborts a request whose URL does not parse", async () => {
		const { resolve } = resolverAnswering({});
		const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

		expect(await rejectRenderRequest({ url: "not a url", resourceType: "document" })).toBe("address");
	});

	it.each(["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:9001/2018-06-01/runtime/invocation/next", "http://[::1]/"])(
		"aborts a request to the blocked address literal %s",
		async (url) => {
			const { resolve, lookedUp } = resolverAnswering({});
			const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

			expect(await rejectRenderRequest({ url, resourceType: "xhr" })).toBe("address");
			expect(lookedUp).toEqual([]);
		},
	);

	it.each(["http://203.0.113.12/api", "http://[2001:db8::12]/api"])(
		"lets a request to the public address literal %s through without resolving it",
		async (url) => {
			const { resolve, lookedUp } = resolverAnswering({});
			const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

			expect(await rejectRenderRequest({ url, resourceType: "fetch" })).toBeUndefined();
			expect(lookedUp).toEqual([]);
		},
	);

	it("aborts a request to a name that resolves to a blocked address", async () => {
		const { resolve } = resolverAnswering({ "internal.example-spa.test": ["203.0.113.13", "10.0.0.7"] });
		const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

		expect(await rejectRenderRequest({ url: "https://internal.example-spa.test/api", resourceType: "fetch" })).toBe("address");
	});

	it("aborts a request to a name that does not resolve", async () => {
		const { resolve } = resolverAnswering({});
		const rejectRenderRequest = initRejectRenderRequest({ resolve, isBlocked });

		expect(await rejectRenderRequest({ url: "https://missing.example-spa.test/api", resourceType: "fetch" })).toBe("address");
	});
});

describe("isMainFrameNavigation", () => {
	const mainFrame = { name: "main" };
	const subframe = { name: "ad" };

	it.each([
		{ label: "a main-frame navigation", navigation: true, frame: mainFrame, expected: true },
		{ label: "a subframe navigation", navigation: true, frame: subframe, expected: false },
		{ label: "a main-frame subresource", navigation: false, frame: mainFrame, expected: false },
		{ label: "a request with no frame", navigation: true, frame: null, expected: false },
	])("answers $expected for $label", ({ navigation, frame, expected }) => {
		const request = { isNavigationRequest: () => navigation, frame: () => frame };

		expect(isMainFrameNavigation(request, mainFrame)).toBe(expected);
	});
});

describe("initRenderRequestFilter", () => {
	const acceptEveryRequest: RejectRenderRequest = async () => undefined;
	const ARTICLE_URL = "https://example-spa.test/post";
	const script = { url: "https://cdn.example-spa.test/app.js", resourceType: "script", isNavigation: false };
	const legacyFilter = (render: { proxied: boolean }, rejectRenderRequest: RejectRenderRequest = acceptEveryRequest, maxResourceHostBuckets = 100) =>
		initRenderRequestFilter({ rejectRenderRequest, maxResourceHostBuckets })({ ...render, url: ARTICLE_URL });
	const aborts = (verdict: RenderRequestVerdict) => verdict.abort;

	it("continues the 40th proxied request and aborts the 41st", async () => {
		const filter = legacyFilter({ proxied: true });

		const verdicts = [];
		for (let request = 1; request <= 41; request++) verdicts.push(aborts(await filter.decide(script)));

		expect(verdicts.slice(0, 40)).toEqual(Array(40).fill(false));
		expect(verdicts[40]).toBe(true);
		expect(filter.tally()).toEqual({
			proxiedRequestLimit: 40,
			continued: 40,
			continuedProxied: 40,
			continuedDirect: 0,
			continuedNavigations: 0,
			abortedByBudget: 1,
			abortedByType: 0,
			abortedBy: { type: 0, address: 0, budget: 1 },
			continuedByResourceType: { script: 40 },
		});
	});

	it("never aborts the navigation request past the cap", async () => {
		const filter = legacyFilter({ proxied: true });
		for (let request = 1; request <= 40; request++) await filter.decide(script);

		const verdict = await filter.decide({ url: "https://example-spa.test/next", resourceType: "document", isNavigation: true });

		expect(verdict.abort).toBe(false);
		expect(filter.tally().continuedByResourceType).toEqual({ script: 40, document: 1 });
		expect(filter.tally().continuedNavigations).toBe(1);
	});

	it("aborts a subframe document past the cap", async () => {
		const filter = legacyFilter({ proxied: true });
		for (let request = 1; request <= 40; request++) await filter.decide(script);

		const verdict = await filter.decide({ url: "https://ads.example-spa.test/frame", resourceType: "document", isNavigation: false });

		expect(verdict.abort).toBe(true);
		expect(filter.tally().abortedByBudget).toBe(1);
	});

	it("continues a cross-site stylesheet on the proxied leg", async () => {
		const filter = legacyFilter({ proxied: true });

		const verdict = await filter.decide({ url: "https://fonts.other-cdn.test/site.css", resourceType: "stylesheet", isNavigation: false });

		expect(verdict.abort).toBe(false);
		expect(filter.tally().continuedByResourceType).toEqual({ stylesheet: 1 });
	});

	it("still refuses a navigation request the address check rejects", async () => {
		const filter = legacyFilter({ proxied: true }, async () => "address");

		const verdict = await filter.decide({ url: "http://169.254.169.254/", resourceType: "document", isNavigation: true });

		expect(verdict.abort).toBe(true);
		expect(filter.tally().abortedBy).toEqual({ type: 0, address: 1, budget: 0 });
	});

	it("counts address rejections inside abortedByType as it always has", async () => {
		const filter = legacyFilter({ proxied: true }, async ({ resourceType }) => (resourceType === "image" ? "type" : "address"));
		await filter.decide({ url: "https://cdn.example-spa.test/a.png", resourceType: "image", isNavigation: false });
		await filter.decide({ url: "http://10.0.0.7/api", resourceType: "xhr", isNavigation: false });

		expect(filter.tally()).toMatchObject({ abortedByType: 2, abortedBy: { type: 1, address: 1, budget: 0 } });
	});

	it("does not count a request aborted by type against the cap", async () => {
		const filter = legacyFilter({ proxied: true }, async ({ resourceType }) => (resourceType === "image" ? "type" : undefined));
		for (let request = 1; request <= 50; request++) await filter.decide({ url: "https://cdn.example-spa.test/a.png", resourceType: "image", isNavigation: false });

		const verdict = await filter.decide(script);

		expect(verdict.abort).toBe(false);
		expect(filter.tally()).toMatchObject({ continued: 1, abortedByBudget: 0, abortedByType: 50, continuedByResourceType: { script: 1 } });
	});

	it("tallies a direct render without capping it", async () => {
		const filter = legacyFilter({ proxied: false });

		const verdicts = [];
		for (let request = 1; request <= 45; request++) verdicts.push(aborts(await filter.decide(script)));

		expect(verdicts).toEqual(Array(45).fill(false));
		expect(filter.tally()).toMatchObject({ continued: 45, continuedProxied: 0, continuedDirect: 45, abortedByBudget: 0, continuedByResourceType: { script: 45 } });
	});

	it("starts every render with fresh counters", async () => {
		const createFilter = initRenderRequestFilter({ rejectRenderRequest: acceptEveryRequest, maxResourceHostBuckets: 100 });
		const first = createFilter({ proxied: true, url: ARTICLE_URL });
		for (let request = 1; request <= 41; request++) await first.decide(script);

		const second = createFilter({ proxied: true, url: ARTICLE_URL });

		expect((await second.decide(script)).abort).toBe(false);
		expect(second.tally()).toMatchObject({ continued: 1, abortedByBudget: 0 });
	});

	it("groups continued requests by document site, host, type and route with their outcomes", async () => {
		const filter = legacyFilter({ proxied: true });
		const navigation = await filter.decide({ url: ARTICLE_URL, resourceType: "document", isNavigation: true });
		const firstScript = await filter.decide(script);
		const secondScript = await filter.decide(script);
		const failedScript = await filter.decide(script);
		assert(!navigation.abort && !firstScript.abort && !secondScript.abort && !failedScript.abort, "every request continues");
		navigation.settle({ kind: "response", status: 200 });
		firstScript.settle({ kind: "response", status: 200 });
		firstScript.settle({ kind: "failed" });
		secondScript.settle({ kind: "response", status: 404 });
		failedScript.settle({ kind: "failed" });

		expect(filter.resourceHosts()).toEqual({
			initialSite: "example-spa.test",
			finalSite: "example-spa.test",
			overflowedRequests: 0,
			buckets: [
				{ documentSite: "example-spa.test", requestHost: "example-spa.test", resourceType: "document", navigation: true, route: "proxy", requests: 1, response2xx: 1, responseOther: 0, failed: 0 },
				{ documentSite: "example-spa.test", requestHost: "cdn.example-spa.test", resourceType: "script", navigation: false, route: "proxy", requests: 3, response2xx: 1, responseOther: 1, failed: 1 },
			],
		});
	});

	it("labels a direct render's requests with the direct route", async () => {
		const filter = legacyFilter({ proxied: false });
		await filter.decide(script);

		expect(filter.resourceHosts().buckets).toEqual([
			{ documentSite: "example-spa.test", requestHost: "cdn.example-spa.test", resourceType: "script", navigation: false, route: "direct", requests: 1, response2xx: 0, responseOther: 0, failed: 0 },
		]);
	});

	it("records requests aborted by the cap under the aborted-budget route", async () => {
		const filter = legacyFilter({ proxied: true });
		for (let request = 1; request <= 41; request++) await filter.decide(script);

		expect(filter.resourceHosts().buckets.map(({ route, requests }) => ({ route, requests }))).toEqual([
			{ route: "proxy", requests: 40 },
			{ route: "aborted-budget", requests: 1 },
		]);
	});

	it("moves the document site when the main frame navigates to another site", async () => {
		const filter = legacyFilter({ proxied: true });
		await filter.decide({ url: "https://www.other-publisher.test/story", resourceType: "document", isNavigation: true });
		await filter.decide({ url: "https://static.other-publisher.test/app.js", resourceType: "script", isNavigation: false });

		expect(filter.resourceHosts()).toMatchObject({
			initialSite: "example-spa.test",
			finalSite: "other-publisher.test",
			buckets: [
				{ documentSite: "example-spa.test", requestHost: "www.other-publisher.test", navigation: true },
				{ documentSite: "other-publisher.test", requestHost: "static.other-publisher.test", navigation: false },
			],
		});
	});

	it("counts requests past the bucket bound as overflow instead of dropping them silently", async () => {
		const filter = legacyFilter({ proxied: true }, acceptEveryRequest, 1);
		await filter.decide(script);
		const overflowed = await filter.decide({ url: "https://api.example-spa.test/feed", resourceType: "fetch", isNavigation: false });
		assert(!overflowed.abort, "the overflowed request still continues");
		overflowed.settle({ kind: "response", status: 200 });

		expect(filter.resourceHosts()).toMatchObject({ overflowedRequests: 1, buckets: [{ requestHost: "cdn.example-spa.test", requests: 1 }] });
		expect(filter.tally().continued).toBe(2);
	});
});
