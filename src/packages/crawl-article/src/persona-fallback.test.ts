import {
	type Persona,
	isBlockClassError,
	isBlockClassResponse,
	withPersonaFallback,
} from "./persona-fallback";

const personaPrimary: Persona = {
	name: "primary",
	headers: { "user-agent": "Primary/1.0", accept: "text/html" },
};
const personaFallback: Persona = {
	name: "fallback",
	headers: { "user-agent": "Fallback/1.0", accept: "*/*" },
};

describe("isBlockClassResponse", () => {
	it.each([403, 406, 451])("treats %i as block-class", (status) => {
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
		"fetchCurl failed for https://example.com: Maximum (5) redirects followed",
		"UND_ERR_MAX_REDIRECTS: max_redirects exceeded",
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
		const calls: { headers: Record<string, string> }[] = [];
		const inner: typeof fetch = async (_input, init) => {
			calls.push({ headers: { ...(init?.headers as Record<string, string>) } });
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(calls).toHaveLength(1);
		expect(calls[0].headers["user-agent"]).toBe("Primary/1.0");
	});

	it("advances to the next persona when the response is a block-class status", async () => {
		const calls: { headers: Record<string, string> }[] = [];
		const inner: typeof fetch = async (_input, init) => {
			calls.push({ headers: { ...(init?.headers as Record<string, string>) } });
			if (calls.length === 1) return new Response("blocked", { status: 403 });
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(calls).toHaveLength(2);
		expect(calls[0].headers["user-agent"]).toBe("Primary/1.0");
		expect(calls[1].headers["user-agent"]).toBe("Fallback/1.0");
	});

	it("advances to the next persona when the inner fetch throws a block-class error", async () => {
		const calls: { headers: Record<string, string> }[] = [];
		const inner: typeof fetch = async (_input, init) => {
			calls.push({ headers: { ...(init?.headers as Record<string, string>) } });
			if (calls.length === 1) {
				throw new Error(
					"fetchCurl failed for https://example.com: HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR (err 2)",
				);
			}
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(calls).toHaveLength(2);
	});

	it("propagates a non-block-class error without trying further personas", async () => {
		let attempts = 0;
		const inner: typeof fetch = async () => {
			attempts += 1;
			throw new Error("ENOTFOUND example.com");
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		await expect(wrapped("https://example.com")).rejects.toThrow("ENOTFOUND");
		expect(attempts).toBe(1);
	});

	it("returns the last block-class response when all personas exhaust without throwing", async () => {
		const inner: typeof fetch = async () => new Response("nope", { status: 403 });
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("nope");
	});

	it("throws the last block-class error when all personas throw", async () => {
		let attempts = 0;
		const inner: typeof fetch = async () => {
			attempts += 1;
			throw new Error(`attempt-${attempts}: INTERNAL_ERROR`);
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		await expect(wrapped("https://example.com")).rejects.toThrow("attempt-2: INTERNAL_ERROR");
		expect(attempts).toBe(2);
	});

	it("merges per-request headers on top of persona headers (caller wins)", async () => {
		const calls: { headers: Record<string, string> }[] = [];
		const inner: typeof fetch = async (_input, init) => {
			calls.push({ headers: { ...(init?.headers as Record<string, string>) } });
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary]);

		await wrapped("https://example.com", { headers: { "if-none-match": '"abc"', accept: "application/json" } });

		expect(calls[0].headers["if-none-match"]).toBe('"abc"');
		expect(calls[0].headers.accept).toBe("application/json");
		expect(calls[0].headers["user-agent"]).toBe("Primary/1.0");
	});

	it("preserves the caller's per-request headers across persona iterations", async () => {
		const calls: { headers: Record<string, string> }[] = [];
		const inner: typeof fetch = async (_input, init) => {
			calls.push({ headers: { ...(init?.headers as Record<string, string>) } });
			if (calls.length === 1) return new Response("blocked", { status: 403 });
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary, personaFallback]);

		await wrapped("https://example.com", { headers: { "if-none-match": '"abc"' } });

		expect(calls).toHaveLength(2);
		expect(calls[0].headers["if-none-match"]).toBe('"abc"');
		expect(calls[1].headers["if-none-match"]).toBe('"abc"');
	});

	it("throws when constructed with an empty persona list", () => {
		const inner: typeof fetch = async () => new Response("ok", { status: 200 });
		expect(() => withPersonaFallback(inner, [])).toThrow("at least one persona");
	});

	it("forwards the request signal and input to the inner fetch", async () => {
		const captured: { input: unknown; signal: AbortSignal | undefined }[] = [];
		const inner: typeof fetch = async (input, init) => {
			captured.push({ input, signal: init?.signal ?? undefined });
			return new Response("ok", { status: 200 });
		};
		const wrapped = withPersonaFallback(inner, [personaPrimary]);
		const controller = new AbortController();

		await wrapped("https://example.com/path", { signal: controller.signal });

		expect(captured[0].input).toBe("https://example.com/path");
		expect(captured[0].signal).toBe(controller.signal);
	});
});
