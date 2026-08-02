import assert from "node:assert/strict";
import http from "node:http";
import { Agent, buildConnector } from "undici";
import { initDefaultFetchAia } from "./aia-fetch";
import {
	createBlockedAddressLookup,
	createLiteralHostGuard,
	createPinnedAddressResolver,
	type IsBlockedAddress,
	type ResolveAll,
} from "./blocked-address-lookup";
import { initCrawlFetch } from "./crawl-fetch";
import type { ExecCurl } from "./curl-fetch";
import { createCurlFetch } from "./curl-fetch";
import { initFetchH2 } from "./h2-fetch";

const PERSONAS = [{ name: "test", headers: { "user-agent": "test" } }] as const;

/** Test stand-in for the real blocked-IP classifier; classifies the
 * addresses these transport tests resolve to. */
const blocksPrivate: IsBlockedAddress = (ip) =>
	ip.startsWith("10.") ||
	ip.startsWith("127.") ||
	ip.startsWith("169.254.") ||
	ip.startsWith("100.64.");

/** Blocks the same ranges as {@link blocksPrivate} but leaves loopback
 * reachable, because the redirect fixtures below must bind a real HTTP server
 * on 127.0.0.1: the literal-host guard now refuses a loopback initial connect,
 * so the test origin itself has to classify as allowed while the redirect
 * target (a private name or a metadata IP literal) is what gets refused. */
const blocksPrivateExceptLoopback: IsBlockedAddress = (ip) =>
	ip.startsWith("10.") || ip.startsWith("169.254.") || ip.startsWith("100.64.");

function hasMessage(value: unknown): value is { message: unknown; cause?: unknown } {
	return typeof value === "object" && value !== null && "message" in value;
}

/** undici reports connect failures as `TypeError: fetch failed` and tucks the
 * underlying reason into the `cause` chain, so flatten it to assert on.
 * Duck-typed rather than `instanceof Error` because undici's error crosses
 * jest's VM realm boundary. */
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

/** Resolver that maps specific hostnames to fixed addresses; unknown hosts
 * resolve to a public address so an initial loopback connection isn't blocked. */
function resolverFor(map: Record<string, string>): ResolveAll {
	return (hostname, _options, callback) => {
		const address = map[hostname] ?? "93.184.216.34";
		callback(null, [{ address, family: address.includes(":") ? 6 : 4 }]);
	};
}

function allHostsResolveTo(address: string): ResolveAll {
	return (_hostname, _options, callback) =>
		callback(null, [{ address, family: address.includes(":") ? 6 : 4 }]);
}

