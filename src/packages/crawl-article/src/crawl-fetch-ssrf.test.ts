import http from "node:http";
import type { AddressInfo } from "node:net";
import { Agent } from "undici";
import { initDefaultFetchAia } from "./aia-fetch";
import {
	createBlockedAddressLookup,
	createPinnedAddressResolver,
	type IsBlockedAddress,
	type ResolveAll,
} from "./blocked-address-lookup";
import { initCrawlFetch } from "./crawl-fetch";
import type { ExecCurl } from "./curl-fetch";
import { createCurlFetch } from "./curl-fetch";
import { initFetchH2 } from "./h2-fetch";

const PERSONAS = [{ name: "test", headers: { "user-agent": "test" } }] as const;

/** Stand-in for the real `isBlockedIpAddress` (tested in @packages/domain);
 * classifies the addresses these transport tests resolve to. */
const blocksPrivate: IsBlockedAddress = (ip) =>
	ip.startsWith("10.") ||
	ip.startsWith("127.") ||
	ip.startsWith("169.254.") ||
	ip.startsWith("100.64.");

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
	const { port } = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${port}`,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

describe("SSRF guard — undici/fetch transport", () => {
	it("rejects a 302 whose target host resolves to a private IP", async () => {
		// undici skips the custom lookup for the IP-literal initial host, so the
		// loopback request reaches the server; the redirect target is a NAME, so
		// the guarded lookup fires on the hop and blocks it.
		const server = await startRedirectServer("http://internal.attacker.test/secret");
		const lookup = createBlockedAddressLookup({
			resolve: resolverFor({ "internal.attacker.test": "10.0.0.1" }),
			isBlocked: blocksPrivate,
		});
		const agent = new Agent({ connect: { lookup } });
		try {
			const error = await rejectionOf(fetch(`${server.origin}/start`, { dispatcher: agent }));
			expect(causeChainMessages(error)).toMatch(/blocked address 10\.0\.0\.1/);
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
});
