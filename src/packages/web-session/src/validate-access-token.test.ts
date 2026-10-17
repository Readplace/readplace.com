import { AccessTokenSchema } from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import type { OAuthModel } from "@packages/provider-contracts/oauth";
import { createValidateAccessToken } from "./validate-access-token";

describe("createValidateAccessToken", () => {
	it("returns the userId and verified standing when the token is verified", async () => {
		const expectedUserId = UserIdSchema.parse("user-42");
		const model = {
			getAccessToken: async () => ({
				accessToken: "valid-token",
				client: { id: "hutch-chrome-extension", grants: [] },
				user: { id: expectedUserId, emailVerified: true },
			}),
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate(AccessTokenSchema.parse("valid-token"));

		expect(result).toEqual({
			userId: expectedUserId,
			emailVerified: true,
			oauthClientId: "hutch-chrome-extension",
			oauthGrantId: undefined,
		});
	});

	it("returns the grant the token was minted under", async () => {
		const expectedUserId = UserIdSchema.parse("user-42");
		const model = {
			getAccessToken: async () => ({
				accessToken: "valid-token",
				client: { id: "ios-app", grants: [] },
				user: { id: expectedUserId, emailVerified: true, grantId: "grant-7" },
			}),
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate(AccessTokenSchema.parse("valid-token"));

		expect(result).toEqual({
			userId: expectedUserId,
			emailVerified: true,
			oauthClientId: "ios-app",
			oauthGrantId: "grant-7",
		});
	});

	it("reports a token minted for an unverified account as not verified", async () => {
		const expectedUserId = UserIdSchema.parse("user-7");
		const model = {
			getAccessToken: async () => ({
				accessToken: "valid-token",
				client: { id: "ios-app", grants: [] },
				user: { id: expectedUserId },
			}),
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate(AccessTokenSchema.parse("valid-token"));

		expect(result).toEqual({
			userId: expectedUserId,
			emailVerified: false,
			oauthClientId: "ios-app",
			oauthGrantId: undefined,
		});
	});

	it("returns null when the token is not found", async () => {
		const model = {
			getAccessToken: async () => null,
		} as unknown as OAuthModel;

		const validate = createValidateAccessToken(model);
		const result = await validate(AccessTokenSchema.parse("missing-token"));

		expect(result).toBeNull();
	});
});
