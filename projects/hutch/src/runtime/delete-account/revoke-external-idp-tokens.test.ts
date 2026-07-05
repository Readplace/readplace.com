import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { initNoopRevokeExternalIdpTokens } from "./revoke-external-idp-tokens";

describe("initNoopRevokeExternalIdpTokens", () => {
	it("resolves without throwing — no external IdP refresh token is persisted yet", async () => {
		const revokeExternalIdpTokens = initNoopRevokeExternalIdpTokens({
			logger: HutchLogger.from(noopLogger),
		});

		await assert.doesNotReject(revokeExternalIdpTokens(UserIdSchema.parse("user-1")));
	});
});
