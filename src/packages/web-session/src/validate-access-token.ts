import { OAuthGrantIdSchema } from "@packages/domain/oauth";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { OAuthModel, ValidateAccessToken } from "@packages/provider-contracts/oauth";

export type { ValidateAccessToken };

export function createValidateAccessToken(model: OAuthModel): ValidateAccessToken {
	return async (accessToken) => {
		const token = await model.getAccessToken(accessToken);
		if (!token) return null;
		return {
			userId: authenticatedUserIdFrom(token.user.id),
			emailVerified: token.user.emailVerified === true,
			oauthClientId: token.client.id,
			oauthGrantId: OAuthGrantIdSchema.optional().parse(token.user.grantId),
		};
	};
}
