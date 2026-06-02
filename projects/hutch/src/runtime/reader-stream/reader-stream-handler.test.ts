import { noopLogger } from "@packages/hutch-logger";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
} from "@packages/test-fixtures/providers/article-crawl";
import {
	extractSessionCookie,
	initReaderStreamHandler,
	parseRequest,
	type ReaderStreamResponse,
} from "./reader-stream-handler";

function captureResponse(): {
	response: ReaderStreamResponse;
	frames: string[];
	headers: Record<string, string> | undefined;
	ended: boolean;
} {
	const frames: string[] = [];
	let headers: Record<string, string> | undefined;
	let ended = false;
	const response: ReaderStreamResponse = {
		write: (frame) => frames.push(frame),
		end: () => { ended = true; },
		setHeaders: (h) => { headers = h; },
	};
	return {
		response,
		frames,
		get headers() { return headers; },
		get ended() { return ended; },
	} as ReturnType<typeof captureResponse>;
}

function withFindArticleCrawlStatus(scripted: Array<ArticleCrawl | undefined>): {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	calls: number;
} {
	let calls = 0;
	const findArticleCrawlStatus: FindArticleCrawlStatus = async () => {
		const value = scripted[Math.min(calls, scripted.length - 1)];
		calls += 1;
		return value;
	};
	return {
		findArticleCrawlStatus,
		get calls() { return calls; },
	} as { findArticleCrawlStatus: FindArticleCrawlStatus; calls: number };
}

const URL = "https://example.com/article";

describe("parseRequest", () => {
	it("returns valid with url + default from=0 when only url is set", () => {
		const result = parseRequest({
			queryString: `url=${encodeURIComponent(URL)}`,
			cookieHeader: undefined,
		});
		expect(result).toEqual({ kind: "valid", url: URL, fromLength: 0 });
	});

	it("returns valid with url + parsed from when both are set", () => {
		const result = parseRequest({
			queryString: `url=${encodeURIComponent(URL)}&from=42`,
			cookieHeader: undefined,
		});
		expect(result).toEqual({ kind: "valid", url: URL, fromLength: 42 });
	});

	it("rejects requests with no url", () => {
		const result = parseRequest({ queryString: "from=10", cookieHeader: undefined });
		expect(result).toEqual({ kind: "invalid", reason: "missing 'url' query param" });
	});

	it("rejects requests where url is unparseable", () => {
		const result = parseRequest({
			queryString: "url=not-a-url",
			cookieHeader: undefined,
		});
		expect(result.kind).toBe("invalid");
	});

	it("rejects requests where the URL scheme is not http(s) (defence: no file://, javascript://, etc.)", () => {
		const result = parseRequest({
			queryString: `url=${encodeURIComponent("javascript:alert(1)")}`,
			cookieHeader: undefined,
		});
		expect(result).toEqual({ kind: "invalid", reason: "url must be http(s)" });
	});

	it("rejects negative from values", () => {
		const result = parseRequest({
			queryString: `url=${encodeURIComponent(URL)}&from=-5`,
			cookieHeader: undefined,
		});
		expect(result.kind).toBe("invalid");
	});

	it("rejects non-numeric from values", () => {
		const result = parseRequest({
			queryString: `url=${encodeURIComponent(URL)}&from=abc`,
			cookieHeader: undefined,
		});
		expect(result.kind).toBe("invalid");
	});
});

describe("extractSessionCookie", () => {
	it("returns the session id from a single-cookie header", () => {
		expect(extractSessionCookie("hutch_sid=abc123")).toBe("abc123");
	});

	it("returns the session id from a multi-cookie header (ignores other names)", () => {
		expect(
			extractSessionCookie("foo=bar; hutch_sid=abc123; baz=qux"),
		).toBe("abc123");
	});

	it("returns undefined when no hutch_sid cookie is present", () => {
		expect(extractSessionCookie("foo=bar; baz=qux")).toBeUndefined();
	});

	it("returns undefined when there is no cookie header at all", () => {
		expect(extractSessionCookie(undefined)).toBeUndefined();
	});

	it("returns undefined for an empty hutch_sid value (defensive)", () => {
		expect(extractSessionCookie("hutch_sid=")).toBeUndefined();
	});

	it("tolerates malformed pairs (no equals sign) and keeps scanning", () => {
		expect(
			extractSessionCookie("malformed; hutch_sid=valid"),
		).toBe("valid");
	});
});

