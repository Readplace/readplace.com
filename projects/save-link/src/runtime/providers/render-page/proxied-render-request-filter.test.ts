import assert from "node:assert/strict";
import { initProxiedRenderRequestFilter } from "./proxied-render-request-filter";
import { initRenderRequestFilter, type RejectRenderRequest, type RenderRequestVerdict } from "./render-request-filter";

const ARTICLE_URL = "https://www.example-news.test/story";
const acceptEveryRequest: RejectRenderRequest = async () => undefined;

function sameSiteScripts(params: { rejectRenderRequest?: RejectRenderRequest; proxiedRequestLimit?: number } = {}) {
	const rejectRenderRequest = params.rejectRenderRequest ?? acceptEveryRequest;
	return initProxiedRenderRequestFilter({
		rejectRenderRequest,
		proxiedRequestLimit: params.proxiedRequestLimit ?? 12,
		maxResourceHostBuckets: 100,
		directRenderRequestFilter: initRenderRequestFilter({ rejectRenderRequest, maxResourceHostBuckets: 100 }),
	});
}

const navigation = (url: string) => ({ url, resourceType: "document", isNavigation: true });
const subresource = (url: string, resourceType: string) => ({ url, resourceType, isNavigation: false });
const aborts = (verdict: RenderRequestVerdict) => verdict.abort;

