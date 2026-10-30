import assert from "node:assert/strict";
import { type OAuthClient, OAuthClientIdSchema, type OAuthSignIn } from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import { initListConnectedOAuthClients } from "./connected-oauth-clients";

const READER = UserIdSchema.parse("usr_connected_reader");
const CLAUDE_ID = OAuthClientIdSchema.parse("dyn_claude");
const SWEPT_ID = OAuthClientIdSchema.parse("dyn_swept");

const CLAUDE: OAuthClient = {
	id: CLAUDE_ID,
	name: "Claude",
	redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
	grants: ["authorization_code", "refresh_token"],
};

const SIGNED_IN_FROM_SYDNEY: OAuthSignIn = { at: 1_760_000_000_000, location: { city: "Sydney", country: "AU" } };

describe("initListConnectedOAuthClients", () => {
	it("lists only the granted clients that still resolve, each with its latest sign-in", async () => {
		const listConnectedOAuthClients = initListConnectedOAuthClients({
			listUserOAuthClients: async (userId) => {
				assert.equal(userId, READER);
				return [
					{ clientId: CLAUDE_ID, latestSignIn: SIGNED_IN_FROM_SYDNEY },
					{ clientId: SWEPT_ID, latestSignIn: undefined },
				];
			},
			findOAuthClient: async (clientId) => (clientId === CLAUDE_ID ? CLAUDE : undefined),
		});

		assert.deepEqual(await listConnectedOAuthClients(READER), [{ client: CLAUDE, latestSignIn: SIGNED_IN_FROM_SYDNEY }]);
	});
});
