import assert from "node:assert/strict";
import { isBlockedIpAddress } from "./blocked-address";

describe("isBlockedIpAddress", () => {
	describe("blocked IPv4 ranges", () => {
		const blocked = [
			["127.0.0.1", "loopback 127.0.0.0/8"],
			["127.5.6.7", "loopback 127.0.0.0/8"],
			["10.0.0.1", "RFC 1918 10.0.0.0/8"],
			["10.255.255.254", "RFC 1918 10.0.0.0/8"],
			["192.168.1.1", "RFC 1918 192.168.0.0/16"],
			["172.16.0.1", "RFC 1918 172.16.0.0/12 lower bound"],
			["172.31.255.255", "RFC 1918 172.16.0.0/12 upper bound"],
			["100.64.0.1", "CGNAT 100.64.0.0/10 lower bound"],
			["100.127.255.255", "CGNAT 100.64.0.0/10 upper bound"],
			["169.254.169.254", "link-local 169.254.0.0/16 (cloud metadata)"],
			["169.254.170.2", "link-local 169.254.0.0/16 (container creds)"],
			["0.0.0.0", "0.0.0.0/8 this-network"],
			["0.1.2.3", "0.0.0.0/8 this-network"],
		] as const;

		for (const [ip, why] of blocked) {
			it(`blocks ${ip} (${why})`, () => {
				assert.equal(isBlockedIpAddress(ip), true);
			});
		}
	});

	describe("public IPv4 addresses adjacent to blocked ranges", () => {
		const allowed = [
			["8.8.8.8", "public"],
			["1.1.1.1", "public"],
			["172.15.255.255", "just below 172.16.0.0/12"],
			["172.32.0.0", "just above 172.16.0.0/12"],
			["100.63.255.255", "just below 100.64.0.0/10"],
			["100.128.0.0", "just above 100.64.0.0/10"],
			["192.167.0.1", "not 192.168.0.0/16"],
			["11.0.0.1", "not 10.0.0.0/8"],
			["126.0.0.1", "not 127.0.0.0/8"],
			["1.0.0.0", "not 0.0.0.0/8"],
		] as const;

		for (const [ip, why] of allowed) {
			it(`allows ${ip} (${why})`, () => {
				assert.equal(isBlockedIpAddress(ip), false);
			});
		}
	});

	describe("blocked IPv6 addresses", () => {
		const blocked = [
			["::1", "loopback"],
			["::", "unspecified"],
			["fc00::1", "unique-local fc00::/7"],
			["fd00::abcd", "unique-local fc00::/7"],
			["fe80::1", "link-local fe80::/10"],
			["::ffff:127.0.0.1", "IPv4-mapped loopback"],
			["::ffff:169.254.169.254", "IPv4-mapped link-local"],
			["::ffff:192.168.1.1", "IPv4-mapped RFC 1918"],
			["::ffff:10.0.0.1", "IPv4-mapped RFC 1918"],
			["::ffff:100.64.0.1", "IPv4-mapped CGNAT"],
		] as const;

		for (const [ip, why] of blocked) {
			it(`blocks ${ip} (${why})`, () => {
				assert.equal(isBlockedIpAddress(ip), true);
			});
		}
	});

	describe("public IPv6 addresses", () => {
		const allowed = [
			["2001:4860:4860::8888", "Google public DNS"],
			["2606:4700:4700::1111", "Cloudflare public DNS"],
			["::ffff:8.8.8.8", "IPv4-mapped public address"],
		] as const;

		for (const [ip, why] of allowed) {
			it(`allows ${ip} (${why})`, () => {
				assert.equal(isBlockedIpAddress(ip), false);
			});
		}
	});

	describe("non-IP input", () => {
		it("returns false for a hostname string (resolution happens elsewhere)", () => {
			assert.equal(isBlockedIpAddress("example.com"), false);
		});

		it("returns false for an empty string", () => {
			assert.equal(isBlockedIpAddress(""), false);
		});
	});
});
