import type dns from "node:dns";
import {
	createBlockedAddressLookup,
	createPinnedAddressResolver,
	defaultResolveAll,
	type IsBlockedAddress,
	type ResolveAll,
} from "./blocked-address-lookup";

/** Stand-in for the real block-list predicate, which is tested elsewhere. The
 * lookup mechanism only needs a predicate that classifies the addresses these
 * tests resolve to. */
const blocksPrivate: IsBlockedAddress = (ip) =>
	ip.startsWith("10.") ||
	ip.startsWith("127.") ||
	ip.startsWith("169.254.") ||
	ip.startsWith("100.64.");

function resolverReturning(addresses: dns.LookupAddress[]): ResolveAll {
	return (_hostname, _options, callback) => callback(null, addresses);
}

function resolverFailing(err: NodeJS.ErrnoException): ResolveAll {
	return (_hostname, _options, callback) => callback(err, []);
}

type LookupOutcome = {
	err: NodeJS.ErrnoException | null;
	address: string | dns.LookupAddress[];
	family: number | undefined;
};

function runLookup(
	resolve: ResolveAll,
	hostname: string,
	options: dns.LookupOptions = {},
): Promise<LookupOutcome> {
	const lookup = createBlockedAddressLookup({ resolve, isBlocked: blocksPrivate });
	return new Promise((done) => {
		lookup(hostname, options, (err, address, family) => done({ err, address, family }));
	});
}

describe("createBlockedAddressLookup", () => {
	it("errors when the only resolved address is private", async () => {
		const outcome = await runLookup(resolverReturning([{ address: "10.0.0.1", family: 4 }]), "evil.test");
		expect(outcome.err?.message).toMatch(/blocked address 10\.0\.0\.1/);
		expect(outcome.err?.code).toBe("EBLOCKEDADDRESS");
	});

	it("errors when ANY resolved address is private, even with a public one present", async () => {
		const outcome = await runLookup(
			resolverReturning([
				{ address: "93.184.216.34", family: 4 },
				{ address: "169.254.169.254", family: 4 },
			]),
			"rebind.test",
		);
		expect(outcome.err?.message).toMatch(/blocked address 169\.254\.169\.254/);
	});

	it("pins to the first resolved address when all are public", async () => {
		const outcome = await runLookup(resolverReturning([{ address: "93.184.216.34", family: 4 }]), "example.test");
		expect(outcome.err).toBeNull();
		expect(outcome.address).toBe("93.184.216.34");
		expect(outcome.family).toBe(4);
	});

	it("preserves the IPv6 family of a pinned public address", async () => {
		const outcome = await runLookup(
			resolverReturning([{ address: "2606:4700:4700::1111", family: 6 }]),
			"v6.test",
		);
		expect(outcome.err).toBeNull();
		expect(outcome.address).toBe("2606:4700:4700::1111");
		expect(outcome.family).toBe(6);
	});

	it("returns every checked address in array form when options.all is set (undici's connector requires it)", async () => {
		const outcome = await runLookup(
			resolverReturning([
				{ address: "93.184.216.34", family: 4 },
				{ address: "2606:4700:4700::1111", family: 6 },
			]),
			"multi.test",
			{ all: true },
		);
		expect(outcome.err).toBeNull();
		expect(outcome.address).toEqual([
			{ address: "93.184.216.34", family: 4 },
			{ address: "2606:4700:4700::1111", family: 6 },
		]);
	});

	it("errors when the host resolves to no addresses", async () => {
		const outcome = await runLookup(resolverReturning([]), "empty.test");
		expect(outcome.err?.message).toMatch(/No addresses resolved/);
	});

	it("propagates a resolver error", async () => {
		const err = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
		const outcome = await runLookup(resolverFailing(err), "nope.test");
		expect(outcome.err).toBe(err);
	});
});

describe("defaultResolveAll", () => {
	it("resolves localhost to a loopback address via dns.lookup", async () => {
		const addresses = await new Promise<readonly dns.LookupAddress[]>((resolve, reject) => {
			defaultResolveAll("localhost", { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs)));
		});
		expect(addresses.length).toBeGreaterThan(0);
		expect(addresses.every((a) => a.address === "127.0.0.1" || a.address === "::1")).toBe(true);
	});
});

describe("createPinnedAddressResolver", () => {
	it("resolves to the first checked address when all are public", async () => {
		const resolvePinned = createPinnedAddressResolver({
			resolve: resolverReturning([{ address: "93.184.216.34", family: 4 }]),
			isBlocked: blocksPrivate,
		});
		await expect(resolvePinned({ hostname: "example.test" })).resolves.toBe("93.184.216.34");
	});

	it("rejects when any resolved address is private", async () => {
		const resolvePinned = createPinnedAddressResolver({
			resolve: resolverReturning([
				{ address: "93.184.216.34", family: 4 },
				{ address: "127.0.0.1", family: 4 },
			]),
			isBlocked: blocksPrivate,
		});
		await expect(resolvePinned({ hostname: "evil.test" })).rejects.toThrow(/blocked address 127\.0\.0\.1/);
	});

	it("rejects when the host resolves to no addresses", async () => {
		const resolvePinned = createPinnedAddressResolver({ resolve: resolverReturning([]), isBlocked: blocksPrivate });
		await expect(resolvePinned({ hostname: "empty.test" })).rejects.toThrow(/No addresses resolved/);
	});

	it("propagates a resolver error", async () => {
		const err = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
		const resolvePinned = createPinnedAddressResolver({ resolve: resolverFailing(err), isBlocked: blocksPrivate });
		await expect(resolvePinned({ hostname: "nope.test" })).rejects.toBe(err);
	});
});
