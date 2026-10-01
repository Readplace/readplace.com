import assert from "node:assert/strict";
import http from "node:http";
import type { IsBlockedAddress, ResolveAll } from "./blocked-address-lookup";
import { initFetchRedirectHop } from "./fetch-redirect-hop";

const HEADERS = { "user-agent": "test" };

const allowEverything: IsBlockedAddress = () => false;

const resolveToLoopback: ResolveAll = (_hostname, _options, callback) =>
	callback(null, [{ address: "127.0.0.1", family: 4 }]);

function hasMessage(value: unknown): value is { message: unknown; cause?: unknown } {
	return typeof value === "object" && value !== null && "message" in value;
}

function causeChainMessages(error: unknown): string {
	const messages: string[] = [];
	let current: unknown = error;
	while (hasMessage(current)) {
		messages.push(String(current.message));
		current = current.cause;
	}
	return messages.join(" | ");
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => {
			throw new Error("expected the request to be rejected, but it resolved");
		},
		(error) => error,
	);
}

async function startRedirectServer(location: string): Promise<{
	origin: string;
	requests: () => number;
	close: () => Promise<void>;
}> {
	let requests = 0;
	const server = http.createServer((_req, res) => {
		requests += 1;
		res.writeHead(302, { location });
		res.end("moved");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert(address && typeof address === "object", "expected an AddressInfo from a listening TCP server");
	return {
		origin: `http://127.0.0.1:${address.port}`,
		requests: () => requests,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

describe("initFetchRedirectHop", () => {
	it("performs exactly one request, hands back the 3xx unread and releases its body", async () => {
		const server = await startRedirectServer("https://publisher.example/article");
		const fetchRedirectHop = initFetchRedirectHop({
			fetch: globalThis.fetch,
			isBlocked: allowEverything,
			resolve: resolveToLoopback,
		});
		try {
			const response = await fetchRedirectHop(`${server.origin}/link/1`, {
				headers: HEADERS,
				signal: AbortSignal.timeout(5000),
			});

			assert.equal(response.status, 302);
			assert.equal(response.headers.get("location"), "https://publisher.example/article");
			assert.equal(response.bodyUsed, true);
			assert.equal(server.requests(), 1);
		} finally {
			await server.close();
		}
	});

	it("refuses to connect to a host the block list rejects", async () => {
		const server = await startRedirectServer("https://publisher.example/article");
		const fetchRedirectHop = initFetchRedirectHop({
			fetch: globalThis.fetch,
			isBlocked: () => true,
			resolve: resolveToLoopback,
		});
		try {
			const error = await rejectionOf(
				fetchRedirectHop(`${server.origin}/link/1`, { headers: HEADERS, signal: AbortSignal.timeout(5000) }),
			);

			assert.match(causeChainMessages(error), /resolves to blocked address 127\.0\.0\.1/);
			assert.equal(server.requests(), 0);
		} finally {
			await server.close();
		}
	});

	it("passes the caller's headers and signal through a manual-redirect request on the guarded dispatcher", async () => {
		let captured: RequestInit | undefined;
		const fetchRedirectHop = initFetchRedirectHop({
			fetch: async (_url, init) => {
				captured = init;
				return new Response(null, { status: 301, headers: { location: "/next" } });
			},
			isBlocked: allowEverything,
		});
		const signal = new AbortController().signal;

		const response = await fetchRedirectHop("https://wrapper.example/link/1", { headers: HEADERS, signal });

		assert.equal(response.status, 301);
		assert(captured, "fetch must have been called");
		assert.equal(captured.redirect, "manual");
		assert.equal(captured.headers, HEADERS);
		assert.equal(captured.signal, signal);
		assert("dispatcher" in captured, "the guarded dispatcher must be attached to the request");
	});

	it("refuses a non-HTTP(S) scheme before any request is made", async () => {
		let calls = 0;
		const fetchRedirectHop = initFetchRedirectHop({
			fetch: async () => {
				calls += 1;
				return new Response(null);
			},
			isBlocked: allowEverything,
		});

		await assert.rejects(
			() => fetchRedirectHop("ftp://wrapper.example/link/1", { headers: HEADERS, signal: new AbortController().signal }),
			/refusing to fetch non-HTTP\(S\) scheme "ftp:"/,
		);
		assert.equal(calls, 0);
	});

	it("rejects an unparsable URL before any request is made", async () => {
		let calls = 0;
		const fetchRedirectHop = initFetchRedirectHop({
			fetch: async () => {
				calls += 1;
				return new Response(null);
			},
			isBlocked: allowEverything,
		});

		await assert.rejects(
			() => fetchRedirectHop("not a url", { headers: HEADERS, signal: new AbortController().signal }),
			/Invalid URL/,
		);
		assert.equal(calls, 0);
	});
});
