import type { ResolveAll } from "@packages/crawl-article";
import { initRenderRequestFilter, isMainFrameNavigation, initShouldAbortRequest } from "./render-request-filter";

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

describe("shouldAbortRequest", () => {
	it("lets a document on a public host through", async () => {
		const { resolve } = resolverAnswering({ "example-spa.test": ["203.0.113.10"] });
		const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

		expect(await shouldAbortRequest({ url: "https://example-spa.test/post", resourceType: "document" })).toBe(false);
	});

	it("lets a script on a public host through", async () => {
		const { resolve } = resolverAnswering({ "cdn.example-spa.test": ["203.0.113.11"] });
		const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

		expect(await shouldAbortRequest({ url: "http://cdn.example-spa.test/app.js", resourceType: "script" })).toBe(false);
	});

	it.each(["image", "media", "font"])("skips a %s request without resolving its host", async (resourceType) => {
		const { resolve, lookedUp } = resolverAnswering({ "cdn.example-spa.test": ["203.0.113.11"] });
		const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

		expect(await shouldAbortRequest({ url: "https://cdn.example-spa.test/asset", resourceType })).toBe(true);
		expect(lookedUp).toEqual([]);
	});

	it.each(["file:///etc/passwd", "ftp://example-spa.test/file", "chrome://settings"])(
		"aborts the non-http(s) request %s",
		async (url) => {
			const { resolve } = resolverAnswering({});
			const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

			expect(await shouldAbortRequest({ url, resourceType: "document" })).toBe(true);
		},
	);

	it("aborts a request whose URL does not parse", async () => {
		const { resolve } = resolverAnswering({});
		const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

		expect(await shouldAbortRequest({ url: "not a url", resourceType: "document" })).toBe(true);
	});

	it.each(["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:9001/2018-06-01/runtime/invocation/next", "http://[::1]/"])(
		"aborts a request to the blocked address literal %s",
		async (url) => {
			const { resolve, lookedUp } = resolverAnswering({});
			const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

			expect(await shouldAbortRequest({ url, resourceType: "xhr" })).toBe(true);
			expect(lookedUp).toEqual([]);
		},
	);

	it.each(["http://203.0.113.12/api", "http://[2001:db8::12]/api"])(
		"lets a request to the public address literal %s through without resolving it",
		async (url) => {
			const { resolve, lookedUp } = resolverAnswering({});
			const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

			expect(await shouldAbortRequest({ url, resourceType: "fetch" })).toBe(false);
			expect(lookedUp).toEqual([]);
		},
	);

	it("aborts a request to a name that resolves to a blocked address", async () => {
		const { resolve } = resolverAnswering({ "internal.example-spa.test": ["203.0.113.13", "10.0.0.7"] });
		const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

		expect(await shouldAbortRequest({ url: "https://internal.example-spa.test/api", resourceType: "fetch" })).toBe(true);
	});

	it("aborts a request to a name that does not resolve", async () => {
		const { resolve } = resolverAnswering({});
		const shouldAbortRequest = initShouldAbortRequest({ resolve, isBlocked });

		expect(await shouldAbortRequest({ url: "https://missing.example-spa.test/api", resourceType: "fetch" })).toBe(true);
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
	const continueEveryRequest = async () => false;
	const script = { url: "https://cdn.example-spa.test/app.js", resourceType: "script", isNavigation: false };

	it("continues the 40th proxied request and aborts the 41st", async () => {
		const filter = initRenderRequestFilter({ shouldAbortRequest: continueEveryRequest })({ proxied: true });

		const verdicts = [];
		for (let request = 1; request <= 41; request++) verdicts.push(await filter.shouldAbortRequest(script));

		expect(verdicts.slice(0, 40)).toEqual(Array(40).fill(false));
		expect(verdicts[40]).toBe(true);
		expect(filter.tally()).toEqual({ continued: 40, abortedByBudget: 1, abortedByType: 0, continuedByResourceType: { script: 40 } });
	});

	it("never aborts the navigation request past the cap", async () => {
		const filter = initRenderRequestFilter({ shouldAbortRequest: continueEveryRequest })({ proxied: true });
		for (let request = 1; request <= 40; request++) await filter.shouldAbortRequest(script);

		const verdict = await filter.shouldAbortRequest({ url: "https://example-spa.test/next", resourceType: "document", isNavigation: true });

		expect(verdict).toBe(false);
		expect(filter.tally().continuedByResourceType).toEqual({ script: 40, document: 1 });
	});

	it("aborts a subframe document past the cap", async () => {
		const filter = initRenderRequestFilter({ shouldAbortRequest: continueEveryRequest })({ proxied: true });
		for (let request = 1; request <= 40; request++) await filter.shouldAbortRequest(script);

		const verdict = await filter.shouldAbortRequest({ url: "https://ads.example-spa.test/frame", resourceType: "document", isNavigation: false });

		expect(verdict).toBe(true);
		expect(filter.tally().abortedByBudget).toBe(1);
	});

	it("still refuses a navigation request the address check rejects", async () => {
		const filter = initRenderRequestFilter({ shouldAbortRequest: async () => true })({ proxied: true });

		const verdict = await filter.shouldAbortRequest({ url: "http://169.254.169.254/", resourceType: "document", isNavigation: true });

		expect(verdict).toBe(true);
	});

	it("does not count a request aborted by type against the cap", async () => {
		const filter = initRenderRequestFilter({
			shouldAbortRequest: async ({ resourceType }) => resourceType === "image",
		})({ proxied: true });
		for (let request = 1; request <= 50; request++) await filter.shouldAbortRequest({ url: "https://cdn.example-spa.test/a.png", resourceType: "image", isNavigation: false });

		const verdict = await filter.shouldAbortRequest(script);

		expect(verdict).toBe(false);
		expect(filter.tally()).toEqual({ continued: 1, abortedByBudget: 0, abortedByType: 50, continuedByResourceType: { script: 1 } });
	});

	it("tallies a direct render without capping it", async () => {
		const filter = initRenderRequestFilter({ shouldAbortRequest: continueEveryRequest })({ proxied: false });

		const verdicts = [];
		for (let request = 1; request <= 45; request++) verdicts.push(await filter.shouldAbortRequest(script));

		expect(verdicts).toEqual(Array(45).fill(false));
		expect(filter.tally()).toEqual({ continued: 45, abortedByBudget: 0, abortedByType: 0, continuedByResourceType: { script: 45 } });
	});
});
