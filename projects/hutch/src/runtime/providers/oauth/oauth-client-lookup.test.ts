import assert from "node:assert/strict";
import type { OAuthClient } from "@packages/domain/oauth";
import { OAuthClientIdSchema } from "@packages/domain/oauth";
import { initOAuthClientLookup } from "./oauth-client-lookup";

const DYNAMIC: OAuthClient = {
	id: OAuthClientIdSchema.parse("dyn-123"),
	name: "Claude",
	redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
	grants: ["authorization_code", "refresh_token"],
};

function createLookup() {
	const marked: string[] = [];
	const lookup = initOAuthClientLookup({
		dynamic: {
			getClient: async (clientId) => (clientId === "dyn-123" ? DYNAMIC : undefined),
			markClientActive: async (clientId) => {
				marked.push(clientId);
			},
		},
	});
	return { lookup, marked };
}

describe("initOAuthClientLookup", () => {
	describe("findClient", () => {
		it("resolves a built-in client without touching the dynamic store", async () => {
			const { lookup } = createLookup();
			const client = await lookup.findClient("hutch-firefox-extension");
			assert.equal(client?.name, "Readplace Firefox Extension");
		});

		it("falls back to the dynamic store for a non-built-in id", async () => {
			const { lookup } = createLookup();
			assert.equal((await lookup.findClient("dyn-123"))?.id, "dyn-123");
		});

		it("returns undefined when neither registry knows the id", async () => {
			const { lookup } = createLookup();
			assert.equal(await lookup.findClient("ghost"), undefined);
		});
	});

	describe("validateRedirectUri", () => {
		it("applies the loopback exception for built-in clients", async () => {
			const { lookup } = createLookup();
			assert.equal(
				await lookup.validateRedirectUri({
					clientId: "hutch-firefox-extension",
					redirectUri: "http://127.0.0.1:55555/oauth/callback",
				}),
				true,
			);
		});

		it("requires an exact match for dynamic clients", async () => {
			const { lookup } = createLookup();
			assert.equal(
				await lookup.validateRedirectUri({
					clientId: "dyn-123",
					redirectUri: "https://claude.ai/api/mcp/auth_callback",
				}),
				true,
			);
			assert.equal(
				await lookup.validateRedirectUri({
					clientId: "dyn-123",
					redirectUri: "http://127.0.0.1:1/oauth/callback",
				}),
				false,
			);
		});

		it("rejects a redirect for an unknown client", async () => {
			const { lookup } = createLookup();
			assert.equal(
				await lookup.validateRedirectUri({ clientId: "ghost", redirectUri: "https://x/y" }),
				false,
			);
		});
	});

	describe("markClientActive", () => {
		it("forwards to the dynamic store for a dynamic client", async () => {
			const { lookup, marked } = createLookup();
			await lookup.markClientActive("dyn-123");
			assert.deepEqual(marked, ["dyn-123"]);
		});

		it("is a no-op for a built-in client", async () => {
			const { lookup, marked } = createLookup();
			await lookup.markClientActive("hutch-firefox-extension");
			assert.deepEqual(marked, []);
		});
	});
});
