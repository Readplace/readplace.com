import assert from "node:assert/strict";
import net from "node:net";
import { fetch as undiciFetch } from "undici";
import { initCrawlFetch } from "./crawl-fetch";
import { createCrawlBudget, deadlineReason } from "./crawl-budget";
import { CurlFetchFailure } from "./curl-fetch";
import { rejectDocumentLandingPage } from "./document-landing-page";
import { decideFetchFailure } from "./fetch-retry-decision";
import { type Leg, type LegFetch, runTransportLadder } from "./transport-ladder";
import { TransportLadderFailure } from "./transport-ladder-failure";

function codedError(params: { code: string | number; syscall?: string }): Error {
	return Object.assign(new Error(`${params.code} raised`), params);
}

function wrappedInFetchFailed(cause: unknown): Error {
	return new TypeError("fetch failed", { cause });
}

function curlFailure(exitCode: number | string): CurlFetchFailure {
	return new CurlFetchFailure({ url: "https://example.com/", error: codedError({ code: exitCode }) });
}

function killedCurl(signal: string): CurlFetchFailure {
	return new CurlFetchFailure({ url: "https://example.com/", error: Object.assign(new Error("Command failed"), { code: null, killed: true, signal }) });
}

function ladderFailure(legs: readonly unknown[]): TransportLadderFailure {
	return new TransportLadderFailure({ escalatedStatuses: [], error: legs.at(-1), previousErrors: legs.slice(0, -1), retryDisposition: "unclassified" });
}

const liveSignal = () => new AbortController().signal;

const rejectsWith =
	(error: unknown): LegFetch =>
	async () => {
		throw error;
	};

async function ladderRejection(legs: readonly Leg[]): Promise<unknown> {
	const ladder = runTransportLadder({ rejectDocumentLandingPage, legs, logAttempt: () => {}, now: Date.now });
	const budget = createCrawlBudget({ signal: new AbortController().signal, totalMs: 1_000, now: Date.now });
	return ladder("https://example.com/", { headers: {}, budget }).then(
		() => assert.fail("the ladder should have rejected"),
		(error: unknown) => error,
	);
}

