import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import { OAuthClientIdSchema, type OAuthClient } from "@packages/domain/oauth";
import { initResolveMcpSaveProvenance, resolveSaveProvenance } from "./save-provenance";

const builtInClients = SUPPORTED_CLIENTS.flatMap((client) =>
	client.auth.kind === "builtIn" ? [{ id: client.auth.oauthClientId, name: client.name }] : [],
);

describe("resolveSaveProvenance", () => {
	it("names the client behind every built-in OAuth id", () => {
		expect(builtInClients.map((client) => resolveSaveProvenance(client.id))).toEqual(
			builtInClients.map((client) => ({ kind: "client", clientName: client.name })),
		);
	});

	it("reads a cookie session with no bearer as the web app", () => {
		expect(resolveSaveProvenance(undefined)).toEqual({ kind: "web" });
	});

	it("carries a dynamically registered client's id through for the reader to resolve", () => {
		expect(resolveSaveProvenance("dyn-registered-mcp-client")).toEqual({
			kind: "mcp",
			registeredName: "dyn-registered-mcp-client",
		});
	});
});

describe("initResolveMcpSaveProvenance", () => {
	it("names the client behind every built-in OAuth id without a lookup", async () => {
		const lookups: string[] = [];
		const resolve = initResolveMcpSaveProvenance({
			findOAuthClient: async (clientId) => {
				lookups.push(clientId);
				return undefined;
			},
		});

		const resolved = await Promise.all(builtInClients.map((client) => resolve(client.id)));

		expect(resolved).toEqual(builtInClients.map((client) => ({ kind: "client", clientName: client.name })));
		expect(lookups).toEqual([]);
	});

	it("carries the name a dynamically registered client registered under", async () => {
		const registered: OAuthClient = {
			id: OAuthClientIdSchema.parse("dyn-registered-mcp-client"),
			name: "Claude",
			redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
			grants: ["authorization_code"],
		};
		const resolve = initResolveMcpSaveProvenance({ findOAuthClient: async () => registered });

		expect(await resolve("dyn-registered-mcp-client")).toEqual({
			kind: "mcp",
			registeredName: "Claude",
		});
	});

	it("falls back to the client id when the registration has expired", async () => {
		const resolve = initResolveMcpSaveProvenance({ findOAuthClient: async () => undefined });

		expect(await resolve("dyn-registered-mcp-client")).toEqual({
			kind: "mcp",
			registeredName: "dyn-registered-mcp-client",
		});
	});
});
