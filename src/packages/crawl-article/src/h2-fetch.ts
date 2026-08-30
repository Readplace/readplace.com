import http2 from "node:http2";
import type { AssertHostAllowed, SocketLookup } from "./blocked-address-lookup";
import { redirectable } from "./follow-redirects";

type FetchH2Init = {
	headers?: Record<string, string>;
	signal?: AbortSignal;
};

type H2RequestResult = {
	status: number;
	headers: http2.IncomingHttpHeaders;
	body: Buffer;
};

export type FetchH2 = (url: string, init?: FetchH2Init) => Promise<Response>;

/**
 * The optional `lookup` is threaded into every `http2.connect` — the initial
 * request and each redirect hop open a fresh connection — so the SSRF guard
 * rejects any host that resolves to a private/loopback/link-local address.
 * `assertHostAllowed` closes the IP-literal gap `lookup` cannot: http2.connect
 * skips a custom `lookup` for a literal host, so each hop's host is checked here
 * before the connection opens.
 */
export function initFetchH2(deps: { lookup?: SocketLookup; assertHostAllowed?: AssertHostAllowed } = {}): FetchH2 {
	const connectOptions = deps.lookup ? { lookup: deps.lookup } : {};
	const h2SingleHop: FetchH2 = async (url, init) => {
		const parsed = new URL(url);
		deps.assertHostAllowed?.(parsed.hostname);
		const client = http2.connect(parsed.origin, connectOptions);
		try {
			const result = await h2Request(client, parsed, { headers: init?.headers, signal: init?.signal });
			return new Response(result.body, {
				status: result.status,
				headers: toFetchHeaders(result.headers),
			});
		} finally {
			client.close();
		}
	};
	return redirectable(h2SingleHop, "fetchH2");
}

export const fetchH2: FetchH2 = initFetchH2();

function h2Request(
	client: http2.ClientHttp2Session,
	url: URL,
	init: FetchH2Init | undefined,
): Promise<H2RequestResult> {
	return new Promise((resolve, reject) => {
		client.on("error", reject);
		const reqHeaders: http2.OutgoingHttpHeaders = {
			":method": "GET",
			":path": url.pathname + url.search,
		};
		if (init?.headers) {
			for (const [key, value] of Object.entries(init.headers)) {
				reqHeaders[key] = value;
			}
		}
		const req = client.request(reqHeaders);
		req.on("error", reject);
		const signal = init?.signal;
		if (signal) {
			if (signal.aborted) {
				req.close();
				reject(signal.reason);
				return;
			}
			const onAbort = () => {
				req.close();
				reject(signal.reason);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			req.on("close", () => signal.removeEventListener("abort", onAbort));
		}
		let response: { status: number; headers: http2.IncomingHttpHeaders } | undefined;
		req.on("response", (headers) => {
			response = { status: Number(headers[":status"]), headers };
		});
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			if (!response) {
				reject(new Error("HTTP/2 stream ended without a response"));
				return;
			}
			resolve({ ...response, body: Buffer.concat(chunks) });
			/* c8 ignore next -- V8 block-coverage phantom: the range between this listener's closing brace and the next statement gets a spurious zero-count sub-range even though every h2 response reaches it; see bcoe/c8#319 and https://v8.dev/blog/javascript-code-coverage */
		});
		req.end();
	});
}

function toFetchHeaders(incoming: http2.IncomingHttpHeaders): Headers {
	const out = new Headers();
	for (const [key, value] of Object.entries(incoming)) {
		if (key.startsWith(":")) continue;
		if (typeof value !== "string") continue;
		out.set(key, value);
	}
	return out;
}
