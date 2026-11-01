import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { fetchH2 } from "./h2-fetch";

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
