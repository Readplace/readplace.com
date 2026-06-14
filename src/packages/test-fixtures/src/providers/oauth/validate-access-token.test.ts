import type { AccessToken } from "@packages/domain/oauth";
import type { UserId } from "@packages/domain/user";
import type { OAuthModel } from "./oauth-model";
import { createValidateAccessToken } from "./validate-access-token";

describe("createValidateAccessToken", () => {
	it("returns the userId and verified standing when the token is verified", async () => {
		const expectedUserId = "user-42" as UserId;
		const model = {
			getAccessToken: async () => ({
				accessToken: "valid-token",
				client: { id: "c", grants: [] },
				user: { id: expectedUserId, emailVerified: true },
			}),
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate("valid-token" as AccessToken);

		expect(result).toEqual({ userId: expectedUserId, emailVerified: true });
	});

	it("reports a token minted for an unverified account as not verified", async () => {
		const expectedUserId = "user-7" as UserId;
		const model = {
			getAccessToken: async () => ({
				accessToken: "valid-token",
				client: { id: "c", grants: [] },
				user: { id: expectedUserId },
			}),
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate("valid-token" as AccessToken);

		expect(result).toEqual({ userId: expectedUserId, emailVerified: false });
	});

	it("returns null when the token is not found", async () => {
		const model = {
			getAccessToken: async () => null,
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate("missing-token" as AccessToken);

		expect(result).toBeNull();
	});
});
