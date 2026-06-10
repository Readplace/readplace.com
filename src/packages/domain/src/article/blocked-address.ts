import assert from "node:assert";
import { isIPv4, isIPv6 } from "node:net";

const SINGLETON_LOCAL_IPV6: ReadonlySet<string> = new Set([
	"::1",
	"::",
]);

export function isPrivateIPv4(host: string): boolean {
	if (!isIPv4(host)) return false;
	const parts = host.split(".").map((p) => Number.parseInt(p, 10));
	const [a, b] = parts;
	if (a === 127) return true; /* 127.0.0.0/8 loopback */
	if (a === 10) return true; /* 10.0.0.0/8 RFC 1918 */
	if (a === 192 && b === 168) return true; /* 192.168.0.0/16 RFC 1918 */
	if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; /* 172.16.0.0/12 RFC 1918 */
	if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; /* 100.64.0.0/10 CGNAT (RFC 6598) */
	if (a === 169 && b === 254) return true; /* 169.254.0.0/16 link-local */
	if (a === 0) return true; /* 0.0.0.0/8 "this network" */
	return false;
}

export function unwrapIpv6(host: string): string {
	const bracketStripped = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	return bracketStripped.split("%")[0];
}

/** The WHATWG URL parser normalises `::ffff:a.b.c.d` to `::ffff:AABB:CCDD`
 * (hex), but a resolver / `dns.lookup` can hand back the dotted form verbatim,
 * so both are recognised. */
const IPV4_MAPPED_HEX_RE = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV4_MAPPED_DOTTED_RE = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

function ipv4MappedToIpv4(h1: string, h2: string): string {
	const p1 = h1.padStart(4, "0");
	const p2 = h2.padStart(4, "0");
	return `${Number.parseInt(p1.slice(0, 2), 16)}.${Number.parseInt(p1.slice(2, 4), 16)}.${Number.parseInt(p2.slice(0, 2), 16)}.${Number.parseInt(p2.slice(2, 4), 16)}`;
}

export function isPrivateIPv6(host: string): boolean {
	const inner = unwrapIpv6(host);
	if (!isIPv6(inner)) return false;
	if (SINGLETON_LOCAL_IPV6.has(inner)) return true;
	const mapped = IPV4_MAPPED_HEX_RE.exec(inner);
	if (mapped) {
		const [, h1, h2] = mapped;
		assert(h1, "IPv4-mapped regex must capture hextet 1");
		assert(h2, "IPv4-mapped regex must capture hextet 2");
		return isPrivateIPv4(ipv4MappedToIpv4(h1, h2));
	}
	const dottedMapped = IPV4_MAPPED_DOTTED_RE.exec(inner);
	if (dottedMapped) {
		const [, ipv4] = dottedMapped;
		assert(ipv4, "dotted IPv4-mapped regex must capture the IPv4 literal");
		return isPrivateIPv4(ipv4);
	}
	/** Addresses written with leading `::` have 16+ zero high bits, which
	 * places them outside fc00::/7 (high bit must be 1) and fe80::/10. */
	if (inner.startsWith("::")) return false;
	const firstGroup = inner.split(":")[0];
	assert(firstGroup, "non-:: IPv6 must have a non-empty first hextet");
	const first = Number.parseInt(firstGroup, 16);
	if ((first & 0xfe00) === 0xfc00) return true; /* fc00::/7 unique-local */
	if ((first & 0xffc0) === 0xfe80) return true; /* fe80::/10 link-local */
	return false;
}

/**
 * True when `ip` (a bare IPv4 or IPv6 literal, e.g. from a DNS resolution) is
 * one a crawler must never connect to: loopback, RFC 1918, link-local,
 * CGNAT, `0.0.0.0/8`, IPv6 unique-local/link-local/loopback, or an
 * IPv4-mapped form of any of these. The transport guard rejects a connection
 * — initial or post-redirect — whenever any resolved address satisfies this.
 */
export function isBlockedIpAddress(ip: string): boolean {
	if (isPrivateIPv4(ip)) return true;
	return isPrivateIPv6(ip);
}
