import type {
	AuthorizationCodeModel,
	RefreshTokenModel,
} from "@node-oauth/oauth2-server";
import type { AccessToken, OAuthClient } from "@packages/domain/oauth";
import type { AuthenticatedUserId, UserId } from "@packages/domain/user";

export type OAuthModel = AuthorizationCodeModel & RefreshTokenModel;

export type ValidateAccessToken = (
	accessToken: AccessToken,
) => Promise<{
	userId: AuthenticatedUserId;
	emailVerified: boolean;
	oauthClientId: string;
} | null>;

export type RevokeAllUserOAuthTokens = (userId: UserId) => Promise<void>;

export interface RegisterOAuthClientInput {
	redirectUris: string[];
	clientName?: string;
	grants: string[];
	tokenEndpointAuthMethod: string;
}

export interface RegisteredOAuthClient extends OAuthClient {
	clientIdIssuedAt: number;
	tokenEndpointAuthMethod: string;
}

/** Resolve a client (built-in or dynamically registered) by its id. */
export type FindOAuthClient = (clientId: string) => Promise<OAuthClient | undefined>;

/** Whether `redirectUri` is permitted for `clientId` (exact match for dynamic clients). */
export type ValidateOAuthRedirectUri = (params: {
	clientId: string;
	redirectUri: string;
}) => Promise<boolean>;

/** Mark a dynamic client as used so its row's sliding TTL extends; no-op for built-ins. */
export type MarkOAuthClientActive = (clientId: string) => Promise<void>;

/** RFC 7591 dynamic client registration. */
export type RegisterOAuthClient = (
	input: RegisterOAuthClientInput,
) => Promise<RegisteredOAuthClient>;
