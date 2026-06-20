import assert from "node:assert/strict";
import type { OAuthClient } from "@packages/domain/oauth";
import { OAuthClientIdSchema } from "@packages/domain/oauth";
import { initInMemoryOAuthClientLookup } from "./oauth-client-lookup";

const DYNAMIC: OAuthClient = {
	id: OAuthClientIdSchema.parse("dyn-1"),
	name: "Claude",
	redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
	grants: ["authorization_code", "refresh_token"],
};

function createLookup() {
	const marked: string[] = [];
	const lookup = initInMemoryOAuthClientLookup({
		dynamic: {
			getClient: async (id) => (id === "dyn-1" ? DYNAMIC : undefined),
			markClientActive: async (id) => {
				marked.push(id);
			},
		},
	});
	return { lookup, marked };
}

describe("initInMemoryOAuthClientLookup", () => {
	it("resolves built-in then dynamic, and undefined otherwise", async () => {
		const { lookup } = createLookup();
		assert.equal((await lookup.findClient("hutch-firefox-extension"))?.name, "Readplace Firefox Extension");
		assert.equal((await lookup.findClient("dyn-1"))?.id, "dyn-1");
		assert.equal(await lookup.findClient("ghost"), undefined);
	});

	it("validates redirects: loopback for built-in, exact for dynamic, false for unknown", async () => {
		const { lookup } = createLookup();
		assert.equal(
			await lookup.validateRedirectUri({
				clientId: "hutch-firefox-extension",
				redirectUri: "http://127.0.0.1:42/oauth/callback",
			}),
			true,
		);
		assert.equal(
			await lookup.validateRedirectUri({
				clientId: "dyn-1",
				redirectUri: "https://claude.ai/api/mcp/auth_callback",
			}),
			true,
		);
		assert.equal(
			await lookup.validateRedirectUri({ clientId: "dyn-1", redirectUri: "https://x/y" }),
			false,
		);
		assert.equal(
			await lookup.validateRedirectUri({ clientId: "ghost", redirectUri: "https://x/y" }),
			false,
		);
	});

	it("marks dynamic clients active but no-ops for built-ins", async () => {
		const { lookup, marked } = createLookup();
		await lookup.markClientActive("hutch-firefox-extension");
		await lookup.markClientActive("dyn-1");
		assert.deepEqual(marked, ["dyn-1"]);
	});
});
