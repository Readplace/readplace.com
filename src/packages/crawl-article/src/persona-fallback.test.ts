import { createCrawlBudget } from "./crawl-budget";
import {
	type Persona,
	isBlockClassError,
	isBlockClassResponse,
	withPersonaFallback,
} from "./persona-fallback";
import type { LadderFetch } from "./transport-ladder";

function liveBudget() {
	return createCrawlBudget({ signal: new AbortController().signal, totalMs: 30_000, now: () => Date.now() });
}

function request(headers: Record<string, string> = {}) {
	return { headers, budget: liveBudget() };
}

const personaPrimary: Persona = {
	name: "primary",
	headers: { "user-agent": "Primary/1.0", accept: "text/html" },
};
const personaFallback: Persona = {
	name: "fallback",
	headers: { "user-agent": "Fallback/1.0", accept: "*/*" },
};

describe("isBlockClassResponse", () => {
	it.each([401, 402, 403, 406, 451, 498])("treats %i as block-class", (status) => {
		expect(isBlockClassResponse(new Response(null, { status }))).toBe(true);
	});

	it.each([200, 301, 404, 429, 500, 503])("treats %i as non-block-class", (status) => {
		expect(isBlockClassResponse(new Response(null, { status }))).toBe(false);
	});
});

describe("isBlockClassError", () => {
	it.each([
		"HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR (err 2)",
		"fetchCurl failed: ... INTERNAL_ERROR (err 2)",
		"NGHTTP2_INTERNAL_ERROR",
		"ERR_HTTP2_STREAM_ERROR: RST_STREAM",
		"ERR_HTTP2_PROTOCOL_ERROR",
		"UND_ERR_MAX_REDIRECTS: max_redirects exceeded",
		"fetchCurl failed for https://example.com: too many redirects (>5)",
	])("treats %j as block-class error", (message) => {
		expect(isBlockClassError(new Error(message))).toBe(true);
	});

	it.each([
		"ENOTFOUND example.com",
		"ECONNREFUSED",
		"socket hang up",
		"The operation was aborted",
	])("treats %j as non-block-class error", (message) => {
		expect(isBlockClassError(new Error(message))).toBe(false);
	});

	it("ignores non-Error throwables", () => {
		expect(isBlockClassError("INTERNAL_ERROR")).toBe(false);
		expect(isBlockClassError({ message: "INTERNAL_ERROR" })).toBe(false);
		expect(isBlockClassError(null)).toBe(false);
	});
});

describe("withPersonaFallback", () => {
	it("returns the first persona's response when it isn't block-class", async () => {
		const calls: Record<string, string>[] = [];
		const inner: LadderFetch = async (_url, init) => {
			calls.push(init.headers);
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		const response = await wrapped("https://example.com", request());

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(calls).toHaveLength(1);
		expect(calls[0]["user-agent"]).toBe("Primary/1.0");
	});

	it.each([402, 403, 498])(
		"advances to the next persona when the response is a block-class %i",
		async (status) => {
			const calls: Record<string, string>[] = [];
			const inner: LadderFetch = async (_url, init) => {
				calls.push(init.headers);
				if (calls.length === 1) return new Response("blocked", { status });
				return new Response("ok", { status: 200 });
			};
			const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

			const response = await wrapped("https://example.com", request());

			expect(response.status).toBe(200);
			expect(calls).toHaveLength(2);
			expect(calls[0]["user-agent"]).toBe("Primary/1.0");
			expect(calls[1]["user-agent"]).toBe("Fallback/1.0");
		},
	);

	it("advances to the next persona when the response is a 401", async () => {
		const calls: Record<string, string>[] = [];
		const inner: LadderFetch = async (_url, init) => {
			calls.push(init.headers);
			if (calls.length === 1) return new Response("Unauthorized", { status: 401 });
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		const response = await wrapped("https://example.com", request());

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(calls).toHaveLength(2);
		expect(calls[0]["user-agent"]).toBe("Primary/1.0");
		expect(calls[1]["user-agent"]).toBe("Fallback/1.0");
	});

	it("advances to the next persona when the inner fetch throws a block-class error", async () => {
		const calls: Record<string, string>[] = [];
		const inner: LadderFetch = async (_url, init) => {
			calls.push(init.headers);
			if (calls.length === 1) {
				throw new Error(
					"fetchCurl failed for https://example.com: HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR (err 2)",
				);
			}
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		const response = await wrapped("https://example.com", request());

		expect(response.status).toBe(200);
		expect(calls).toHaveLength(2);
	});

	it("propagates a non-block-class error without trying further personas", async () => {
		let attempts = 0;
		const inner: LadderFetch = async () => {
			attempts += 1;
			throw new Error("ENOTFOUND example.com");
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		await expect(wrapped("https://example.com", request())).rejects.toThrow("ENOTFOUND");
		expect(attempts).toBe(1);
	});

	it("returns the last block-class response when all personas exhaust without throwing", async () => {
		const inner: LadderFetch = async () => new Response("nope", { status: 403 });
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		const response = await wrapped("https://example.com", request());

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("nope");
	});

	it("throws the last block-class error when all personas throw", async () => {
		let attempts = 0;
		const inner: LadderFetch = async () => {
			attempts += 1;
			throw new Error(`attempt-${attempts}: INTERNAL_ERROR`);
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		await expect(wrapped("https://example.com", request())).rejects.toThrow("attempt-2: INTERNAL_ERROR");
		expect(attempts).toBe(2);
	});

	it("merges per-request headers on top of persona headers (caller wins)", async () => {
		const calls: Record<string, string>[] = [];
		const inner: LadderFetch = async (_url, init) => {
			calls.push(init.headers);
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary]);

		await wrapped("https://example.com", request({ "if-none-match": '"abc"', accept: "application/json" }));

		expect(calls[0]["if-none-match"]).toBe('"abc"');
		expect(calls[0].accept).toBe("application/json");
		expect(calls[0]["user-agent"]).toBe("Primary/1.0");
	});

	it("preserves the caller's per-request headers across persona iterations", async () => {
		const calls: Record<string, string>[] = [];
		const inner: LadderFetch = async (_url, init) => {
			calls.push(init.headers);
			if (calls.length === 1) return new Response("blocked", { status: 403 });
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		await wrapped("https://example.com", request({ "if-none-match": '"abc"' }));

		expect(calls).toHaveLength(2);
		expect(calls[0]["if-none-match"]).toBe('"abc"');
		expect(calls[1]["if-none-match"]).toBe('"abc"');
	});

	it("throws when constructed with an empty persona list", () => {
		const inner: LadderFetch = async () => new Response("ok", { status: 200 });
		expect(() => withPersonaFallback(inner, [])).toThrow("at least one persona");
	});

	it("forwards the url and the caller's budget to the inner fetch", async () => {
		const captured: { url: string; budget: unknown }[] = [];
		const inner: LadderFetch = async (url, init) => {
			captured.push({ url, budget: init.budget });
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary]);
		const init = request();

		await wrapped("https://example.com/path", init);

		expect(captured[0].url).toBe("https://example.com/path");
		expect(captured[0].budget).toBe(init.budget);
	});
});
