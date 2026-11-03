import assert from "node:assert/strict";
import type { CrawlFetch, CrawlFetchInit } from "./crawl-fetch";
import { initResolveThroughUnlocker } from "./resolve-through-unlocker";

const HEADERS = { "user-agent": "test" };
const TRACKER_URL = "https://link.mail.beehiiv.com/ss/c/u001.TOKEN/4vf/TOKEN/h101/h001.TOKEN";

function unlockerAnswering(response: Response): { crawlFetch: CrawlFetch; calls: Array<{ url: string; init: CrawlFetchInit }> } {
	const calls: Array<{ url: string; init: CrawlFetchInit }> = [];
	return {
		calls,
		crawlFetch: async (url, init) => {
			calls.push({ url, init });
			return response;
		},
	};
}

describe("initResolveThroughUnlocker", () => {
	it("returns the destination the unlocker reports it was redirected to, with the caller's headers, budget and signal", async () => {
		const response = new Response("<html>destination</html>", {
			status: 200,
			headers: { "x-unblocker-redirected-to": "https://publisher.example/article?utm_source=letter" },
		});
		const { crawlFetch, calls } = unlockerAnswering(response);
		const resolveThroughUnlocker = initResolveThroughUnlocker({ crawlFetch, headers: HEADERS });
		const signal = new AbortController().signal;

		const result = await resolveThroughUnlocker(TRACKER_URL, { signal, budgetMs: 30_000 });

		assert.deepEqual(result, {
			kind: "navigated",
			url: "https://publisher.example/article?utm_source=letter",
			status: 200,
		});
		assert.deepEqual(calls, [{ url: TRACKER_URL, init: { headers: HEADERS, budgetMs: 30_000, signal } }]);
		assert.equal(response.bodyUsed, true);
	});

	it("reports no navigation when the unlocker answers without a redirect header", async () => {
		const { crawlFetch } = unlockerAnswering(new Response("Wrong Link", { status: 400 }));
		const resolveThroughUnlocker = initResolveThroughUnlocker({ crawlFetch, headers: HEADERS });

		const result = await resolveThroughUnlocker(TRACKER_URL, { signal: new AbortController().signal, budgetMs: 30_000 });

		assert.deepEqual(result, { kind: "not-navigated", status: 400 });
	});

	it.each(["javascript:alert(1)", "not a url"])(
		"reports no navigation when the unlocker's redirect header is %s",
		async (header) => {
			const { crawlFetch } = unlockerAnswering(
				new Response(null, { status: 200, headers: { "x-unblocker-redirected-to": header } }),
			);
			const resolveThroughUnlocker = initResolveThroughUnlocker({ crawlFetch, headers: HEADERS });

			const result = await resolveThroughUnlocker(TRACKER_URL, { signal: new AbortController().signal, budgetMs: 30_000 });

			assert.deepEqual(result, { kind: "not-navigated", status: 200 });
		},
	);
});