describe("decideFetchFailure", () => {
	it.each([
		["a connection reset", codedError({ code: "ECONNRESET" })],
		["an interrupted socket", codedError({ code: "UND_ERR_SOCKET" })],
		["a closed connection", codedError({ code: "UND_ERR_CLOSED" })],
		["an HTTP/2 stream that ended without a response", codedError({ code: "H2_STREAM_ENDED_WITHOUT_RESPONSE" })],
	])("retries %s locally, read from the fetch failure's cause", (_label, cause) => {
		const error = wrappedInFetchFailed(cause);

		const decision = decideFetchFailure({ error, parentSignal: liveSignal() });

		assert.deepEqual(decision, { kind: "retryable", scope: "local", cause: error });
	});

	it.each([
		["an empty reply", 52],
		["a receive error", 56],
	])("retries a curl exit that reports %s locally", (_label, exitCode) => {
		const error = curlFailure(exitCode);

		const decision = decideFetchFailure({ error, parentSignal: liveSignal() });

		assert.deepEqual(decision, { kind: "retryable", scope: "local", cause: error });
	});

	it.each([
		["a header deadline", deadlineReason("no response headers within 30000ms")],
		["a leg deadline", wrappedInFetchFailed(deadlineReason("leg produced no response within 25000ms"))],
		["a body deadline", deadlineReason("body not fully read within 45000ms")],
	])("leaves %s to a durable owner", (_label, error) => {
		const decision = decideFetchFailure({ error, parentSignal: liveSignal() });

		assert.deepEqual(decision, { kind: "retryable", scope: "durable", cause: error });
	});

	it.each(["SIGKILL", "SIGTERM"])("leaves a curl process killed from outside by %s to a durable owner", (signal) => {
		const error = killedCurl(signal);

		assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "retryable", scope: "durable", cause: error });
	});

	it("leaves a fetch whose parent deadline fired to a durable owner", () => {
		const parent = new AbortController();
		parent.abort(deadlineReason("leg produced no response within 25000ms"));
		const error = new Error("aborted");

		const decision = decideFetchFailure({ error, parentSignal: parent.signal });

		assert.deepEqual(decision, { kind: "retryable", scope: "durable", cause: error });
	});

	it("reports a parent abort that is not a deadline as cancelled, with the parent's reason", () => {
		const parent = new AbortController();
		const reason = new Error("superseded");
		parent.abort(reason);

		const decision = decideFetchFailure({ error: codedError({ code: "ECONNRESET" }), parentSignal: parent.signal });

		assert.deepEqual(decision, { kind: "cancelled", cause: reason });
	});

	it.each([
		["a certificate mismatch", wrappedInFetchFailed(codedError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }))],
		["an ALPN refusal", wrappedInFetchFailed(codedError({ code: "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL" }))],
		["a DNS EBUSY", codedError({ code: "EBUSY", syscall: "getaddrinfo" })],
		["an EBUSY that is not DNS", codedError({ code: "EBUSY", syscall: "open" })],
		["a numeric code outside curl", codedError({ code: 52 })],
		["a blocked address", codedError({ code: "EBLOCKEDADDRESS" })],
		["a curl TLS connect error", curlFailure(35)],
		["a curl failure with no exit code", curlFailure("ENOENT")],
		["an unresolved authentication", new Error("401 unauthorized")],
		["a bare fetch failed", wrappedInFetchFailed(undefined)],
		["a generic Error", new Error("Error")],
		["a 503 buried in a message", new Error("upstream answered 503")],
		["a non-Error rejection", "ECONNRESET"],
	])("keeps %s terminal", (_label, error) => {
		const decision = decideFetchFailure({ error, parentSignal: liveSignal() });

		assert.deepEqual(decision, { kind: "terminal", cause: error });
	});

	it.each([
		["a deadline wrapping a certificate mismatch", () => Object.assign(deadlineReason("no response headers within 30000ms"), { cause: codedError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }) }), "durable"],
		["a fetch failed wrapping a deadline that wraps a reset", () => wrappedInFetchFailed(Object.assign(deadlineReason("no response headers within 30000ms"), { cause: codedError({ code: "ECONNRESET" }) })), "durable"],
		["a reset wrapping a ladder whose legs timed out", () => Object.assign(codedError({ code: "ECONNRESET" }), { cause: ladderFailure([deadlineReason("leg produced no response within 25000ms")]) }), "local"],
		["a fetch failed wrapping a ladder whose legs reset", () => wrappedInFetchFailed(ladderFailure([codedError({ code: "ECONNRESET" })])), "durable"],
	] as const)("classifies %s by the outermost link it recognises", (_label, buildError, scope) => {
		const error = buildError();

		assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "retryable", scope, cause: error });
	});

	it.each([
		["a reset wrapping a curl TLS connect error", () => Object.assign(codedError({ code: "ECONNRESET" }), { cause: curlFailure(35) })],
		["a deadline wrapping a curl failure with no exit code", () => Object.assign(deadlineReason("leg produced no response within 25000ms"), { cause: curlFailure("ENOENT") })],
		["a deadline wrapping a ladder with a curl TLS connect leg", () => Object.assign(deadlineReason("leg produced no response within 25000ms"), { cause: ladderFailure([codedError({ code: "ECONNRESET" }), curlFailure(35)]) })],
	] as const)("keeps %s terminal, since a terminal curl exit anywhere in the chain decides it", (_label, buildError) => {
		const error = buildError();

		assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "terminal", cause: error });
	});

	describe("a transport ladder failure, read across every leg it recorded", () => {
		it("is durable when every leg failed on a transient class", () => {
			const error = ladderFailure([
				wrappedInFetchFailed(codedError({ code: "ECONNRESET" })),
				codedError({ code: "H2_STREAM_ENDED_WITHOUT_RESPONSE" }),
				curlFailure(56),
			]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "retryable", scope: "durable", cause: error });
		});

		it("is durable when a leg timed out alongside a transient leg", () => {
			const error = ladderFailure([deadlineReason("leg produced no response within 25000ms"), codedError({ code: "ECONNRESET" })]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "retryable", scope: "durable", cause: error });
		});

		it("is terminal when one recorded leg is not transient", () => {
			const error = ladderFailure([deadlineReason("leg produced no response within 25000ms"), curlFailure(35)]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "terminal", cause: error });
		});

		it("is terminal when a leg failed with a block-class error that wraps a reset", () => {
			const error = ladderFailure([
				Object.assign(new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR"), { cause: codedError({ code: "ECONNRESET" }) }),
				codedError({ code: "ECONNRESET" }),
			]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "terminal", cause: error });
		});

		it("is durable when a curl leg was killed from outside and the other legs reset", () => {
			const error = ladderFailure([codedError({ code: "ECONNRESET" }), killedCurl("SIGKILL")]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "retryable", scope: "durable", cause: error });
		});

		it("reads a ladder nested inside another ladder's legs", () => {
			const error = ladderFailure([ladderFailure([codedError({ code: "ECONNRESET" })]), curlFailure(52)]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "retryable", scope: "durable", cause: error });
		});

		it("is durable when runTransportLadder ends on a curl receive error after transient direct legs", async () => {
			const error = await ladderRejection([
				{ name: "primary", maxRunMs: 100, fetch: rejectsWith(wrappedInFetchFailed(codedError({ code: "ECONNRESET" }))) },
				{ name: "h2", maxRunMs: 100, fetch: rejectsWith(codedError({ code: "H2_STREAM_ENDED_WITHOUT_RESPONSE" })) },
				{ name: "curl", maxRunMs: 100, fetch: rejectsWith(curlFailure(56)) },
			]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "retryable", scope: "durable", cause: error });
		});

		it("is terminal when the primary leg answered 403 and the later legs reset, since the edge is blocking us", async () => {
			const error = await ladderRejection([
				{ name: "primary", maxRunMs: 100, fetch: async () => new Response("denied", { status: 403 }) },
				{ name: "h2", maxRunMs: 100, fetch: rejectsWith(codedError({ code: "ECONNRESET" })) },
				{ name: "curl", maxRunMs: 100, fetch: rejectsWith(wrappedInFetchFailed(codedError({ code: "ECONNRESET" }))) },
			]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "terminal", cause: error });
		});

		it("is durable when the primary leg answered 429 and the later legs reset, since a rate limit asks us to come back later", async () => {
			const error = await ladderRejection([
				{ name: "primary", maxRunMs: 100, fetch: async () => new Response("slow down", { status: 429 }) },
				{ name: "h2", maxRunMs: 100, fetch: rejectsWith(codedError({ code: "ECONNRESET" })) },
				{ name: "curl", maxRunMs: 100, fetch: rejectsWith(wrappedInFetchFailed(codedError({ code: "ECONNRESET" }))) },
			]);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: liveSignal() }), { kind: "retryable", scope: "durable", cause: error });
		});
	});
});

describe("decideFetchFailure on the real direct ladder", () => {
	it("is durable when the primary and HTTP/2 legs meet a server that destroys every connection", async () => {
		const server = net.createServer((socket) => socket.destroy());
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert(address !== null && typeof address === "object", "a TCP server listens on an address");
		const { port } = address;
		const crawlFetch = initCrawlFetch({
			fetch: (input, init) => undiciFetch(String(input), init),
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			egress: { kind: "direct" },
			fetchCurl: async () => {
				throw curlFailure(52);
			},
		});
		const parent = new AbortController();
		try {
			const error = await crawlFetch(`http://127.0.0.1:${port}/`, { budgetMs: 10_000, signal: parent.signal }).then(
				() => assert.fail("the crawl should have rejected"),
				(rejection: unknown) => rejection,
			);

			assert.deepEqual(decideFetchFailure({ error, parentSignal: parent.signal }), { kind: "retryable", scope: "durable", cause: error });
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});
});
