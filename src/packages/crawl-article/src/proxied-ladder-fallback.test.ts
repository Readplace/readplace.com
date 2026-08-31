import { createCrawlBudget } from "./crawl-budget";
import type { OnRedirect } from "./follow-redirects";
import { withProxiedLadderFallback } from "./proxied-ladder-fallback";
import type { LadderFetch } from "./transport-ladder";

const RESERVE_MILLISECONDS = 45_000;
const ENTRY_URL = "https://example.com/article";
const DEST_URL = "https://dest.example/article";

/** Advanced by the fakes so budget exhaustion is exact rather than slept for. */
type Clock = { nowMs: number };

type Attempt = (
	controller: AbortController,
	clock: Clock,
	onRedirect: OnRedirect | undefined,
	url: string,
) => Promise<Response>;

type Harness = {
	fetchIt: (init?: {
		headers?: Record<string, string>;
		totalMs?: number;
		onRedirect?: OnRedirect;
	}) => Promise<Response>;
	directBudgets: number[];
	proxyBudgets: number[];
	proxyHeaders: Array<Record<string, string> | undefined>;
	directUrls: string[];
	proxyUrls: string[];
};

function makeHarness(opts: {
	direct: Attempt;
	proxy?: ReadonlyArray<Attempt>;
}): Harness {
	const directBudgets: number[] = [];
	const proxyBudgets: number[] = [];
	const proxyHeaders: Harness["proxyHeaders"] = [];
	const directUrls: string[] = [];
	const proxyUrls: string[] = [];
	const controller = new AbortController();
	const clock: Clock = { nowMs: 1_000_000 };
	const now = () => clock.nowMs;
	const directFetch: LadderFetch = (url, init) => {
		directBudgets.push(init.budget.remainingMs());
		directUrls.push(url);
		return opts.direct(controller, clock, init.onRedirect, url);
	};
	const proxyFetch: LadderFetch = (url, init) => {
		const attempt = opts.proxy?.[proxyBudgets.length];
		proxyBudgets.push(init.budget.remainingMs());
		proxyHeaders.push(init.headers);
		proxyUrls.push(url);
		if (attempt === undefined) throw new Error("test wired no proxy answer for this attempt");
		return attempt(controller, clock, init.onRedirect, url);
	};
	const fetchWithProxy = withProxiedLadderFallback({
		directFetch,
		proxyFetch,
		proxyReserveMilliseconds: RESERVE_MILLISECONDS,
		now,
	});
	return {
		fetchIt: (init) =>
			fetchWithProxy(ENTRY_URL, {
				headers: init?.headers ?? {},
				onRedirect: init?.onRedirect,
				budget: createCrawlBudget({ signal: controller.signal, totalMs: init?.totalMs ?? 90_000, now }),
			}),
		directBudgets,
		proxyBudgets,
		proxyHeaders,
		directUrls,
		proxyUrls,
	};
}

function timeout(): Error {
	const error = new Error("leg produced no response within 200ms");
	error.name = "TimeoutError";
	return error;
}

/** A gateway answer must carry a body, so draining it is observable. */
function gateway(status: number): Response {
	return new Response("gateway failure", { status });
}

function stamped(status: number, url: string): Response {
	const response = new Response("stamped-body", { status });
	Object.defineProperty(response, "url", { value: url, configurable: true });
	return response;
}