describe("initReaderStreamHandler", () => {
	function makeDeps(opts: {
		scripted: Array<ArticleCrawl | undefined>;
		pollIntervalMs?: number;
		connectionMaxMs?: number;
		getSessionUserId?: (id: string) => Promise<{ userId: string; emailVerified: boolean } | null>;
		now?: () => number;
	}) {
		let nowMs = 0;
		const sleepCalls: number[] = [];
		const sleep = async (ms: number): Promise<void> => {
			sleepCalls.push(ms);
			nowMs += ms;
		};
		const finder = withFindArticleCrawlStatus(opts.scripted);
		const defaultNow = () => nowMs;
		const deps = {
			findArticleCrawlStatus: finder.findArticleCrawlStatus,
			getSessionUserId: opts.getSessionUserId ?? (async () => null),
			logger: noopLogger,
			now: opts.now ?? defaultNow,
			sleep,
			pollIntervalMs: opts.pollIntervalMs ?? 250,
			connectionMaxMs: opts.connectionMaxMs ?? 60_000,
		};
		return { deps, finder, sleepCalls };
	}

	it("returns a 'bad request' frame when the query string is invalid", async () => {
		const { deps } = makeDeps({ scripted: [] });
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: "missing-url=true", cookieHeader: undefined },
			captured.response,
		);

		expect(captured.frames.join("")).toContain("bad request");
		expect(captured.ended).toBe(true);
	});

	it("sets SSE-shaped headers before writing any frames", async () => {
		const { deps } = makeDeps({ scripted: [{ status: "ready" }] });
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		expect(captured.headers).toEqual({
			"content-type": "text/event-stream",
			"cache-control": "no-store",
			"x-accel-buffering": "no",
		});
	});

	it("emits 'event: done' with the terminal status and closes when the row is already ready on first poll", async () => {
		const { deps } = makeDeps({ scripted: [{ status: "ready" }] });
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		expect(captured.frames).toEqual(["event: done\ndata: ready\n\n"]);
		expect(captured.ended).toBe(true);
	});

	it("emits 'event: done' for failed and unsupported terminal states too", async () => {
		const failed = captureResponse();
		const { deps: failedDeps } = makeDeps({
			scripted: [{ status: "failed", reason: "x" }],
		});
		await initReaderStreamHandler(failedDeps)(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			failed.response,
		);
		expect(failed.frames).toEqual(["event: done\ndata: failed\n\n"]);

		const unsupported = captureResponse();
		const { deps: unsupportedDeps } = makeDeps({
			scripted: [{ status: "unsupported", reason: "y" }],
		});
		await initReaderStreamHandler(unsupportedDeps)(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			unsupported.response,
		);
		expect(unsupported.frames).toEqual(["event: done\ndata: unsupported\n\n"]);
	});

	it("emits an 'event: chunk' frame carrying the delta when partial content advances, then 'event: done' on terminal", async () => {
		const { deps } = makeDeps({
			scripted: [
				{ status: "pending", partial: { content: "<p>first</p>", version: 1 } },
				{ status: "pending", partial: { content: "<p>first</p><p>second</p>", version: 2 } },
				{ status: "ready" },
			],
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		// First chunk: entire initial partial.
		expect(captured.frames[0]).toBe(
			`event: chunk\ndata: ${JSON.stringify("<p>first</p>")}\n\n`,
		);
		// Second chunk: delta past the first.
		expect(captured.frames[1]).toBe(
			`event: chunk\ndata: ${JSON.stringify("<p>second</p>")}\n\n`,
		);
		// Terminal.
		expect(captured.frames[2]).toBe("event: done\ndata: ready\n\n");
		expect(captured.ended).toBe(true);
	});

	it("resumes from the client-supplied ?from offset (reconnect path) — only emits content past that point", async () => {
		const { deps } = makeDeps({
			scripted: [
				{ status: "pending", partial: { content: "<p>1234567890</p>", version: 1 } },
				{ status: "ready" },
			],
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}&from=5`, cookieHeader: undefined },
			captured.response,
		);

		// Bytes past offset 5 of "<p>1234567890</p>" = "34567890</p>".
		expect(captured.frames[0]).toBe(
			`event: chunk\ndata: ${JSON.stringify("34567890</p>")}\n\n`,
		);
	});

	it("does NOT re-emit a chunk for the same partial version when polled again", async () => {
		const sameVersion: ArticleCrawl = {
			status: "pending",
			partial: { content: "<p>same</p>", version: 7 },
		};
		const { deps } = makeDeps({ scripted: [sameVersion, sameVersion, { status: "ready" }] });
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		const chunkFrames = captured.frames.filter((f) => f.startsWith("event: chunk"));
		expect(chunkFrames).toHaveLength(1);
	});

	it("sleeps for pollIntervalMs between DDB reads (collapse to one read per tick)", async () => {
		const { deps, sleepCalls } = makeDeps({
			scripted: [{ status: "pending" }, { status: "pending" }, { status: "ready" }],
			pollIntervalMs: 250,
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		// 2 sleeps between 3 reads.
		expect(sleepCalls).toEqual([250, 250]);
	});

	it("emits 'event: reconnect' when the connection cap elapses without a terminal so the client knows where to resume", async () => {
		// Use a row that never terminates and a tight time cap.
		const { deps } = makeDeps({
			scripted: [{ status: "pending", partial: { content: "<p>abc</p>", version: 1 } }],
			pollIntervalMs: 100,
			connectionMaxMs: 350, // 3 sleeps × 100 = 300 < 350; 4th tick exceeds.
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		const last = captured.frames[captured.frames.length - 1];
		expect(last).toMatch(/^event: reconnect\ndata: \d+\n\n$/);
		expect(captured.ended).toBe(true);
	});

	it("looks up the session via getSessionUserId when a cookie is present (auth surface is still wired even though /view is public)", async () => {
		const lookup = jest.fn().mockResolvedValue({ userId: "u_1", emailVerified: true });
		const { deps } = makeDeps({
			scripted: [{ status: "ready" }],
			getSessionUserId: lookup,
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{
				queryString: `url=${encodeURIComponent(URL)}`,
				cookieHeader: "hutch_sid=session-token",
			},
			captured.response,
		);

		expect(lookup).toHaveBeenCalledWith("session-token");
	});

	it("does not call getSessionUserId for anonymous requests (no cookie header)", async () => {
		const lookup = jest.fn();
		const { deps } = makeDeps({
			scripted: [{ status: "ready" }],
			getSessionUserId: lookup,
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		expect(lookup).not.toHaveBeenCalled();
	});

	it("swallows a getSessionUserId error and continues the stream (anonymous fallthrough)", async () => {
		const lookup = jest.fn().mockRejectedValue(new Error("DDB throttled"));
		const { deps } = makeDeps({
			scripted: [{ status: "ready" }],
			getSessionUserId: lookup,
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{
				queryString: `url=${encodeURIComponent(URL)}`,
				cookieHeader: "hutch_sid=token",
			},
			captured.response,
		);

		// Stream still completes successfully.
		expect(captured.frames).toEqual(["event: done\ndata: ready\n\n"]);
	});

	it("swallows a findArticleCrawlStatus error and continues polling", async () => {
		let calls = 0;
		const finder: FindArticleCrawlStatus = async () => {
			calls += 1;
			if (calls === 1) throw new Error("DDB throttled");
			return { status: "ready" };
		};
		const { deps } = makeDeps({ scripted: [] });
		const handler = initReaderStreamHandler({ ...deps, findArticleCrawlStatus: finder });
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		expect(captured.frames).toEqual(["event: done\ndata: ready\n\n"]);
		expect(calls).toBeGreaterThan(1);
	});

	it("does not emit a chunk for an empty partial content (defensive — nothing to send)", async () => {
		const { deps } = makeDeps({
			scripted: [
				{ status: "pending", partial: { content: "", version: 1 } },
				{ status: "ready" },
			],
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{ queryString: `url=${encodeURIComponent(URL)}`, cookieHeader: undefined },
			captured.response,
		);

		const chunkFrames = captured.frames.filter((f) => f.startsWith("event: chunk"));
		expect(chunkFrames).toHaveLength(0);
	});

	it("does not emit a chunk when from=length exactly matches the partial content (no new bytes)", async () => {
		const { deps } = makeDeps({
			scripted: [
				{ status: "pending", partial: { content: "<p>same</p>", version: 1 } },
				{ status: "ready" },
			],
		});
		const handler = initReaderStreamHandler(deps);
		const captured = captureResponse();

		await handler(
			{
				queryString: `url=${encodeURIComponent(URL)}&from=11`,
				cookieHeader: undefined,
			},
			captured.response,
		);

		const chunkFrames = captured.frames.filter((f) => f.startsWith("event: chunk"));
		expect(chunkFrames).toHaveLength(0);
	});
});