async function startRedirectServer(location: string): Promise<{ origin: string; close: () => Promise<void> }> {
	const server = http.createServer((_req, res) => {
		res.writeHead(302, { location });
		res.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert(address && typeof address === "object", "expected an AddressInfo from a listening TCP server");
	const { port } = address;
	return {
		origin: `http://127.0.0.1:${port}`,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

/** Mirror of the production dispatcher in initCrawlFetch: a name-resolving,
 * pinning `lookup` plus the literal-host guard wrapped around the connector, so
 * the redirect tests exercise the real per-hop enforcement. */
function guardedAgent(deps: { resolve: ResolveAll; isBlocked: IsBlockedAddress }): Agent {
	const baseConnector = buildConnector({
		lookup: createBlockedAddressLookup({ resolve: deps.resolve, isBlocked: deps.isBlocked }),
	});
	const assertHostAllowed = createLiteralHostGuard({ isBlocked: deps.isBlocked });
	return new Agent({
		connect(options, callback) {
			try {
				assertHostAllowed(options.hostname);
			} catch (error) {
				assert(error instanceof Error);
				callback(error, null);
				return;
			}
			baseConnector(options, callback);
		},
	});
}

describe("SSRF guard — undici/fetch transport", () => {
	it("rejects a 302 whose target host resolves to a private IP", async () => {
		const server = await startRedirectServer("http://internal.attacker.test/secret");
		const agent = guardedAgent({
			resolve: resolverFor({ "internal.attacker.test": "10.0.0.1" }),
			isBlocked: blocksPrivateExceptLoopback,
		});
		try {
			const error = await rejectionOf(fetch(`${server.origin}/start`, { dispatcher: agent }));
			expect(causeChainMessages(error)).toMatch(/blocked address 10\.0\.0\.1/);
		} finally {
			await agent.close();
			await server.close();
		}
	});

	it("rejects a 302 to a raw private/metadata IP literal — the redirect hop Node would connect to without calling lookup", async () => {
		const server = await startRedirectServer("http://169.254.169.254/latest/meta-data/");
		const agent = guardedAgent({
			resolve: resolverFor({}),
			isBlocked: blocksPrivateExceptLoopback,
		});
		try {
			const error = await rejectionOf(fetch(`${server.origin}/start`, { dispatcher: agent }));
			expect(causeChainMessages(error)).toMatch(/blocked address 169\.254\.169\.254/);
		} finally {
			await agent.close();
			await server.close();
		}
	});
});

describe("SSRF guard — HTTP/2 transport", () => {
	it("rejects a host that resolves to a private IP before connecting", async () => {
		const fetchH2 = initFetchH2({
			lookup: createBlockedAddressLookup({ resolve: allHostsResolveTo("169.254.169.254"), isBlocked: blocksPrivate }),
		});
		await expect(fetchH2("https://metadata.attacker.test/")).rejects.toThrow(
			/blocked address 169\.254\.169\.254/,
		);
	});

	it("rejects a raw private IP-literal host before connecting (http2.connect skips the lookup for literals)", async () => {
		const fetchH2 = initFetchH2({
			assertHostAllowed: createLiteralHostGuard({ isBlocked: blocksPrivate }),
		});
		await expect(fetchH2("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
			/blocked address 169\.254\.169\.254/,
		);
	});
});

describe("SSRF guard — AIA-chasing (https.request) transport", () => {
	it("rejects a host that resolves to a private IP before connecting", async () => {
		const fetchAia = initDefaultFetchAia({
			lookup: createBlockedAddressLookup({ resolve: allHostsResolveTo("127.0.0.1"), isBlocked: blocksPrivate }),
		});
		await expect(fetchAia("https://loopback.attacker.test/")).rejects.toThrow(
			/blocked address 127\.0\.0\.1/,
		);
	});

	it("rejects a raw private IP-literal host before connecting (https.request skips the lookup for literals)", async () => {
		const fetchAia = initDefaultFetchAia({
			assertHostAllowed: createLiteralHostGuard({ isBlocked: blocksPrivate }),
		});
		await expect(fetchAia("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
			/blocked address 169\.254\.169\.254/,
		);
	});
});

describe("SSRF guard — curl transport", () => {
	it("rejects before spawning curl when the host resolves to a private IP", async () => {
		const execCurl = jest.fn<ReturnType<ExecCurl>, Parameters<ExecCurl>>();
		const fetchCurl = createCurlFetch({
			execCurl,
			resolvePinnedAddress: createPinnedAddressResolver({ resolve: allHostsResolveTo("100.64.0.1"), isBlocked: blocksPrivate }),
		});
		await expect(fetchCurl("https://cgnat.attacker.test/")).rejects.toThrow(/blocked address 100\.64\.0\.1/);
		expect(execCurl).not.toHaveBeenCalled();
	});
});

describe("SSRF guard — initCrawlFetch composition", () => {
	it("fails closed across the whole fallback chain when the host resolves to a private IP", async () => {
		const crawlFetch = initCrawlFetch({
			fetch: globalThis.fetch,
			personas: PERSONAS,
			isBlocked: blocksPrivate,
			resolve: allHostsResolveTo("10.1.2.3"),
		});
		await expect(crawlFetch("https://attacker.test/article")).rejects.toThrow(/blocked address 10\.1\.2\.3/);
	});

	it("re-checks a redirect hop the primary leg follows itself, refusing a target that resolves to a private IP", async () => {
		const server = await startRedirectServer("http://internal.attacker.test/secret");
		const checkedAddresses: string[] = [];
		// The h2 and curl legs run their own copy of the guard (covered above);
		// stubbing them pins this test on the primary leg's redirect loop.
		const h2Refused = new Error("h2 leg not under test");
		const curlRefused = new Error("curl leg not under test");
		const hops: string[] = [];
		const crawlFetch = initCrawlFetch({
			fetch: globalThis.fetch,
			personas: PERSONAS,
			isBlocked: (address) => {
				checkedAddresses.push(address);
				return blocksPrivateExceptLoopback(address);
			},
			resolve: resolverFor({ "internal.attacker.test": "10.0.0.1" }),
			fetchH2: async () => {
				throw h2Refused;
			},
			fetchCurl: async () => {
				throw curlRefused;
			},
		});

		try {
			await expect(
				crawlFetch(`${server.origin}/start`, { onRedirect: (hop) => hops.push(hop.toUrl) }),
			).rejects.toBe(curlRefused);
			expect(hops).toEqual(["http://internal.attacker.test/secret"]);
			expect(checkedAddresses).toContain("10.0.0.1");
		} finally {
			await server.close();
		}
	});

	it("fails closed across the whole chain for a raw private IP-literal host, before any transport connects", async () => {
		const crawlFetch = initCrawlFetch({
			fetch: globalThis.fetch,
			personas: PERSONAS,
			isBlocked: blocksPrivate,
			resolve: allHostsResolveTo("169.254.169.254"),
		});
		await expect(crawlFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
			/blocked address 169\.254\.169\.254/,
		);
	});
});
