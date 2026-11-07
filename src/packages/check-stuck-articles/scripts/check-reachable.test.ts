import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterReachable, isReachable } from "./check-reachable";

const NOOP_LOG = () => {};

function fetchResolving(status: number): typeof fetch {
	return async () => new Response(null, { status });
}

function fetchThrowing(error: unknown): typeof fetch {
	return async () => {
		throw error;
	};
}

describe("isReachable", () => {
	it("returns true for HTTP 200", async () => {
		const ok = await isReachable("https://example.test/", {
			fetch: fetchResolving(200),
			timeoutMs: 1000,
		});
		assert.equal(ok, true);
	});

	it("returns true for HTTP 404 (any HTTP response counts as reachable)", async () => {
		const ok = await isReachable("https://example.test/", {
			fetch: fetchResolving(404),
			timeoutMs: 1000,
		});
		assert.equal(ok, true);
	});

	it("returns true for HTTP 503", async () => {
		const ok = await isReachable("https://example.test/", {
			fetch: fetchResolving(503),
			timeoutMs: 1000,
		});
		assert.equal(ok, true);
	});

	it("returns false on DNS failure (ENOTFOUND)", async () => {
		const error = Object.assign(new TypeError("fetch failed"), {
			cause: { code: "ENOTFOUND" },
		});
		const ok = await isReachable("https://cd.home.arpa/", {
			fetch: fetchThrowing(error),
			timeoutMs: 1000,
		});
		assert.equal(ok, false);
	});

	it("returns false on connection refused (ECONNREFUSED)", async () => {
		const error = Object.assign(new TypeError("fetch failed"), {
			cause: { code: "ECONNREFUSED" },
		});
		const ok = await isReachable("https://example.test/", {
			fetch: fetchThrowing(error),
			timeoutMs: 1000,
		});
		assert.equal(ok, false);
	});

	it("returns false on timeout (AbortError)", async () => {
		const error = new DOMException("The operation was aborted.", "TimeoutError");
		const ok = await isReachable("https://example.test/", {
			fetch: fetchThrowing(error),
			timeoutMs: 1000,
		});
		assert.equal(ok, false);
	});

	it("returns false on TLS error", async () => {
		const error = Object.assign(new TypeError("fetch failed"), {
			cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
		});
		const ok = await isReachable("https://example.test/", {
			fetch: fetchThrowing(error),
			timeoutMs: 1000,
		});
		assert.equal(ok, false);
	});

	it("calls fetch with HEAD method, follow redirects, and AbortSignal", async () => {
		const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
		const fakeFetch: typeof fetch = async (url, init) => {
			calls.push({ url: String(url), init });
			return new Response(null, { status: 200 });
		};
		await isReachable("https://example.test/", {
			fetch: fakeFetch,
			timeoutMs: 5000,
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.init?.method, "HEAD");
		assert.equal(calls[0]?.init?.redirect, "follow");
		assert.ok(calls[0]?.init?.signal instanceof AbortSignal);
	});
});

describe("filterReachable", () => {
	it("returns empty array for empty input and does not log", async () => {
		const logged: string[] = [];
		const result = await filterReachable([], {
			fetch: fetchResolving(200),
			timeoutMs: 1000,
			concurrency: 4,
			skipProbe: () => false,
			log: (msg) => logged.push(msg),
		});
		assert.deepEqual(result, []);
		assert.deepEqual(logged, []);
	});

	it("keeps all rows when all reachable and does not log", async () => {
		const logged: string[] = [];
		const rows = [
			{ originalUrl: "https://a.test/", n: 1 },
			{ originalUrl: "https://b.test/", n: 2 },
		];
		const result = await filterReachable(rows, {
			fetch: fetchResolving(200),
			timeoutMs: 1000,
			concurrency: 4,
			skipProbe: () => false,
			log: (msg) => logged.push(msg),
		});
		assert.deepEqual(result, rows);
		assert.deepEqual(logged, []);
	});

	it("filters out unreachable rows and logs the excluded count", async () => {
		const logged: string[] = [];
		const rows = [
			{ originalUrl: "https://reachable.test/", n: 1 },
			{ originalUrl: "https://dead.test/", n: 2 },
			{ originalUrl: "https://also-reachable.test/", n: 3 },
		];
		const fakeFetch: typeof fetch = async (url) => {
			if (String(url).includes("dead")) {
				throw Object.assign(new TypeError("fetch failed"), {
					cause: { code: "ENOTFOUND" },
				});
			}
			return new Response(null, { status: 200 });
		};
		const result = await filterReachable(rows, {
			fetch: fakeFetch,
			timeoutMs: 1000,
			concurrency: 4,
			skipProbe: () => false,
			log: (msg) => logged.push(msg),
		});
		assert.deepEqual(result, [
			{ originalUrl: "https://reachable.test/", n: 1 },
			{ originalUrl: "https://also-reachable.test/", n: 3 },
		]);
		assert.deepEqual(logged, ["[info] excluded 1 row(s) as unreachable"]);
	});

	it("returns empty when all rows are unreachable and logs the excluded count", async () => {
		const logged: string[] = [];
		const rows = [
			{ originalUrl: "https://dead-1.test/" },
			{ originalUrl: "https://dead-2.test/" },
		];
		const result = await filterReachable(rows, {
			fetch: fetchThrowing(
				Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
			),
			timeoutMs: 1000,
			concurrency: 4,
			skipProbe: () => false,
			log: (msg) => logged.push(msg),
		});
		assert.deepEqual(result, []);
		assert.deepEqual(logged, ["[info] excluded 2 row(s) as unreachable"]);
	});

	it("keeps a row whose probe is skipped without fetching it, while a throwing public row is dropped", async () => {
		const fetched: string[] = [];
		const privateRow = {
			originalUrl: "https://uploads.readplace.invalid/upload-1",
			ownerUserId: "user-1",
		};
		const publicRow = { originalUrl: "https://dead.test/", ownerUserId: undefined };
		const fakeFetch: typeof fetch = async (url) => {
			fetched.push(String(url));
			throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
		};
		const result = await filterReachable([privateRow, publicRow], {
			fetch: fakeFetch,
			timeoutMs: 1000,
			concurrency: 4,
			skipProbe: (row) => row.ownerUserId !== undefined,
			log: NOOP_LOG,
		});
		assert.deepEqual(fetched, ["https://dead.test/"]);
		assert.deepEqual(result, [privateRow]);
	});

	it("respects the concurrency bound", async () => {
		let inFlight = 0;
		let peakInFlight = 0;
		const fakeFetch: typeof fetch = async () => {
			inFlight++;
			peakInFlight = Math.max(peakInFlight, inFlight);
			await Promise.resolve();
			await Promise.resolve();
			inFlight--;
			return new Response(null, { status: 200 });
		};
		const rows = Array.from({ length: 20 }, (_, i) => ({
			originalUrl: `https://example.test/${i}`,
		}));
		await filterReachable(rows, {
			fetch: fakeFetch,
			timeoutMs: 1000,
			concurrency: 5,
			skipProbe: () => false,
			log: NOOP_LOG,
		});
		assert.ok(
			peakInFlight <= 5,
			`peak in-flight ${peakInFlight} should be <= 5 (concurrency bound)`,
		);
		assert.ok(
			peakInFlight >= 2,
			`peak in-flight ${peakInFlight} should be >= 2 (parallelism actually happens)`,
		);
	});

	it("preserves row identity (generic over T)", async () => {
		const rows = [
			{ originalUrl: "https://a.test/", reasons: ["summary-pending"] as const, extra: 42 },
		];
		const result = await filterReachable(rows, {
			fetch: fetchResolving(200),
			timeoutMs: 1000,
			concurrency: 4,
			skipProbe: () => false,
			log: NOOP_LOG,
		});
		assert.equal(result[0]?.extra, 42);
		assert.deepEqual(result[0]?.reasons, ["summary-pending"]);
	});
});
