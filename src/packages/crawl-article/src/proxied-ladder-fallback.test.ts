import { createCrawlBudget } from "./crawl-budget";
import { withProxiedLadderFallback } from "./proxied-ladder-fallback";
import type { LadderFetch } from "./transport-ladder";

const RESERVE_MILLISECONDS = 45_000;

type Harness = {
	fetchIt: (init?: { headers?: Record<string, string>; totalMs?: number }) => Promise<Response>;
	directBudgets: number[];
	proxyBudgets: number[];
	proxyHeaders: Array<Record<string, string> | undefined>;
};

function makeHarness(opts: {
	direct: (controller: AbortController) => Promise<Response>;
	proxy?: () => Promise<Response>;
}): Harness {
	const directBudgets: number[] = [];
	const proxyBudgets: number[] = [];
	const proxyHeaders: Harness["proxyHeaders"] = [];
	const controller = new AbortController();
	const directFetch: LadderFetch = (_url, init) => {
		directBudgets.push(init.budget.remainingMs());
		return opts.direct(controller);
	};
	const proxyFetch: LadderFetch = (_url, init) => {
		proxyBudgets.push(init.budget.remainingMs());
		proxyHeaders.push(init.headers);
		const proxy = opts.proxy;
		if (proxy === undefined) throw new Error("test wired no proxy answer");
		return proxy();
	};
	const fetchWithProxy = withProxiedLadderFallback({
		directFetch,
		proxyFetch,
		proxyReserveMilliseconds: RESERVE_MILLISECONDS,
		now: Date.now,
	});
	return {
		fetchIt: (init) =>
			fetchWithProxy("https://example.com/article", {
				headers: init?.headers ?? {},
				budget: createCrawlBudget({ signal: controller.signal, totalMs: init?.totalMs ?? 90_000, now: Date.now }),
			}),
		directBudgets,
		proxyBudgets,
		proxyHeaders,
	};
}

function timeout(): Error {
	const error = new Error("leg produced no response within 200ms");
	error.name = "TimeoutError";
	return error;
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
			proxy: async () => new Response("via proxy", { status: 200 }),
		});
		const response = await harness.fetchIt({ headers: { referer: "https://caller.example" } });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("via proxy");
		expect(harness.proxyHeaders).toEqual([{ referer: "https://caller.example" }]);
	});

	it("treats a direct 429 as a datacenter verdict worth overturning", async () => {
		const harness = makeHarness({
			direct: async () => new Response("tarpit", { status: 429 }),
			proxy: async () => new Response("via proxy", { status: 200 }),
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
		expect(harness.proxyBudgets).toHaveLength(1);
	});

	it("returns the proxied answer whatever its status, so a residential 404 wins", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: async () => new Response("gone", { status: 404 }),
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(404);
	});

	it("reaches the proxied pass after a direct-pass deadline (TimeoutError)", async () => {
		const harness = makeHarness({
			direct: async () => {
				throw timeout();
			},
			proxy: async () => new Response("via proxy", { status: 200 }),
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(200);
	});

	it("reaches the proxied pass after a block-class transport error", async () => {
		const harness = makeHarness({
			direct: async () => {
				throw new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR (RST_STREAM)");
			},
			proxy: async () => new Response("via proxy", { status: 200 }),
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
			proxy: async () => {
				throw new Error("proxy connect refused");
			},
		});
		const response = await harness.fetchIt();
		expect(response.status).toBe(403);
	});

	it("surfaces the direct deadline when the proxied pass also fails", async () => {
		const harness = makeHarness({
			direct: async () => {
				throw timeout();
			},
			proxy: async () => {
				throw new Error("proxy connect refused");
			},
		});
		await expect(harness.fetchIt()).rejects.toThrow("leg produced no response within 200ms");
	});

	it("runs direct-only at full budget for a budget too small to seat both passes", async () => {
		const harness = makeHarness({
			direct: async () => new Response("denied", { status: 403 }),
			proxy: async () => new Response("via proxy", { status: 200 }),
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
			proxy: async () => new Response("via proxy", { status: 200 }),
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
			proxy: async () => new Response("via proxy", { status: 200 }),
		});
		await expect(harness.fetchIt()).rejects.toThrow("leg produced no response within 200ms");
		expect(harness.proxyBudgets).toHaveLength(0);
	});
});