describe("withProxiedLadderFallback", () => {
	it("returns a direct answer untouched and never runs the proxied pass", async () => {
		const harness = makeHarness({ direct: async () => new Response("direct", { status: 200 }) });
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("direct");
		expect(harness.proxyBudgets).toHaveLength(0);
	});

	it("overturns a direct block with the proxied pass, forwarding the caller headers", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt({ headers: { referer: "https://caller.example" } });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("via proxy");
		expect(harness.proxyHeaders).toEqual([{ referer: "https://caller.example" }]);
		expect(harness.proxyBudgets).toHaveLength(1);
	});

	it("treats a direct 429 as a datacenter verdict worth overturning", async () => {
		const harness = makeHarness({
			direct: async () => new Response("tarpit", { status: 429 }),
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(harness.proxyBudgets).toHaveLength(1);
	});

	it("returns the proxied answer whatever its status, so a residential 404 wins", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [async () => new Response("gone", { status: 404 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(404);
	});

	it("returns a proxied 500 as the answer, because the origin may have sent it", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [async () => new Response("origin broke", { status: 500 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(500);
		expect(harness.proxyBudgets).toHaveLength(1);
	});

	it("reaches the proxied pass after a direct-pass deadline (TimeoutError)", async () => {
		const harness = makeHarness({
			direct: async () => {
				throw timeout();
			},
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
	});

	it("reaches the proxied pass after a block-class transport error", async () => {
		const harness = makeHarness({
			direct: async () => {
				throw new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR (RST_STREAM)");
			},
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
	});

	it("rethrows a terminal network error without running the proxied pass", async () => {
		const dead = new Error("getaddrinfo ENOTFOUND gone.example");
		const harness = makeHarness({
			direct: async () => {
				throw dead;
			},
		});
		await expect(harness.fetchIt()).rejects.toBe(dead);
		expect(harness.proxyBudgets).toHaveLength(0);
	});

	it("rethrows a non-Error throw without running the proxied pass", async () => {
		const harness = makeHarness({
			direct: async () => {
				throw "boom";
			},
		});
		await expect(harness.fetchIt()).rejects.toBe("boom");
		expect(harness.proxyBudgets).toHaveLength(0);
	});

	it("surfaces the direct block when the proxied pass itself fails at transport level", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [
				async () => {
					throw new Error("proxy connect refused");
				},
			],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(403);
	});

	it("surfaces the direct deadline when the proxied pass also fails", async () => {
		const harness = makeHarness({
			direct: async () => {
				throw timeout();
			},
			proxy: [
				async () => {
					throw new Error("proxy connect refused");
				},
			],
		});
		await expect(harness.fetchIt()).rejects.toThrow("leg produced no response within 200ms");
	});

	it("retries once past a stalled proxied pass and returns the answer that follows", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [
				async (_controller, clock) => {
					clock.nowMs += 10_000;
					throw timeout();
				},
				async () => new Response("via proxy", { status: 200 }),
			],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("via proxy");
		expect(harness.proxyBudgets).toHaveLength(2);
	});

	it("surfaces the direct block when both proxied attempts stall", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [
				async (_controller, clock) => {
					clock.nowMs += 10_000;
					throw timeout();
				},
				async (_controller, clock) => {
					clock.nowMs += 10_000;
					throw timeout();
				},
			],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(403);
		expect(await response.text()).toBe("denied");
		expect(harness.proxyBudgets).toHaveLength(2);
	});

	it("surfaces the direct block rather than retrying when the outer deadline stalled the pass", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [
				async (controller) => {
					controller.abort(timeout());
					throw timeout();
				},
			],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(403);
		expect(harness.proxyBudgets).toHaveLength(1);
	});

	it("runs direct-only at full budget for a budget too small to seat both passes", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt({ totalMs: 8000 });
		expect(response.status).toBe(403);
		expect(harness.proxyBudgets).toHaveLength(0);
		// The direct pass keeps its whole 8s budget — no reserve carved.
		expect(harness.directBudgets[0]).toBeGreaterThan(7000);
	});

	it("reserves the proxy slice only above the gate, leaving the direct pass a full pass", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		await harness.fetchIt({ totalMs: 90_000 });
		// 90s − 45s reserve = 45s for the direct pass; the proxy pass gets the rest.
		expect(harness.directBudgets[0]).toBeGreaterThan(44_000);
		expect(harness.directBudgets[0]).toBeLessThanOrEqual(45_000);
		expect(harness.proxyBudgets[0]).toBeGreaterThan(0);
	});

	it("skips the proxied pass when the outer deadline fired during the direct pass", async () => {
		const harness = makeHarness({
			direct: async (controller) => {
				controller.abort(timeout());
				throw timeout();
			},
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		await expect(harness.fetchIt()).rejects.toThrow("leg produced no response within 200ms");
		expect(harness.proxyBudgets).toHaveLength(0);
	});

	for (const status of [502, 503, 504]) {
		it(`retries once past a proxied ${status} and returns the answer that follows`, async () => {
			const discarded = gateway(status);
			const harness = makeHarness({
				direct: async () => new Response("denied", { status: 403 }),
				proxy: [
					async (_controller, clock) => {
						clock.nowMs += 10_000;
						return discarded;
					},
					async () => new Response("via proxy", { status: 200 }),
				],
			});
			const response = await harness.fetchIt();
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("via proxy");
			expect(harness.proxyBudgets).toHaveLength(2);
			expect(discarded.bodyUsed).toBe(true);
		});
	}

	it("returns the retry's answer whatever its status, so a residential 404 still wins", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [async () => gateway(502), async () => new Response("gone", { status: 404 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(404);
	});

	it("surfaces the direct block when both proxied attempts answer a gateway status", async () => {
		const first = gateway(502);
		const second = gateway(502);
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [async () => first, async () => second],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(403);
		expect(await response.text()).toBe("denied");
		expect(harness.proxyBudgets).toHaveLength(2);
		expect(first.bodyUsed).toBe(true);
		expect(second.bodyUsed).toBe(true);
	});

	it("surfaces the direct block when the retry fails at transport level", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [
				async () => gateway(502),
				async () => {
					throw new Error("proxy connect refused");
				},
			],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(403);
		expect(harness.proxyBudgets).toHaveLength(2);
	});

	it("rethrows the direct deadline when both proxied attempts answer a gateway status", async () => {
		const harness = makeHarness({
			direct: async () => {
				throw timeout();
			},
			proxy: [async () => gateway(502), async () => gateway(502)],
		});
		await expect(harness.fetchIt()).rejects.toThrow("leg produced no response within 200ms");
		expect(harness.proxyBudgets).toHaveLength(2);
	});

	it("surfaces the direct block rather than retrying when the first attempt spent the budget", async () => {
		const discarded = gateway(502);
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [
				async (_controller, clock) => {
					clock.nowMs += 85_000;
					return discarded;
				},
			],
		});
		const response = await harness.fetchIt({ totalMs: 90_000 });
		expect(response.status).toBe(403);
		expect(harness.proxyBudgets).toHaveLength(1);
		expect(discarded.bodyUsed).toBe(true);
	});

	it("surfaces the direct block rather than retrying when the caller aborted mid-pass", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [
				async (controller) => {
					controller.abort(timeout());
					return gateway(502);
				},
			],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(403);
		expect(harness.proxyBudgets).toHaveLength(1);
	});

	it("returns a direct gateway answer as-is, leaving the direct pass unchanged", async () => {
		const harness = makeHarness({ direct: async () => new Response("origin gateway", { status: 502 }) });
		const response = await harness.fetchIt();
		expect(response.status).toBe(502);
		expect(await response.text()).toBe("origin gateway");
		expect(harness.proxyBudgets).toHaveLength(0);
	});

	it("aims the proxied pass at the terminal the direct pass was redirected to, not the entry URL", async () => {
		const harness = makeHarness({
			direct: async (_controller, _clock, onRedirect) => {
				onRedirect?.({ fromUrl: ENTRY_URL, toUrl: DEST_URL });
				return stamped(403, DEST_URL);
			},
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(harness.proxyUrls).toEqual([DEST_URL]);
	});

	it("aims the proxied pass at the last direct hop when the direct pass stalled after redirecting", async () => {
		const harness = makeHarness({
			direct: async (_controller, _clock, onRedirect) => {
				onRedirect?.({ fromUrl: ENTRY_URL, toUrl: DEST_URL });
				throw timeout();
			},
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(harness.proxyUrls).toEqual([DEST_URL]);
	});

	it("aims the proxied pass at the stamped terminal when the direct pass reported no hop", async () => {
		const harness = makeHarness({
			direct: async () => stamped(403, DEST_URL),
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(harness.proxyUrls).toEqual([DEST_URL]);
	});

	it("keeps the proxied pass on the entry URL when the direct block was unstamped and hop-silent", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(harness.proxyUrls).toEqual([ENTRY_URL]);
	});

	it("keeps the proxied pass on the entry URL when the direct response is stamped with the entry URL itself", async () => {
		const harness = makeHarness({
			direct: async () => stamped(403, ENTRY_URL),
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(harness.proxyUrls).toEqual([ENTRY_URL]);
	});

	it("keeps both proxied attempts on the frozen terminal across a gateway retry, draining the discarded body", async () => {
		const discarded = gateway(502);
		const harness = makeHarness({
			direct: async (_controller, _clock, onRedirect) => {
				onRedirect?.({ fromUrl: ENTRY_URL, toUrl: DEST_URL });
				return stamped(403, DEST_URL);
			},
			proxy: [
				async (_controller, clock) => {
					clock.nowMs += 10_000;
					return discarded;
				},
				async () => new Response("via proxy", { status: 200 }),
			],
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(harness.proxyUrls).toEqual([DEST_URL, DEST_URL]);
		expect(discarded.bodyUsed).toBe(true);
	});

	it("still delivers the direct pass's redirect hops to the caller's onRedirect", async () => {
		const hops: Array<{ fromUrl: string; toUrl: string }> = [];
		const harness = makeHarness({
			direct: async (_controller, _clock, onRedirect) => {
				onRedirect?.({ fromUrl: ENTRY_URL, toUrl: DEST_URL });
				return new Response("denied", { status: 403 });
			},
			proxy: [async () => new Response("via proxy", { status: 200 })],
		});
		await harness.fetchIt({ onRedirect: (hop) => hops.push(hop) });
		expect(hops).toEqual([{ fromUrl: ENTRY_URL, toUrl: DEST_URL }]);
		expect(harness.proxyUrls).toEqual([DEST_URL]);
	});
});
