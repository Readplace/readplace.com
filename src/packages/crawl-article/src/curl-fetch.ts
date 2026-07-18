import { execFile } from "node:child_process";
import { isIP } from "node:net";
import {
	createPinnedAddressResolver,
	type IsBlockedAddress,
	type ResolveAll,
	type ResolvePinnedAddress,
} from "./blocked-address-lookup";
import { redirectable } from "./follow-redirects";
import { MAX_PDF_BYTES } from "./pdf-page-limits";

const DEFAULT_TIMEOUT_MS = 10000;

type CurlFetchInit = {
	headers?: Record<string, string>;
	signal?: AbortSignal;
};

type CurlChild = {
	kill: () => void;
	onClose: (listener: () => void) => void;
};

export type ExecCurl = (
	args: readonly string[],
	callback: (error: Error | null, stdout: Buffer) => void,
) => CurlChild;

export type CurlFetch = (url: string, init?: CurlFetchInit) => Promise<Response>;

/**
 * Binary name for the curl-impersonate Chrome variant. Lambda layers mount at
 * /opt/ and Lambda adds /opt/bin to PATH, so the bare binary name resolves
 * without a full path on both Lambda (layer) and container-image runtimes.
 */
export const CURL_IMPERSONATE_BIN = "curl_chrome131";

/* c8 ignore start -- thin execFile wrapper that spawns the curl-impersonate subprocess; createCurlFetch is unit-tested with a fake execCurl, this default impl is exercised via integration and the crawl source-health canary */
const defaultExecCurl: ExecCurl = (args, callback) => {
	const child = execFile(
		CURL_IMPERSONATE_BIN,
		args,
		{ encoding: "buffer", maxBuffer: MAX_PDF_BYTES.bytes },
		callback,
	);
	return {
		kill: () => {
			child.kill();
		},
		onClose: (listener) => {
			child.on("close", listener);
		},
	};
};
/* c8 ignore stop */

/**
 * Fetch via curl-impersonate subprocess. curl-impersonate patches curl's TLS
 * ClientHello to match Chrome's fingerprint (JA3/JA4, ALPN, extensions order,
 * supported curves), bypassing CDN TLS-fingerprint blocks (Akamai BotManager,
 * Cloudflare) that reject standard HTTP clients. Used as a last-resort fallback
 * when standard clients are blocked.
 *
 * The execCurl dependency is injectable so tests can drive the full function
 * (argument construction, header title-casing, abort handling, error mapping,
 * response parsing) without spawning a real curl process.
 */
