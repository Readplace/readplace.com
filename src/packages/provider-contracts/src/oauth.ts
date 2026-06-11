import type {
	AuthorizationCodeModel,
	RefreshTokenModel,
} from "@node-oauth/oauth2-server";
import type { AccessToken } from "@packages/domain/oauth";
import type { UserId } from "@packages/domain/user";

export type OAuthModel = AuthorizationCodeModel &
	RefreshTokenModel & {
		revokeAllUserTokens(userId: UserId): Promise<void>;
	};

export type ValidateAccessToken = (accessToken: AccessToken) => Promise<UserId | null>;
