import {
	AGENT_SCOPES_SUPPORTED,
	buildAgentAuthMetadata,
	buildProtectedResourceMetadata,
	renderAuthMarkdown,
} from "./agent-auth";

const BASE_URL = "https://readplace.com";

describe("buildAgentAuthMetadata", () => {
	it("advertises the auth.md skill and the dynamic registration endpoint", () => {
		const metadata = buildAgentAuthMetadata(BASE_URL);
		expect(metadata.skill).toBe("https://readplace.com/auth.md");
		expect(metadata.register_uri).toBe("https://readplace.com/oauth/register");
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

describe("buildProtectedResourceMetadata", () => {
	it("names the resource it was asked to describe, not the origin it lives under", () => {
		const metadata = buildProtectedResourceMetadata({
			baseUrl: BASE_URL,
			resource: `${BASE_URL}/mcp`,
		});
		expect(metadata.resource).toBe("https://readplace.com/mcp");
	});

	it("describes the origin itself when that is the resource", () => {
		const metadata = buildProtectedResourceMetadata({
			baseUrl: BASE_URL,
			resource: BASE_URL,
		});
		expect(metadata.resource).toBe("https://readplace.com");
	});

	it("points at this deployment's authorization server, scopes, and documentation", () => {
		const metadata = buildProtectedResourceMetadata({
			baseUrl: "https://example.test",
			resource: "https://example.test/mcp",
		});
		expect(metadata).toEqual({
			resource: "https://example.test/mcp",
			resource_name: "Readplace",
			authorization_servers: ["https://example.test"],
			scopes_supported: AGENT_SCOPES_SUPPORTED,
			bearer_methods_supported: ["header"],
			resource_documentation: "https://example.test/auth.md",
		});
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

	it("documents queue as the single full-access level it advertises, without overstating enforcement", () => {
		expect(AGENT_SCOPES_SUPPORTED).toEqual(["queue"]);
		const markdown = renderAuthMarkdown(BASE_URL);
		expect(markdown).toContain("full read/write access");
		expect(markdown).toContain("does not sub-divide");
		expect(markdown).toContain("`queue`");
	});

	it("documents the dynamic client registration endpoint for client_id provisioning", () => {
		expect(renderAuthMarkdown(BASE_URL)).toContain("https://readplace.com/oauth/register");
	});
});
