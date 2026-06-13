import { AGENT_SCOPES_SUPPORTED, buildAgentAuthMetadata, renderAuthMarkdown } from "./agent-auth";

const BASE_URL = "https://readplace.com";

describe("buildAgentAuthMetadata", () => {
	it("advertises the auth.md skill and the OAuth registration entry point", () => {
		const metadata = buildAgentAuthMetadata(BASE_URL);
		expect(metadata.skill).toBe("https://readplace.com/auth.md");
		expect(metadata.register_uri).toBe("https://readplace.com/oauth/authorize");
	});

	it("declares the delegated-user identity and OAuth token credential types", () => {
		const metadata = buildAgentAuthMetadata(BASE_URL);
		expect(metadata.identity_types_supported).toEqual(["delegated_user"]);
		expect(metadata.credential_types_supported).toEqual([
			"oauth2_access_token",
			"oauth2_refresh_token",
		]);
	});

	it("offers a revocation URL but no claim ceremony", () => {
		const metadata = buildAgentAuthMetadata(BASE_URL);
		expect(metadata.revocation_uri).toBe("https://readplace.com/oauth/revoke");
		expect(metadata).not.toHaveProperty("claim_uri");
	});

	it("describes exactly one complete authorization-code + PKCE registration method", () => {
		const { registration_methods } = buildAgentAuthMetadata(BASE_URL);
		expect(registration_methods).toEqual([
			{
				type: "oauth2_authorization_code_pkce",
				authorization_uri: "https://readplace.com/oauth/authorize",
				token_uri: "https://readplace.com/oauth/token",
				grant_types_supported: ["authorization_code", "refresh_token"],
				code_challenge_methods_supported: ["S256"],
				token_endpoint_auth_methods_supported: ["none"],
			},
		]);
	});
});

describe("renderAuthMarkdown", () => {
	it("starts with an `# auth.md` H1 so the discovery validator recognises it", () => {
		expect(renderAuthMarkdown(BASE_URL).startsWith("# auth.md\n")).toBe(true);
	});

	it("substitutes every baseUrl placeholder with the deployment origin", () => {
		const markdown = renderAuthMarkdown(BASE_URL);
		expect(markdown).not.toContain("{{baseUrl}}");
		expect(markdown).toContain("https://readplace.com/.well-known/oauth-authorization-server");
		expect(markdown).toContain("https://readplace.com/oauth/authorize");
		expect(markdown).toContain("https://readplace.com/oauth/token");
		expect(markdown).toContain("https://readplace.com/oauth/revoke");
	});

	it("documents the single coarse queue scope it advertises", () => {
		expect(AGENT_SCOPES_SUPPORTED).toEqual(["queue"]);
		expect(renderAuthMarkdown(BASE_URL)).toContain("`queue` scope");
	});

	it("points agents at the concierge address for client_id provisioning", () => {
		expect(renderAuthMarkdown(BASE_URL)).toContain("readplace+agents@readplace.com");
	});
});
