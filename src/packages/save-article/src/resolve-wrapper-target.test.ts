import type { HutchLogger } from "@packages/hutch-logger";
import { type FetchRedirectHop, initResolveWrapperTarget, neverResolveWrapperTarget } from "./resolve-wrapper-target";

const HEADERS = { "user-agent": "test" };
const TRACKER = "https://javascriptweekly.com/link/100000/rss";
const PUBLISHER = "https://sqlite.org/lang_with.html#rcex3";
const APPLE = "https://apple.news/AjYm3jdR0S4uhs9hRKpJ1Sg";
const ARCHIVE = "https://archive.ph/Ab1cD";

function redirect(location: string | undefined, status = 302): Response {
	return new Response(null, { status, headers: location === undefined ? {} : { location } });
}

function capturingLogger(): { logger: HutchLogger; lines: Array<{ level: string; line: string }> } {
	const lines: Array<{ level: string; line: string }> = [];
	const record = (level: string) => (line: unknown) => {
		lines.push({ level, line: String(line) });
	};
	return { logger: { info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") }, lines };
}

function scriptedHops(script: Record<string, () => Response | Promise<Response>>) {
	const requests: Array<{ url: string; init: { headers: Record<string, string>; signal: AbortSignal } }> = [];
	const fetchRedirectHop: FetchRedirectHop = async (url, init) => {
		requests.push({ url, init });
		const respond = script[url];
		if (respond === undefined) throw new Error(`unscripted hop: ${url}`);
		return respond();
	};
	return { fetchRedirectHop, requests };
}

function createResolver(overrides: Partial<Parameters<typeof initResolveWrapperTarget>[0]> = {}) {
	const { logger, lines } = capturingLogger();
	const resolve = initResolveWrapperTarget({
		fetchRedirectHop: async () => {
			throw new Error("fetchRedirectHop invoked unexpectedly");
		},
		resolveAppleNewsStoryUrl: async () => {
			throw new Error("resolveAppleNewsStoryUrl invoked unexpectedly");
		},
		headers: HEADERS,
		hopBudgetMs: 1000,
		totalBudgetMs: 2000,
		logger,
		...overrides,
	});
	return { resolve, lines };
}

function parsedLine(lines: Array<{ level: string; line: string }>, index = 0): Record<string, unknown> {
	return JSON.parse(lines[index].line);
}

describe("neverResolveWrapperTarget", () => {
	it("resolves nothing", async () => {
		expect(await neverResolveWrapperTarget(TRACKER)).toBeUndefined();
	});
});

describe("initResolveWrapperTarget", () => {
	it("returns undefined without a request for a URL outside every wrapper family", async () => {
		const { resolve, lines } = createResolver();

		expect(await resolve(PUBLISHER)).toBeUndefined();
		expect(lines).toEqual([]);
	});

	describe("newsletter trackers", () => {
		it("returns the first hop that leaves the tracker family without fetching it", async () => {
			const { fetchRedirectHop, requests } = scriptedHops({ [TRACKER]: () => redirect(PUBLISHER, 301) });
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(TRACKER)).toEqual({ url: PUBLISHER });
			expect(requests.map((request) => request.url)).toEqual([TRACKER]);
			expect(requests[0].init.headers).toBe(HEADERS);
			expect(requests[0].init.signal).toBeInstanceOf(AbortSignal);
			expect(parsedLine(lines)).toEqual({
				stream: "wrapper-resolve",
				family: "newsletter-tracker",
				wrapperHost: "javascriptweekly.com",
				targetHost: "sqlite.org",
				hops: 1,
				outcome: "resolved",
			});
		});

		it("never writes the wrapper or target URL into the log line", async () => {
			const subscriberTracker = "https://leadershipintech.com/links/5134/0b1f0d9c-3b6e-4f9d-9a1e-6f0d5c8e2a11/email";
			const { fetchRedirectHop } = scriptedHops({ [subscriberTracker]: () => redirect(PUBLISHER) });
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			await resolve(subscriberTracker);

			expect(lines[0].line).not.toContain("0b1f0d9c");
			expect(lines[0].line).not.toContain("lang_with");
		});

		it("follows a share.google link through Google's second hop to the publisher", async () => {
			const share = "https://share.google/AbCdEf123";
			const googleHop = "https://www.google.com/share.google?q=https%3A%2F%2Fpublisher.example%2Farticle";
			const { fetchRedirectHop, requests } = scriptedHops({
				[share]: () => redirect(googleHop),
				[googleHop]: () => redirect("https://publisher.example/article"),
			});
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(share)).toEqual({ url: "https://publisher.example/article" });
			expect(requests.map((request) => request.url)).toEqual([share, googleHop]);
			expect(parsedLine(lines).hops).toBe(2);
		});

		it("follows a scheme upgrade of the same tracker before the real redirect", async () => {
			const insecure = "http://javascriptweekly.com/link/100000/rss";
			const { fetchRedirectHop } = scriptedHops({
				[insecure]: () => redirect(TRACKER, 301),
				[TRACKER]: () => redirect(PUBLISHER),
			});
			const { resolve } = createResolver({ fetchRedirectHop });

			expect(await resolve(insecure)).toEqual({ url: PUBLISHER });
		});

		it("resolves a relative Location against the hop that sent it", async () => {
			const { fetchRedirectHop } = scriptedHops({ [TRACKER]: () => redirect("/issues/700") });
			const { resolve } = createResolver({ fetchRedirectHop });

			expect(await resolve(TRACKER)).toEqual({ url: "https://javascriptweekly.com/issues/700" });
		});

		it("hands back a Mailchimp 'tweet this' intent verbatim — unwrapping it is the caller's job", async () => {
			const mailchimp = "https://us12.list-manage.com/track/click?u=abc&id=def&e=sub";
			const intent = "https://twitter.com/intent/tweet?url=https%3A%2F%2Fpublisher.example%2Farticle";
			const { fetchRedirectHop } = scriptedHops({ [mailchimp]: () => redirect(intent) });
			const { resolve } = createResolver({ fetchRedirectHop });

			expect(await resolve(mailchimp)).toEqual({ url: intent });
		});

		it.each([
			{ label: "a 200 instead of a redirect", respond: () => new Response("<html>", { status: 200 }), outcome: "not-a-redirect" },
			{ label: "a 404", respond: () => new Response(null, { status: 404 }), outcome: "not-a-redirect" },
			{ label: "a redirect without a Location", respond: () => redirect(undefined), outcome: "no-location" },
			{ label: "a non-HTTP Location", respond: () => redirect("mailto:editor@example.com"), outcome: "non-http-location" },
			{ label: "an unparsable Location", respond: () => redirect("http://["), outcome: "non-http-location" },
		])("gives up on $label", async ({ respond, outcome }) => {
			const { fetchRedirectHop } = scriptedHops({ [TRACKER]: respond });
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(TRACKER)).toBeUndefined();
			expect(parsedLine(lines)).toMatchObject({ outcome, hops: 1 });
			expect(parsedLine(lines)).not.toHaveProperty("targetHost");
		});

		it("gives up after five hops that never leave the tracker family", async () => {
			const chain = Array.from({ length: 6 }, (_, index) => `https://javascriptweekly.com/link/${index}/rss`);
			const script = Object.fromEntries(chain.map((url, index) => [url, () => redirect(chain[index + 1] ?? PUBLISHER)]));
			const { fetchRedirectHop, requests } = scriptedHops(script);
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(chain[0])).toBeUndefined();
			expect(requests).toHaveLength(5);
			expect(parsedLine(lines)).toMatchObject({ outcome: "hop-budget-exhausted", hops: 5 });
		});

		it("gives up when a hop throws, logging the failure without the URL", async () => {
			const { resolve, lines } = createResolver({
				fetchRedirectHop: async () => {
					throw new Error("fetch failed");
				},
			});

			expect(await resolve(TRACKER)).toBeUndefined();
			expect(lines[0].level).toBe("warn");
			expect(parsedLine(lines)).toEqual({
				stream: "wrapper-resolve",
				family: "newsletter-tracker",
				wrapperHost: "javascriptweekly.com",
				outcome: "failed",
				error: "fetch failed",
			});
		});

		it("stringifies a non-Error rejection in the failure line", async () => {
			const { resolve, lines } = createResolver({
				fetchRedirectHop: async () => {
					throw "socket hang up";
				},
			});

			expect(await resolve(TRACKER)).toBeUndefined();
			expect(parsedLine(lines).error).toBe("socket hang up");
		});

		it("aborts a hop that outlives the per-hop budget", async () => {
			const { resolve, lines } = createResolver({
				hopBudgetMs: 10,
				fetchRedirectHop: (_url, init) =>
					new Promise((_resolve, reject) => {
						init.signal.addEventListener("abort", () => reject(init.signal.reason));
					}),
			});

			expect(await resolve(TRACKER)).toBeUndefined();
			expect(parsedLine(lines)).toMatchObject({ outcome: "failed" });
		});
	});

	describe("Apple News", () => {
		it("returns the story URL the shell resolves to, under the total deadline", async () => {
			let received: { url: string; signal: AbortSignal } | undefined;
			const { resolve, lines } = createResolver({
				resolveAppleNewsStoryUrl: async (url, init) => {
					received = { url, signal: init.signal };
					return "https://www.abc.net.au/news/story";
				},
			});

			expect(await resolve(`${APPLE}?articleList=x`)).toEqual({ url: "https://www.abc.net.au/news/story" });
			expect(received?.url).toBe(`${APPLE}?articleList=x`);
			expect(received?.signal).toBeInstanceOf(AbortSignal);
			expect(parsedLine(lines)).toEqual({
				stream: "wrapper-resolve",
				family: "apple-news",
				wrapperHost: "apple.news",
				targetHost: "www.abc.net.au",
				hops: 1,
				outcome: "resolved",
			});
		});

		it("gives up when the shell carries no story URL", async () => {
			const { resolve, lines } = createResolver({ resolveAppleNewsStoryUrl: async () => undefined });

			expect(await resolve(APPLE)).toBeUndefined();
			expect(parsedLine(lines)).toMatchObject({ outcome: "no-story-url" });
		});
	});

	describe("archive snapshots", () => {
		it("reads the original from the Memento Link header", async () => {
			const { fetchRedirectHop } = scriptedHops({
				[ARCHIVE]: () =>
					new Response(null, {
						status: 200,
						headers: {
							link: '<https://publisher.example/article>; rel="original", <https://archive.ph/timemap/https://publisher.example/article>; rel="timemap"; type="application/link-format"',
						},
					}),
			});
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(ARCHIVE)).toEqual({ url: "https://publisher.example/article", contentSourceUrl: ARCHIVE });
			expect(parsedLine(lines)).toMatchObject({ family: "archive-snapshot", targetHost: "publisher.example", outcome: "resolved" });
		});

		it("accepts a multi-valued rel that includes original", async () => {
			const { fetchRedirectHop } = scriptedHops({
				[ARCHIVE]: () =>
					new Response(null, { status: 200, headers: { link: '<https://publisher.example/a>; rel="timegate original"' } }),
			});
			const { resolve } = createResolver({ fetchRedirectHop });

			expect(await resolve(ARCHIVE)).toEqual({ url: "https://publisher.example/a", contentSourceUrl: ARCHIVE });
		});

		it.each([
			{ label: "a 429 without a Link header", link: undefined, outcome: "no-memento-original" },
			{
				label: "a Link header without an original relation",
				link: '<https://archive.ph/timemap/x>; rel="timemap"',
				outcome: "no-memento-original",
			},
			{ label: "a non-HTTP original", link: '<ftp://files.example/a>; rel="original"', outcome: "non-http-location" },
		])("gives up on $label", async ({ link, outcome }) => {
			const headers: Record<string, string> = link === undefined ? {} : { link };
			const { fetchRedirectHop } = scriptedHops({ [ARCHIVE]: () => new Response(null, { status: 429, headers }) });
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(ARCHIVE)).toBeUndefined();
			expect(parsedLine(lines)).toMatchObject({ outcome });
		});

		it("follows a redirect to an archive.today mirror before reading the Link header", async () => {
			const MIRROR = "https://archive.li/Ab1cD";
			const { fetchRedirectHop, requests } = scriptedHops({
				[ARCHIVE]: () => redirect(MIRROR),
				[MIRROR]: () =>
					new Response(null, { status: 200, headers: { link: '<https://publisher.example/article>; rel="original"' } }),
			});
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(ARCHIVE)).toEqual({ url: "https://publisher.example/article", contentSourceUrl: MIRROR });
			expect(requests.map((request) => request.url)).toEqual([ARCHIVE, MIRROR]);
			expect(parsedLine(lines)).toMatchObject({ outcome: "resolved", hops: 2 });
		});

		it.each([
			{ label: "a redirect off the archive hosts", response: () => redirect("https://publisher.example/article") },
			{ label: "a redirect without a Location", response: () => redirect(undefined) },
			{ label: "a redirect to a non-HTTP Location", response: () => redirect("ftp://archive.li/Ab1cD") },
		])("stops at $label without a Link header", async ({ response }) => {
			const { fetchRedirectHop, requests } = scriptedHops({ [ARCHIVE]: response });
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(ARCHIVE)).toBeUndefined();
			expect(requests).toHaveLength(1);
			expect(parsedLine(lines)).toMatchObject({ outcome: "no-memento-original", hops: 1 });
		});

		it("gives up after five redirects between archive mirrors", async () => {
			const mirrors = ["https://archive.ph/Ab1cD", "https://archive.li/Ab1cD", "https://archive.md/Ab1cD"];
			const { fetchRedirectHop, requests } = scriptedHops({
				[mirrors[0]]: () => redirect(mirrors[1]),
				[mirrors[1]]: () => redirect(mirrors[2]),
				[mirrors[2]]: () => redirect(mirrors[0]),
			});
			const { resolve, lines } = createResolver({ fetchRedirectHop });

			expect(await resolve(ARCHIVE)).toBeUndefined();
			expect(requests).toHaveLength(5);
			expect(parsedLine(lines)).toMatchObject({ outcome: "hop-budget-exhausted", hops: 5 });
		});
	});
});


it.each(["https://archive.ph/o/abc/javascript:alert(1)", "https://x.com/intent/post"])("does not turn an unresolved syntactic wrapper into an archive lookup: %s", async (url) => {
	const { resolve, lines } = createResolver();
	expect(await resolve(url)).toBeUndefined();
	expect(lines).toEqual([]);
});
