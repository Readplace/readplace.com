import assert from "node:assert/strict";
import {
	computeOAuthClientDedupeKey,
	defaultOAuthClientName,
} from "./client-registration";

describe("computeOAuthClientDedupeKey", () => {
	const base = {
		redirectUris: ["https://a.example/cb", "https://b.example/cb"],
		clientName: "Agent",
		grants: ["authorization_code", "refresh_token"],
		tokenEndpointAuthMethod: "none",
	};

	it("is stable regardless of redirect_uris or grants order", () => {
		const a = computeOAuthClientDedupeKey(base);
		const b = computeOAuthClientDedupeKey({
			...base,
			redirectUris: ["https://b.example/cb", "https://a.example/cb"],
			grants: ["refresh_token", "authorization_code"],
		});
		assert.equal(a, b);
	});

	it("differs when any identifying field differs", () => {
		const a = computeOAuthClientDedupeKey(base);
		assert.notEqual(a, computeOAuthClientDedupeKey({ ...base, clientName: "Other" }));
		assert.notEqual(
			a,
			computeOAuthClientDedupeKey({ ...base, redirectUris: ["https://a.example/cb"] }),
		);
	});
});

describe("defaultOAuthClientName", () => {
	it("uses the first redirect URI's hostname", () => {
		assert.equal(defaultOAuthClientName(["https://claude.ai/api/mcp/auth_callback"]), "claude.ai");
	});

	it("drops the port from a loopback redirect URI, as /developers documents", () => {
		assert.equal(defaultOAuthClientName(["http://127.0.0.1:8765/callback"]), "127.0.0.1");
	});

	it("keeps the brackets of an IPv6 loopback host and drops its port", () => {
		assert.equal(defaultOAuthClientName(["http://[::1]:8765/callback"]), "[::1]");
	});

	it("falls back to a generic noun for a malformed URI", () => {
		assert.equal(defaultOAuthClientName(["not a url"]), "an application");
	});

	it("falls back to a generic noun when no redirect URI is present", () => {
		assert.equal(defaultOAuthClientName([]), "an application");
	});
});