describe("initProxiedRenderRequestFilter", () => {
	it("continues the main-frame navigation and same-site scripts, xhr and fetch", async () => {
		const filter = sameSiteScripts()({ proxied: true, url: ARTICLE_URL });

		const verdicts = [
			await filter.decide(navigation(ARTICLE_URL)),
			await filter.decide(subresource("https://static.example-news.test/app.js", "script")),
			await filter.decide(subresource("https://api.example-news.test/story.json", "xhr")),
			await filter.decide(subresource("https://www.example-news.test/comments", "fetch")),
		].map(aborts);

		expect(verdicts).toEqual([false, false, false, false]);
		expect(filter.tally()).toEqual({
			policy: "same-site-scripts",
			proxiedRequestLimit: 12,
			continued: 4,
			continuedProxied: 4,
			continuedDirect: 0,
			continuedNavigations: 1,
			abortedByBudget: 0,
			abortedByType: 0,
			abortedBy: { type: 0, address: 0, site: 0, budget: 0 },
			continuedByResourceType: { document: 1, script: 1, xhr: 1, fetch: 1 },
		});
	});

	it.each(["stylesheet", "image", "media", "font", "other", "ping", "websocket", "manifest"])(
		"aborts a same-site %s request without consulting the address check",
		async (resourceType) => {
			const consulted: string[] = [];
			const filter = sameSiteScripts({
				rejectRenderRequest: async ({ url }) => {
					consulted.push(url);
					return undefined;
				},
			})({ proxied: true, url: ARTICLE_URL });

			const verdict = await filter.decide(subresource("https://static.example-news.test/asset", resourceType));

			expect(verdict.abort).toBe(true);
			expect(filter.tally().abortedBy).toEqual({ type: 1, address: 0, site: 0, budget: 0 });
			expect(consulted).toEqual([]);
		},
	);

	it("aborts a subframe document even on the article's own site", async () => {
		const filter = sameSiteScripts()({ proxied: true, url: ARTICLE_URL });

		const verdict = await filter.decide(subresource("https://www.example-news.test/embed", "document"));

		expect(verdict.abort).toBe(true);
		expect(filter.tally().abortedBy.type).toBe(1);
	});

	it("aborts a cross-site script and records its host under the aborted-site route", async () => {
		const filter = sameSiteScripts()({ proxied: true, url: ARTICLE_URL });

		const verdict = await filter.decide(subresource("https://cdn.analytics-vendor.test/tag.js?id=secret", "script"));

		expect(verdict.abort).toBe(true);
		expect(filter.tally()).toMatchObject({ abortedByType: 1, abortedBy: { type: 0, address: 0, site: 1, budget: 0 } });
		expect(filter.resourceHosts().buckets).toEqual([
			{ documentSite: "example-news.test", requestHost: "cdn.analytics-vendor.test", resourceType: "script", navigation: false, route: "aborted-site", requests: 1, response2xx: 0, responseOther: 0, failed: 0 },
		]);
	});

	it("treats a publication's CDN on another registrable domain as cross-site", async () => {
		const filter = sameSiteScripts()({ proxied: true, url: "https://writer.substack.com/p/post" });

		const verdict = await filter.decide(subresource("https://substackcdn.com/bundle/main.js", "script"));

		expect(verdict.abort).toBe(true);
		expect(filter.tally().abortedBy.site).toBe(1);
	});

	it("judges subresources against the site the main frame redirected to", async () => {
		const filter = sameSiteScripts()({ proxied: true, url: "https://short.link-wrapper.test/abc" });
		await filter.decide(navigation("https://short.link-wrapper.test/abc"));
		await filter.decide(navigation("https://www.example-news.test/story"));

		const publisherScript = await filter.decide(subresource("https://static.example-news.test/app.js", "script"));
		const wrapperScript = await filter.decide(subresource("https://short.link-wrapper.test/track.js", "script"));

		expect([publisherScript.abort, wrapperScript.abort]).toEqual([false, true]);
		expect(filter.resourceHosts()).toMatchObject({ initialSite: "link-wrapper.test", finalSite: "example-news.test" });
	});

	it("still applies the address check to every navigation in a redirect chain", async () => {
		const filter = sameSiteScripts({
			rejectRenderRequest: async ({ url }) => (url.startsWith("http://169.254.169.254") ? "address" : undefined),
		})({ proxied: true, url: ARTICLE_URL });
		await filter.decide(navigation(ARTICLE_URL));

		const verdict = await filter.decide(navigation("http://169.254.169.254/latest/meta-data/"));

		expect(verdict.abort).toBe(true);
		expect(filter.tally().abortedBy).toEqual({ type: 0, address: 1, site: 0, budget: 0 });
		expect(filter.resourceHosts().finalSite).toBe("example-news.test");
	});

	it("passes a same-site request the address check rejects to that check's verdict", async () => {
		const filter = sameSiteScripts({ rejectRenderRequest: async () => "address" })({ proxied: true, url: ARTICLE_URL });

		const verdict = await filter.decide(subresource("https://internal.example-news.test/api", "fetch"));

		expect(verdict.abort).toBe(true);
		expect(filter.tally().abortedBy.address).toBe(1);
	});

	it("leaves an unparseable subresource URL to the address check", async () => {
		const filter = sameSiteScripts({ rejectRenderRequest: async () => "address" })({ proxied: true, url: ARTICLE_URL });

		const verdict = await filter.decide(subresource("not a url", "script"));

		expect(verdict.abort).toBe(true);
		expect(filter.tally().abortedBy).toEqual({ type: 0, address: 1, site: 0, budget: 0 });
	});

	it("continues the 12th proxied request and aborts the 13th, navigations included", async () => {
		const filter = sameSiteScripts()({ proxied: true, url: ARTICLE_URL });

		const verdicts = [aborts(await filter.decide(navigation(ARTICLE_URL)))];
		for (let request = 2; request <= 12; request++) verdicts.push(aborts(await filter.decide(subresource("https://static.example-news.test/app.js", "script"))));
		const thirteenthNavigation = await filter.decide(navigation("https://www.example-news.test/story?page=2"));

		expect(verdicts).toEqual(Array(12).fill(false));
		expect(thirteenthNavigation.abort).toBe(true);
		expect(filter.tally()).toMatchObject({ continuedProxied: 12, continuedNavigations: 1, abortedByBudget: 1 });
		expect(filter.resourceHosts().buckets.at(-1)).toMatchObject({ requestHost: "www.example-news.test", navigation: true, route: "aborted-budget", requests: 1 });
	});

	it("does not spend capacity on requests it aborts by type, site or address", async () => {
		const filter = sameSiteScripts({
			proxiedRequestLimit: 1,
			rejectRenderRequest: async ({ url }) => (url.includes("internal") ? "address" : undefined),
		})({ proxied: true, url: ARTICLE_URL });
		await filter.decide(subresource("https://static.example-news.test/site.css", "stylesheet"));
		await filter.decide(subresource("https://cdn.analytics-vendor.test/tag.js", "script"));
		await filter.decide(subresource("https://internal.example-news.test/api", "fetch"));

		const verdict = await filter.decide(navigation(ARTICLE_URL));

		expect(verdict.abort).toBe(false);
		expect(filter.tally()).toMatchObject({ continuedProxied: 1, abortedBy: { type: 1, address: 1, site: 1, budget: 0 } });
	});

	it("never lets concurrent address checks oversubscribe the cap", async () => {
		const pending: Array<() => void> = [];
		const filter = sameSiteScripts({
			proxiedRequestLimit: 3,
			rejectRenderRequest: () =>
				new Promise((resolve) => {
					pending.push(() => resolve(undefined));
				}),
		})({ proxied: true, url: ARTICLE_URL });

		const decisions = Array.from({ length: 6 }, () => filter.decide(subresource("https://static.example-news.test/app.js", "script")));
		for (const release of pending) release();
		const verdicts = (await Promise.all(decisions)).map(aborts);

		expect(verdicts).toEqual([false, false, false, true, true, true]);
		expect(filter.tally()).toMatchObject({ continuedProxied: 3, abortedByBudget: 3 });
	});

	it("keeps charging a continued request that later fails", async () => {
		const filter = sameSiteScripts({ proxiedRequestLimit: 1 })({ proxied: true, url: ARTICLE_URL });
		const first = await filter.decide(navigation(ARTICLE_URL));
		assert(!first.abort, "the navigation continues");
		first.settle({ kind: "failed" });

		const retry = await filter.decide(navigation(ARTICLE_URL));

		expect(retry.abort).toBe(true);
		expect(filter.resourceHosts().buckets[0]).toMatchObject({ route: "proxy", requests: 1, failed: 1 });
	});

	it("starts every render with fresh counters", async () => {
		const createFilter = sameSiteScripts({ proxiedRequestLimit: 1 });
		await createFilter({ proxied: true, url: ARTICLE_URL }).decide(navigation(ARTICLE_URL));

		const second = createFilter({ proxied: true, url: ARTICLE_URL });

		expect((await second.decide(navigation(ARTICLE_URL))).abort).toBe(false);
	});

	it("leaves the direct leg on its existing filter", async () => {
		const filter = sameSiteScripts({ proxiedRequestLimit: 1 })({ proxied: false, url: ARTICLE_URL });

		const verdicts = [
			await filter.decide(subresource("https://fonts.other-cdn.test/site.css", "stylesheet")),
			await filter.decide(subresource("https://cdn.analytics-vendor.test/tag.js", "script")),
			await filter.decide(subresource("https://static.example-news.test/app.js", "script")),
		].map(aborts);

		expect(verdicts).toEqual([false, false, false]);
		expect(filter.tally()).toMatchObject({ policy: "legacy", continuedDirect: 3, continuedProxied: 0 });
	});
});
