import assert from "node:assert/strict";
import { initFetchTrackerHop } from "./fetch-tracker-hop";

const HEADERS = { "user-agent": "test" };
const allowEverything = () => false;

function trackerPage(): Response {
	return new Response('<html><body><a href="/next">Click</a></body></html>', {
		status: 200,
		headers: { "content-type": "text/html" },
	});
}

describe("initFetchTrackerHop", () => {
	it("hands a 200 page's body, status and URL to the page reader and returns its target", async () => {
		const seen: Array<{ status: number; body: string; documentUrl: string }> = [];
		const fetchTrackerHop = initFetchTrackerHop({
			fetch: async () => trackerPage(),
			isBlocked: allowEverything,
			pageTarget: (page) => {
				seen.push({ status: page.response.status, body: page.buffer.toString(), documentUrl: page.documentUrl });
				return "https://tracker.example/next";
			},
		});

		const hop = await fetchTrackerHop("https://tracker.example/c/1", { headers: HEADERS, signal: new AbortController().signal });

		assert.equal(hop.pageTarget, "https://tracker.example/next");
		assert.equal(hop.response.status, 200);
		assert.deepEqual(seen, [
			{
				status: 200,
				body: '<html><body><a href="/next">Click</a></body></html>',
				documentUrl: "https://tracker.example/c/1",
			},
		]);
	});

	it.each([302, 403, 404])("returns a %i unread with no page target", async (status) => {
		let pageReads = 0;
		const fetchTrackerHop = initFetchTrackerHop({
			fetch: async () => new Response("body", { status, headers: { location: "https://publisher.example/a" } }),
			isBlocked: allowEverything,
			pageTarget: () => {
				pageReads += 1;
				return "https://tracker.example/next";
			},
		});

		const hop = await fetchTrackerHop("https://tracker.example/c/1", { headers: HEADERS, signal: new AbortController().signal });

		assert.equal(hop.response.status, status);
		assert.equal(hop.response.bodyUsed, true);
		assert.equal(hop.pageTarget, undefined);
		assert.equal(pageReads, 0);
	});

	it("returns no page target for a 200 whose body outgrows the HTML parse cap", async () => {
		let pageReads = 0;
		const oversized = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(8 * 1024 * 1024));
			},
		});
		const fetchTrackerHop = initFetchTrackerHop({
			fetch: async () => new Response(oversized, { status: 200, headers: { "content-type": "text/html" } }),
			isBlocked: allowEverything,
			pageTarget: () => {
				pageReads += 1;
				return "https://tracker.example/next";
			},
		});

		const hop = await fetchTrackerHop("https://tracker.example/c/1", { headers: HEADERS, signal: new AbortController().signal });

		assert.equal(hop.pageTarget, undefined);
		assert.equal(pageReads, 0);
	});

	it("rethrows a body read failure that is not the size cap", async () => {
		const failing = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(new Error("connection reset"));
			},
		});
		const fetchTrackerHop = initFetchTrackerHop({
			fetch: async () => new Response(failing, { status: 200 }),
			isBlocked: allowEverything,
			pageTarget: () => undefined,
		});

		await assert.rejects(
			() => fetchTrackerHop("https://tracker.example/c/1", { headers: HEADERS, signal: new AbortController().signal }),
			/connection reset/,
		);
	});

	it("passes the caller's headers and signal through a manual-redirect request on the guarded dispatcher", async () => {
		let captured: RequestInit | undefined;
		const fetchTrackerHop = initFetchTrackerHop({
			fetch: async (_url, init) => {
				captured = init;
				return new Response(null, { status: 301, headers: { location: "/next" } });
			},
			isBlocked: allowEverything,
			pageTarget: () => undefined,
		});
		const signal = new AbortController().signal;

		await fetchTrackerHop("https://tracker.example/c/1", { headers: HEADERS, signal });

		assert(captured, "fetch must have been called");
		assert.equal(captured.redirect, "manual");
		assert.equal(captured.headers, HEADERS);
		assert.equal(captured.signal, signal);
		assert("dispatcher" in captured, "the guarded dispatcher must be attached to the request");
	});

	it("refuses a non-HTTP(S) scheme before any request is made", async () => {
		let calls = 0;
		const fetchTrackerHop = initFetchTrackerHop({
			fetch: async () => {
				calls += 1;
				return new Response(null);
			},
			isBlocked: allowEverything,
			pageTarget: () => undefined,
		});

		await assert.rejects(
			() => fetchTrackerHop("ftp://tracker.example/c/1", { headers: HEADERS, signal: new AbortController().signal }),
			/refusing to fetch non-HTTP\(S\) scheme "ftp:"/,
		);
		assert.equal(calls, 0);
	});
});
