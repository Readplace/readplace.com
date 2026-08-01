import type { AccessToken } from "@packages/domain/oauth";
import type { UserId } from "@packages/domain/user";
import type { OAuthModel } from "@packages/provider-contracts/oauth";
import { createValidateAccessToken } from "./validate-access-token";

describe("createValidateAccessToken", () => {
	it("returns the userId and verified standing when the token is verified", async () => {
		const expectedUserId = "user-42" as UserId;
		const model = {
			getAccessToken: async () => ({
				accessToken: "valid-token",
				client: { id: "hutch-chrome-extension", grants: [] },
				user: { id: expectedUserId, emailVerified: true },
			}),
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate("valid-token" as AccessToken);

		expect(result).toEqual({
			userId: expectedUserId,
			emailVerified: true,
			oauthClientId: "hutch-chrome-extension",
		});
	});

	it("reports a token minted for an unverified account as not verified", async () => {
		const expectedUserId = "user-7" as UserId;
		const model = {
			getAccessToken: async () => ({
				accessToken: "valid-token",
				client: { id: "ios-app", grants: [] },
				user: { id: expectedUserId },
			}),
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate("valid-token" as AccessToken);

		expect(result).toEqual({
			userId: expectedUserId,
			emailVerified: false,
			oauthClientId: "ios-app",
		});
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
