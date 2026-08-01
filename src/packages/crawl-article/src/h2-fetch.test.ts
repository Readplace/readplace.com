import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import type { CurlFetch } from "./curl-fetch";
import { fetchH2, withH2Fallback } from "./h2-fetch";

/** withH2Fallback now requires an explicit curl impl. Tests whose path never
 * reaches curl pass this throwing stub so an accidental invocation fails loud. */
const stubCurl: CurlFetch = async () => {
	throw new Error("stubCurl: not expected to be called");
};

type StreamHandler = (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void;

async function startH2Server(handler: StreamHandler): Promise<{ origin: string; close: () => Promise<void> }> {
	const server = http2.createServer();
	server.on("stream", handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

describe("fetchH2 — against a local HTTP/2 server", () => {
	it("returns a Response with body and headers for a 200", async () => {
		const server = await startH2Server((stream) => {
			stream.respond({ ":status": 200, "content-type": "text/html", etag: '"abc"' });
			stream.end("<html>hi</html>");
		});
		try {
			const response = await fetchH2(`${server.origin}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("text/html");
			expect(response.headers.get("etag")).toBe('"abc"');
			expect(await response.text()).toBe("<html>hi</html>");
		} finally {
			await server.close();
		}
	});

	it("forwards request headers from init.headers", async () => {
		let capturedUa: string | undefined;
		const server = await startH2Server((stream, headers) => {
			capturedUa = typeof headers["user-agent"] === "string" ? headers["user-agent"] : undefined;
			stream.respond({ ":status": 200, "content-type": "text/html" });
			stream.end("<html></html>");
		});
		try {
			await fetchH2(`${server.origin}/`, { headers: { "user-agent": "TestAgent/1.0" } });
			expect(capturedUa).toBe("TestAgent/1.0");
		} finally {
			await server.close();
		}
	});

	it("follows 301 redirects to the final destination", async () => {
		const server = await startH2Server((stream, headers) => {
			if (headers[":path"] === "/start") {
				stream.respond({ ":status": 301, location: "/final" });
				stream.end();
				return;
			}
			stream.respond({ ":status": 200, "content-type": "text/html" });
			stream.end("<html>final</html>");
		});
		try {
			const response = await fetchH2(`${server.origin}/start`);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("<html>final</html>");
		} finally {
			await server.close();
		}
	});

	it("throws after more than 5 consecutive redirects", async () => {
		const server = await startH2Server((stream, headers) => {
			const match = typeof headers[":path"] === "string" ? headers[":path"].match(/\/hop(\d+)/) : null;
			const n = match ? Number(match[1]) : 0;
			stream.respond({ ":status": 302, location: `/hop${n + 1}` });
			stream.end();
		});
		try {
			await expect(fetchH2(`${server.origin}/hop0`)).rejects.toThrow(/too many redirects/);
		} finally {
			await server.close();
		}
	});

	it("rejects immediately if the signal is already aborted", async () => {
		const server = await startH2Server((stream) => {
			stream.respond({ ":status": 200, "content-type": "text/html" });
			stream.end("<html></html>");
		});
		try {
			const controller = new AbortController();
			controller.abort(new Error("already aborted"));
			await expect(fetchH2(`${server.origin}/`, { signal: controller.signal })).rejects.toThrow("already aborted");
		} finally {
			await server.close();
		}
	});

	it("rejects when the signal aborts mid-request", async () => {
		const server = await startH2Server((stream) => {
			// Never respond — keeps the stream open so we can abort it.
			stream.on("close", () => {});
		});
		try {
			const controller = new AbortController();
			const promise = fetchH2(`${server.origin}/`, { signal: controller.signal });
			setImmediate(() => controller.abort(new Error("mid-flight abort")));
			await expect(promise).rejects.toThrow("mid-flight abort");
		} finally {
			await server.close();
		}
	});

	it("rejects — without the failure escaping as an uncaughtException — when the stream ends before any response", async () => {
		const server = await startH2Server((stream) => stream.close(http2.constants.NGHTTP2_NO_ERROR));
		const escaped: unknown[] = [];
		const captureEscaped = (error: unknown) => escaped.push(error);
		process.on("uncaughtException", captureEscaped);
		try {
			await expect(fetchH2(`${server.origin}/`)).rejects.toThrow("HTTP/2 stream ended without a response");
			expect(escaped).toEqual([]);
		} finally {
			process.off("uncaughtException", captureEscaped);
			await server.close();
		}
	});
});

/**
 * Integration cover for the followRedirects behaviors that are transport-agnostic
 * in principle but only take effect if fetchH2 wires the shared loop correctly.
 * follow-redirects.test.ts owns the exhaustive edge cases against a fake hop; these
 * exercise the same behaviors end-to-end through the real HTTP/2 client so a future
 * change to fetchH2's wiring (e.g. resolving against the origin again, or handing
 * headers straight to the transport) fails here, not just in the shared unit.
 */
describe("fetchH2 — shared followRedirects behaviors through the real client", () => {
	it("resolves a path-relative Location against the current hop's directory, not the origin", async () => {
		let landedPath: string | undefined;
		const server = await startH2Server((stream, headers) => {
			if (headers[":path"] === "/current/path") {
				stream.respond({ ":status": 302, location: "sub/page" });
				stream.end();
				return;
			}
			landedPath = typeof headers[":path"] === "string" ? headers[":path"] : undefined;
			stream.respond({ ":status": 200, "content-type": "text/html" });
			stream.end("<html>landed</html>");
		});
		try {
			const response = await fetchH2(`${server.origin}/current/path`);
			expect(response.status).toBe(200);
			expect(landedPath).toBe("/current/sub/page");
		} finally {
			await server.close();
		}
	});

	it("drops cookie/authorization but keeps other headers when a redirect crosses origins", async () => {
		let destHeaders: http2.IncomingHttpHeaders | undefined;
		const dest = await startH2Server((stream, headers) => {
			destHeaders = headers;
			stream.respond({ ":status": 200, "content-type": "text/html" });
			stream.end("<html>dest</html>");
		});
		const start = await startH2Server((stream) => {
			stream.respond({ ":status": 301, location: `${dest.origin}/dest` });
			stream.end();
		});
		try {
			await fetchH2(`${start.origin}/start`, {
				headers: { cookie: "s=secret", authorization: "Bearer t", "user-agent": "Persona/1.0" },
			});
			expect(destHeaders?.cookie).toBeUndefined();
			expect(destHeaders?.authorization).toBeUndefined();
			expect(destHeaders?.["user-agent"]).toBe("Persona/1.0");
		} finally {
			await start.close();
			await dest.close();
		}
	});

	it("refuses to follow a redirect to a non-HTTP(S) scheme", async () => {
		const server = await startH2Server((stream) => {
			stream.respond({ ":status": 301, location: "gopher://127.0.0.1:70/1payload" });
			stream.end();
		});
		try {
			await expect(fetchH2(`${server.origin}/start`)).rejects.toThrow(
				/fetchH2 failed for .*: refusing to follow redirect to non-HTTP\(S\) scheme "gopher:"/,
			);
		} finally {
			await server.close();
		}
	});
});

describe("withH2Fallback", () => {
	it("passes through non-403 responses unchanged", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>();
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html></html>");
		expect(h2Impl).not.toHaveBeenCalled();
	});

	it("retries via h2 on a 403 from a non-Cloudflare origin (e.g. Reddit/Fastly snooserv)", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("Forbidden", { status: 403, headers: { server: "snooserv" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html>h2 bypassed snooserv</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>h2 bypassed snooserv</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
	});

	it("retries via h2 when Cloudflare returns a managed challenge", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge page", {
				status: 403,
				headers: { server: "cloudflare", "cf-mitigated": "challenge" },
			});
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html>real</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		const signal = AbortSignal.timeout(5000);
		const response = await wrapped("https://example.com", {
			headers: { "user-agent": "Test/1.0", accept: "text/html" },
			signal,
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>real</html>");
		// h2 no longer gets the caller's signal directly — it gets a deadline-bounded
		// signal derived from it, so the h2 leg cannot outlive its own budget.
		expect(h2Impl).toHaveBeenCalledWith("https://example.com", {
			headers: { "user-agent": "Test/1.0", accept: "text/html" },
			signal: expect.any(AbortSignal),
		});
	});

	it("retries via h2 on a plain Cloudflare 403 interstitial (no cf-mitigated header)", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("<html><title>Attention Required! | Cloudflare</title></html>", {
				status: 403,
				headers: { server: "cloudflare" },
			});
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html>real</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>real</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
	});

	it("retries via h2 on a 429 bot-score verdict (e.g. LinkedIn via Cloudflare)", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("Too Many Requests", { status: 429, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html>h2 bypassed the 429</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>h2 bypassed the 429</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
	});

	it("escalates to curl when h2 also returns 429", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("Too Many Requests", { status: 429, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("Too Many Requests", { status: 429, headers: { server: "cloudflare" } }),
		);
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("<html>curl bypassed the 429</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>curl bypassed the 429</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).toHaveBeenCalledTimes(1);
	});

	it("retries via h2 on a 401 bot-deny (e.g. reuters.com via CloudFront)", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("Unauthorized", { status: 401, headers: { server: "CloudFront" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html>h2 bypassed the 401</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>h2 bypassed the 401</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
	});

	it("escalates to curl when h2 also returns 401", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("Unauthorized", { status: 401, headers: { server: "CloudFront" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("Unauthorized", { status: 401, headers: { server: "CloudFront" } }),
		);
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("<html>curl bypassed the 401</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>curl bypassed the 401</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).toHaveBeenCalledTimes(1);
	});

	it("retries via h2 on a 403 even when the server header is missing", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("Forbidden", { status: 403 });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(h2Impl).toHaveBeenCalledTimes(1);
	});

	it("extracts the URL string from a URL object input", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		await wrapped(new URL("https://example.com/page?q=1"));

		expect(h2Impl).toHaveBeenCalledWith("https://example.com/page?q=1", expect.anything());
	});

	it("extracts the URL from a Request input", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		await wrapped(new Request("https://example.com/other"));

		expect(h2Impl).toHaveBeenCalledWith("https://example.com/other", expect.anything());
	});

	it("normalizes a Headers instance in init.headers to a plain object before passing to h2", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		const headers = new Headers();
		headers.set("user-agent", "Test/1.0");
		headers.set("accept-language", "en-US");
		await wrapped("https://example.com", { headers });

		expect(h2Impl).toHaveBeenCalledWith("https://example.com", {
			headers: { "user-agent": "Test/1.0", "accept-language": "en-US" },
			signal: expect.any(AbortSignal),
		});
	});

	it("passes undefined headers to h2 when init is omitted", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, stubCurl);

		await wrapped("https://example.com");

		expect(h2Impl).toHaveBeenCalledWith("https://example.com", {
			headers: undefined,
			signal: expect.any(AbortSignal),
		});
	});

	it("composes into a callable fetch from the supplied h2 and curl impls", () => {
		const baseFetch: typeof fetch = async () => new Response("ok", { status: 200 });
		const wrapped = withH2Fallback(baseFetch, fetchH2, stubCurl);
		expect(typeof wrapped).toBe("function");
	});

	it("falls back to curl when h2 throws a protocol error", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () => {
			throw new Error("ERR_HTTP2_ERROR: Protocol error");
		});
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("<html>curl worked</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://example.com", {
			headers: { "user-agent": "Test/1.0" },
			signal: AbortSignal.timeout(5000),
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>curl worked</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).toHaveBeenCalledWith("https://example.com", {
			headers: { "user-agent": "Test/1.0" },
			signal: expect.any(AbortSignal),
		});
	});

	it("escalates to curl when h2 also returns 403 (e.g. old.reddit.com blocks both undici and Node http2)", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("Forbidden", { status: 403, headers: { server: "snooserv" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("Forbidden", { status: 403, headers: { server: "snooserv" } }),
		);
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("<html>curl bypassed snooserv</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://old.reddit.com/r/javascript/comments/abc");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>curl bypassed snooserv</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).toHaveBeenCalledTimes(1);
	});

	it("does not invoke curl when h2 succeeds", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html>h2 ok</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>h2 ok</html>");
		expect(curlImpl).not.toHaveBeenCalled();
	});

	it.each(["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"])(
		"propagates %s without falling back to curl since the network is unreachable",
		async (code) => {
			const baseFetch: typeof fetch = async () =>
				new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
			const networkError = Object.assign(new Error(`getaddrinfo ${code} example.com`), { code });
			const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () => {
				throw networkError;
			});
			const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
			const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

			await expect(wrapped("https://example.com")).rejects.toBe(networkError);
			expect(curlImpl).not.toHaveBeenCalled();
		},
	);

	it("propagates an abort without falling back to curl", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const controller = new AbortController();
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () => {
			controller.abort(new Error("aborted"));
			throw new Error("aborted");
		});
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		await expect(wrapped("https://example.com", { signal: controller.signal })).rejects.toThrow("aborted");
		expect(curlImpl).not.toHaveBeenCalled();
	});

	it("propagates the caller's timeout that fires during the h2 attempt instead of giving curl a fresh timer", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const controller = new AbortController();
		const reason = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () => {
			controller.abort(reason);
			throw reason;
		});
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		await expect(
			wrapped("https://example.com", { headers: { "user-agent": "Test/1.0" }, signal: controller.signal }),
		).rejects.toBe(reason);
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).not.toHaveBeenCalled();
	});

	it("propagates the caller's abort from the block-class response path without entering h2 or curl", async () => {
		const controller = new AbortController();
		const reason = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
		const baseFetch: typeof fetch = async () => {
			controller.abort(reason);
			return new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		};
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>();
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		await expect(wrapped("https://example.com", { signal: controller.signal })).rejects.toBe(reason);
		expect(h2Impl).not.toHaveBeenCalled();
		expect(curlImpl).not.toHaveBeenCalled();
	});

	it("falls back to curl when h2 throws a non-Error value", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () => {
			throw "string-error";
		});
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(curlImpl).toHaveBeenCalledTimes(1);
	});

	it("propagates a caller timeout on the primary leg without trying h2 or curl", async () => {
		const controller = new AbortController();
		const reason = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
		controller.abort(reason);
		const baseFetch: typeof fetch = async () => {
			throw reason;
		};
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>();
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		await expect(
			wrapped("https://hex.ooo/page.html", { headers: { "user-agent": "Test/1.0" }, signal: controller.signal }),
		).rejects.toBe(reason);
		expect(h2Impl).not.toHaveBeenCalled();
		expect(curlImpl).not.toHaveBeenCalled();
	});

	it("propagates baseFetch error when signal is explicitly aborted (not timeout)", async () => {
		const controller = new AbortController();
		controller.abort(new Error("user cancelled"));
		const baseFetch: typeof fetch = async () => {
			throw new Error("user cancelled");
		};
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
		const wrapped = withH2Fallback(baseFetch, jest.fn(), curlImpl);

		await expect(wrapped("https://example.com", { signal: controller.signal })).rejects.toThrow("user cancelled");
		expect(curlImpl).not.toHaveBeenCalled();
	});

	it.each(["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"])(
		"propagates baseFetch %s error without falling back to curl",
		async (code) => {
			const networkError = Object.assign(new Error(`connect ${code}`), { code });
			const baseFetch: typeof fetch = async () => {
				throw networkError;
			};
			const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
			const wrapped = withH2Fallback(baseFetch, jest.fn(), curlImpl);

			await expect(wrapped("https://example.com")).rejects.toBe(networkError);
			expect(curlImpl).not.toHaveBeenCalled();
		},
	);

	it("tries h2 then falls back to curl on a connection-mid-request error (e.g. socket hangup) even with no signal", async () => {
		const socketError = new Error("socket hang up");
		const baseFetch: typeof fetch = async () => {
			throw socketError;
		};
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () => {
			throw new Error("h2 also failed");
		});
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("<html>curl recovered</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://example.com");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>curl recovered</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).toHaveBeenCalledWith("https://example.com", {
			headers: undefined,
			signal: undefined,
		});
	});

	it("tries h2 then falls back to curl when the primary fetch throws a generic 'fetch failed'", async () => {
		const fetchFailed = new TypeError("fetch failed");
		const baseFetch: typeof fetch = async () => {
			throw fetchFailed;
		};
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () => {
			throw new Error("h2 also failed");
		});
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("ok", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://hex.ooo/library/last_question.html", {
			signal: AbortSignal.timeout(5000),
			headers: { "user-agent": "Test/1.0" },
		});

		expect(response.status).toBe(200);
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).toHaveBeenCalledWith("https://hex.ooo/library/last_question.html", {
			headers: { "user-agent": "Test/1.0" },
			signal: expect.any(AbortSignal),
		});
	});

	it("succeeds via h2 when baseFetch throws (e.g. Akamai RST_STREAM) and h2 bypasses the block", async () => {
		const rstError = new Error("INTERNAL_ERROR: HTTP/2 stream closed");
		const baseFetch: typeof fetch = async () => {
			throw rstError;
		};
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("<html>h2 bypassed akamai</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>();
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		const response = await wrapped("https://example.gov/file.pdf", {
			headers: { "user-agent": "Test/1.0" },
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>h2 bypassed akamai</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).not.toHaveBeenCalled();
	});

	it("bounds the h2 attempt with its own deadline and falls back to curl when it stalls", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		// Hangs until its own signal aborts — i.e. only the h2 deadline can end it.
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
				}),
		);
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("<html>curl after h2 deadline</html>", { status: 200, headers: { "content-type": "text/html" } }),
		);
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl, 20);

		const response = await wrapped("https://example.com", { headers: { "user-agent": "Test/1.0" } });

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>curl after h2 deadline</html>");
		expect(h2Impl).toHaveBeenCalledTimes(1);
		expect(curlImpl).toHaveBeenCalledTimes(1);
	});

	it("attaches the failed h2 error as the cause of the curl error so the masked leg is not lost", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Failure = new Error("ERR_HTTP2_ERROR: Protocol error");
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () => {
			throw h2Failure;
		});
		const curlFailure = new Error("fetchCurl failed for https://example.com: spawn curl_chrome131 ENOENT");
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () => {
			throw curlFailure;
		});
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		await expect(wrapped("https://example.com")).rejects.toBe(curlFailure);
		// The curl message is untouched (persona-fallback still matches it), but the
		// h2 error it masked now rides on `.cause`.
		expect(curlFailure.cause).toBe(h2Failure);
	});

	it("leaves the curl error's cause unset when there was no h2 error (h2 returned a block-class response)", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("still blocked", { status: 403, headers: { server: "cloudflare" } }),
		);
		const curlFailure = new Error("fetchCurl failed for https://example.com: exit 92");
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () => {
			throw curlFailure;
		});
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		await expect(wrapped("https://example.com")).rejects.toBe(curlFailure);
		expect(curlFailure.cause).toBeUndefined();
	});

	it("escalates to curl when a real h2 stream ends before any response", async () => {
		const server = await startH2Server((stream) => stream.close(http2.constants.NGHTTP2_NO_ERROR));
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () =>
			new Response("<html>curl after a headerless h2 stream</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			}),
		);
		const wrapped = withH2Fallback(baseFetch, fetchH2, curlImpl);
		try {
			const response = await wrapped(`${server.origin}/`);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("<html>curl after a headerless h2 stream</html>");
			expect(curlImpl).toHaveBeenCalledTimes(1);
		} finally {
			await server.close();
		}
	});

	it("propagates a non-Error curl rejection unchanged (no cause to attach)", async () => {
		const baseFetch: typeof fetch = async () =>
			new Response("challenge", { status: 403, headers: { server: "cloudflare" } });
		const h2Impl = jest.fn<ReturnType<typeof fetchH2>, Parameters<typeof fetchH2>>(async () =>
			new Response("still blocked", { status: 403, headers: { server: "cloudflare" } }),
		);
		const curlImpl = jest.fn<ReturnType<CurlFetch>, Parameters<CurlFetch>>(async () => {
			throw "raw curl string failure";
		});
		const wrapped = withH2Fallback(baseFetch, h2Impl, curlImpl);

		await expect(wrapped("https://example.com")).rejects.toBe("raw curl string failure");
	});
});
