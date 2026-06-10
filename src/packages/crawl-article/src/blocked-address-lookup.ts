import dns from "node:dns";

/**
 * The `lookup` option shape that `net.connect`, `tls.connect`, `http2.connect`,
 * `https.request`, and undici's connector all accept. Node calls it once per
 * TCP connection the transport opens — the initial request AND every redirect
 * hop — so installing a single guarded lookup defends each connection without
 * any per-redirect bookkeeping.
 */
export type SocketLookup = (
	hostname: string,
	options: dns.LookupOptions,
	callback: (
		err: NodeJS.ErrnoException | null,
		address: string | dns.LookupAddress[],
		family?: number,
	) => void,
) => void;

/**
 * Resolve-every-address shape, satisfied by `dns.lookup(host, { all: true })`.
 * Injected so tests drive the verdict with a fake resolver instead of real DNS.
 */
export type ResolveAll = (
	hostname: string,
	options: { all: true },
	callback: (err: NodeJS.ErrnoException | null, addresses: readonly dns.LookupAddress[]) => void,
) => void;

export const defaultResolveAll: ResolveAll = (hostname, options, callback) => {
	dns.lookup(hostname, options, callback);
};

/**
 * Predicate deciding which resolved addresses to refuse — the shared
 * `isBlockedIpAddress` in production. Injected from the composition root rather
 * than imported here so crawl-article stays free of domain coupling and the
 * block-list policy is wired in one place alongside the resolver.
 */
export type IsBlockedAddress = (address: string) => boolean;

function firstBlocked(
	addresses: readonly dns.LookupAddress[],
	isBlocked: IsBlockedAddress,
): string | undefined {
	return addresses.find((entry) => isBlocked(entry.address))?.address;
}

function blockedError(hostname: string, address: string): NodeJS.ErrnoException {
	return Object.assign(
		new Error(`Refusing to connect to ${hostname}: resolves to blocked address ${address}`),
		{ code: "EBLOCKEDADDRESS" },
	);
}

function noAddressError(hostname: string): NodeJS.ErrnoException {
	return Object.assign(new Error(`No addresses resolved for ${hostname}`), { code: "ENOTFOUND" });
}

/**
 * A socket `lookup` that resolves every address for the host, rejects the
 * connection if ANY resolved address is private/loopback/link-local/etc., and
 * otherwise pins the socket to a single checked address. Pinning the exact IP
 * (rather than letting the socket re-resolve) closes the DNS-rebinding / TOCTOU
 * window between the check and the connect.
 */
export function createBlockedAddressLookup(deps: {
	resolve: ResolveAll;
	isBlocked: IsBlockedAddress;
}): SocketLookup {
	const { isBlocked } = deps;
	return (hostname, options, callback) => {
		deps.resolve(hostname, { all: true }, (err, addresses) => {
			if (err) {
				callback(err, "", 0);
				return;
			}
			const blocked = firstBlocked(addresses, isBlocked);
			if (blocked !== undefined) {
				callback(blockedError(hostname, blocked), "", 0);
				return;
			}
			const [first] = addresses;
			if (!first) {
				callback(noAddressError(hostname), "", 0);
				return;
			}
			/** Honour the caller's `all`: undici's connector calls the lookup with
			 * `{ all: true }` and rejects a bare string with ERR_INVALID_IP_ADDRESS,
			 * whereas net/http2 without auto-select want `(address, family)`. Every
			 * resolved address has cleared the block check, so handing back the whole
			 * set stays rebinding-safe — the socket connects to a checked literal IP
			 * and never re-resolves the host — while letting the connector pick a
			 * reachable family (e.g. fall through ::1 → 127.0.0.1 for a v4-only
			 * listener). */
			if (options.all) {
				callback(null, [...addresses]);
				return;
			}
			callback(null, first.address, first.family);
		});
	};
}

export type ResolvePinnedAddress = (params: { hostname: string }) => Promise<string>;

/**
 * Promise form of the guard for transports that can't take a socket `lookup`
 * (the curl subprocess): resolves the host, rejects if any address is blocked,
 * and returns one checked address to pin curl to via `--resolve`.
 */
export function createPinnedAddressResolver(deps: {
	resolve: ResolveAll;
	isBlocked: IsBlockedAddress;
}): ResolvePinnedAddress {
	const { isBlocked } = deps;
	return ({ hostname }) =>
		new Promise((resolve, reject) => {
			deps.resolve(hostname, { all: true }, (err, addresses) => {
				if (err) {
					reject(err);
					return;
				}
				const blocked = firstBlocked(addresses, isBlocked);
				if (blocked !== undefined) {
					reject(blockedError(hostname, blocked));
					return;
				}
				const [first] = addresses;
				if (!first) {
					reject(noAddressError(hostname));
					return;
				}
				resolve(first.address);
			});
		});
}