export function createCurlFetch(deps: { execCurl: ExecCurl; resolvePinnedAddress: ResolvePinnedAddress }): CurlFetch {
	const { execCurl, resolvePinnedAddress } = deps;

	async function fetchOnce(
		url: string,
		init: { headers?: Record<string, string>; signal: AbortSignal },
	): Promise<Response> {
		const parsed = new URL(url);
		const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
		const pinnedAddress = await resolvePinnedAddress({ hostname: parsed.hostname });
		return new Promise<Response>((resolve, reject) => {
			const args = buildCurlArgs({ url, headers: init.headers, hostname: parsed.hostname, port, pinnedAddress });
			const child = execCurl(args, (error, stdout) => {
				if (error) {
					reject(new Error(`fetchCurl failed for ${url}: ${error.message}`));
					return;
				}
				const { status, headers, body } = parseCurlOutput(stdout);
				resolve(new Response(body.length === 0 ? null : body, { status, headers }));
			});
			const { signal } = init;
			if (signal.aborted) {
				child.kill();
				reject(signal.reason);
				return;
			}
			const onAbort = () => {
				child.kill();
				reject(signal.reason);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			child.onClose(() => signal.removeEventListener("abort", onAbort));
		});
	}

	return function fetchCurl(url, init) {
		/* One budget spans the whole redirect chain — a fresh timeout per hop
		 * would let a slow 5-hop origin consume 6x the intended ceiling — so the
		 * signal is fixed here and shared by every `fetchOnce` hop. Each hop still
		 * re-runs resolvePinnedAddress on its own target host (curl stays at
		 * --max-redirs 0 and is never allowed to chase a redirect unguarded). */
		const signal = init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
		const followCurl = redirectable(
			(hopUrl, hopInit) => fetchOnce(hopUrl, { headers: hopInit?.headers, signal }),
			"fetchCurl",
		);
		return followCurl(url, { headers: init?.headers });
	};
}

/**
 * Production curl fetcher with the SSRF guard wired from a resolver: every
 * call resolves + checks the host before spawning curl and pins it to a
 * verified address. `resolve` and `isBlocked` are injectable so tests drive
 * the verdict.
 */
export function initGuardedCurlFetch(deps: { resolve: ResolveAll; isBlocked: IsBlockedAddress }): CurlFetch {
	return createCurlFetch({
		execCurl: defaultExecCurl,
		resolvePinnedAddress: createPinnedAddressResolver({ resolve: deps.resolve, isBlocked: deps.isBlocked }),
	});
}

function buildCurlArgs(params: {
	url: string;
	hostname: string;
	port: number;
	pinnedAddress: string;
	headers?: Record<string, string>;
}): string[] {
	const args = [
		"--http2",
		// Disable curl's URL globbing so `[…]` and `{…}` in real URLs (e.g.
		// CIA reading-room docs like `…/COMPUTERS%20AND%20AUTOMATION%20[16505689].pdf`)
		// are treated as literal path characters instead of range/list expansions
		// that fail the command at parse time with exit code 3.
		"--globoff",
		"--silent",
		"--show-error",
		// curl resolves DNS itself, bypassing the Node-level SSRF guard, so a
		// redirect could reach an unchecked private IP. Omitting `--location` is
		// what stops curl from following redirects on its own — each 3xx is handed
		// back to fetchCurl, which re-pins the target through the SSRF guard
		// (resolvePinnedAddress) before following it. `--max-redirs 0` is inert
		// without `--location` (curl consults it only under -L); it stays as a
		// fail-closed backstop so that a re-added `--location` would make curl exit
		// 47 instead of following a redirect unguarded.
		"--max-redirs",
		"0",
		"--dump-header",
		"-",
		"--output",
		"-",
		"--compressed",
	];
	// IP-literal hosts are validated up front by resolvePinnedAddress and curl
	// connects to them without a DNS step, so there is nothing to pin; --resolve
	// only matters when curl would otherwise resolve a name itself.
	if (isIP(params.hostname) === 0) {
		const pinnedForCurl = params.pinnedAddress.includes(":") ? `[${params.pinnedAddress}]` : params.pinnedAddress;
		args.push("--resolve", `${params.hostname}:${params.port}:${pinnedForCurl}`);
	}
	if (params.headers) {
		for (const [key, value] of Object.entries(params.headers)) {
			args.push("--header", `${toTitleCase(key)}: ${value}`);
		}
	}
	// Re-encode through WHATWG URL so callers that hand us a partially decoded
	// URL (literal spaces from a recrawl path param, etc.) still produce a form
	// curl will accept. `new URL(...).href` percent-encodes spaces while leaving
	// `[`/`]` literal in the path — the exact shape `--globoff` is meant for.
	args.push("--", new URL(params.url).href);
	return args;
}

/**
 * Cloudflare's JA3/JA4 heuristics factor in header name casing for HTTP/1.1.
 * Real browsers send Title-Case headers; lowercase headers signal bot traffic.
 */
function toTitleCase(header: string): string {
	return header.replace(/\b\w/g, (c) => c.toUpperCase());
}

type ParsedCurlOutput = {
	status: number;
	headers: Headers;
	body: Buffer;
};

/**
 * curl --dump-header - --output - writes headers then a blank line then body.
 * A single response can still carry more than one header block: an HTTP 1xx
 * interim response (100 Continue, 103 Early Hints) precedes the final status,
 * so we parse the LAST header block (after the last HTTP status line).
 */
function parseCurlOutput(raw: Buffer): ParsedCurlOutput {
	const crlfIndex = findLastHeaderBlock(raw);
	const headerSection = raw.subarray(0, crlfIndex).toString("utf-8");
	const body = raw.subarray(crlfIndex + 4);

	const lines = headerSection.split("\r\n");
	let status = 200;
	const headers = new Headers();

	for (const line of lines) {
		if (line.startsWith("HTTP/")) {
			const parts = line.split(" ");
			status = Number(parts[1]);
			continue;
		}
		const colonIdx = line.indexOf(":");
		if (colonIdx > 0) {
			headers.append(line.substring(0, colonIdx).trim(), line.substring(colonIdx + 1).trim());
		}
	}

	return { status, headers, body };
}

/**
 * Finds the end of the last header block (\r\n\r\n boundary). An HTTP 1xx
 * interim response (100 Continue, 103 Early Hints) emits its own header block
 * before the final one, so we skip past every interim block to the last.
 */
function findLastHeaderBlock(raw: Buffer): number {
	const separator = Buffer.from("\r\n\r\n");
	let lastIdx = -1;
	let searchFrom = 0;
	while (true) {
		const idx = raw.indexOf(separator, searchFrom);
		if (idx === -1) break;
		const afterSep = idx + 4;
		const remaining = raw.subarray(afterSep);
		if (remaining.length > 0 && remaining.toString("utf-8", 0, Math.min(5, remaining.length)).startsWith("HTTP/")) {
			lastIdx = idx;
			searchFrom = afterSep;
			continue;
		}
		lastIdx = idx;
		break;
	}
	if (lastIdx === -1) {
		return raw.length;
	}
	return lastIdx;
}
