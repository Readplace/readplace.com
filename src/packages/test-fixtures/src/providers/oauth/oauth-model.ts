import assert from "node:assert";
import type {
	Client,
	Token,
	AuthorizationCode,
	RefreshToken,
	User,
	Falsey,
} from "@node-oauth/oauth2-server";
import type { OAuthModel } from "@packages/provider-contracts/oauth";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { UserId } from "@packages/domain/user";
import type {
	AccessToken as AccessTokenBrand,
	AuthorizationCode as AuthorizationCodeBrand,
	OAuthClientId,
	RefreshToken as RefreshTokenBrand,
} from "@packages/domain/oauth";
import {
	OAuthClientIdSchema,
	AccessTokenSchema,
	AuthorizationCodeSchema,
	RefreshTokenSchema,
} from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import { getClient } from "./oauth-clients";
import { generateToken } from "./generate-token";

interface StoredAuthorizationCode {
	code: AuthorizationCodeBrand;
	clientId: OAuthClientId;
	userId: UserId;
	redirectUri: string;
	codeChallenge: string;
	codeChallengeMethod: "S256" | "plain";
	expiresAt: Date;
	scope?: string[];
	emailVerified?: boolean;
}

interface StoredToken {
	accessToken: AccessTokenBrand;
	accessTokenExpiresAt: Date;
	refreshToken: RefreshTokenBrand;
	refreshTokenExpiresAt: Date;
	clientId: OAuthClientId;
	userId: UserId;
	scope?: string[];
	emailVerified?: boolean;
}

interface OAuthModelDeps {
	codes: Map<string, StoredAuthorizationCode>;
	tokens: Map<string, StoredToken>;
	refreshTokenIndex: Map<string, string>;
	userIdIndex: Map<string, Set<string>>;
}

export function initInMemoryOAuthModel(): OAuthModelDeps {
	return {
		codes: new Map(),
		tokens: new Map(),
		refreshTokenIndex: new Map(),
		userIdIndex: new Map(),
	};
}

export type { OAuthModel };

export function createOAuthModel(
	deps: OAuthModelDeps,
	options?: { appOrigin?: string; findUserById?: FindUserById },
): OAuthModel {
	const findUserById = options?.findUserById;

	function resolveClient(clientId: string) {
		const client = getClient(clientId);
		if (!client) return null;
		if (!options?.appOrigin?.includes("127.0.0.1")) return client;
		return {
			...client,
			redirectUris: [...client.redirectUris, `${options.appOrigin}/oauth/callback`],
		};
	}

	return {
		async getClient(clientId: string, _clientSecret: string): Promise<Client | Falsey> {
			const client = resolveClient(clientId);
			if (!client) return null;

			return {
				id: client.id,
				grants: client.grants,
				redirectUris: client.redirectUris,
			};
		},

		async saveAuthorizationCode(
			code: AuthorizationCode,
			client: Client,
			user: User,
		): Promise<AuthorizationCode> {
			assert(code.codeChallenge, "PKCE code_challenge is required for authorization_code grants");
			const stored: StoredAuthorizationCode = {
				code: AuthorizationCodeSchema.parse(code.authorizationCode),
				clientId: OAuthClientIdSchema.parse(client.id),
				userId: UserIdSchema.parse(user.id),
				redirectUri: code.redirectUri,
				codeChallenge: code.codeChallenge,
				codeChallengeMethod: code.codeChallengeMethod === "plain" ? "plain" : "S256",
				expiresAt: code.expiresAt,
				scope: code.scope,
				emailVerified: user.emailVerified === true,
			};
			deps.codes.set(code.authorizationCode, stored);
			return {
				...code,
				client,
				user,
			};
		},

		async getAuthorizationCode(
			authorizationCode: string,
		): Promise<AuthorizationCode | Falsey> {
			const stored = deps.codes.get(authorizationCode);
			if (!stored) return null;

			if (stored.expiresAt < new Date()) {
				deps.codes.delete(authorizationCode);
				return null;
			}

			const client = resolveClient(stored.clientId);
			if (!client) return null;

			return {
				authorizationCode: stored.code,
				expiresAt: stored.expiresAt,
				redirectUri: stored.redirectUri,
				scope: stored.scope,
				codeChallenge: stored.codeChallenge,
				codeChallengeMethod: stored.codeChallengeMethod,
				client: {
					id: client.id,
					grants: client.grants,
					redirectUris: client.redirectUris,
				},
				user: { id: stored.userId, emailVerified: stored.emailVerified },
			};
		},

		async revokeAuthorizationCode(code: AuthorizationCode): Promise<boolean> {
			const existed = deps.codes.has(code.authorizationCode);
			deps.codes.delete(code.authorizationCode);
			return existed;
		},

		async saveToken(token: Token, client: Client, user: User): Promise<Token> {
			const refreshToken = token.refreshToken ?? "";
			const accessTokenExpiresAt =
				token.accessTokenExpiresAt ?? new Date(Date.now() + 24 * 3600000);
			const refreshTokenExpiresAt =
				token.refreshTokenExpiresAt ?? new Date(Date.now() + 180 * 24 * 3600000);

			const stored: StoredToken = {
				accessToken: AccessTokenSchema.parse(token.accessToken),
				accessTokenExpiresAt,
				refreshToken: RefreshTokenSchema.parse(refreshToken),
				refreshTokenExpiresAt,
				clientId: OAuthClientIdSchema.parse(client.id),
				userId: UserIdSchema.parse(user.id),
				scope: token.scope,
				emailVerified: user.emailVerified === true,
			};

			deps.tokens.set(token.accessToken, stored);
			if (refreshToken) {
				deps.refreshTokenIndex.set(refreshToken, token.accessToken);
			}

			const userTokens = deps.userIdIndex.get(user.id) ?? new Set();
			userTokens.add(token.accessToken);
			deps.userIdIndex.set(user.id, userTokens);

			return {
				...token,
				client,
				user,
			};
		},

		async getAccessToken(accessToken: string): Promise<Token | Falsey> {
			const stored = deps.tokens.get(accessToken);
			if (!stored) return null;

			if (stored.accessTokenExpiresAt < new Date()) {
				return null;
			}

			const client = resolveClient(stored.clientId);
			if (!client) return null;

			return {
				accessToken: stored.accessToken,
				accessTokenExpiresAt: stored.accessTokenExpiresAt,
				refreshToken: stored.refreshToken,
				refreshTokenExpiresAt: stored.refreshTokenExpiresAt,
				scope: stored.scope,
				client: {
					id: client.id,
					grants: client.grants,
					redirectUris: client.redirectUris,
				},
				user: { id: stored.userId, emailVerified: stored.emailVerified },
			};
		},

		async getRefreshToken(refreshToken: string): Promise<RefreshToken | Falsey> {
			const accessToken = deps.refreshTokenIndex.get(refreshToken);
			if (!accessToken) return null;

			const stored = deps.tokens.get(accessToken);
			if (!stored) return null;

			if (stored.refreshTokenExpiresAt < new Date()) {
				return null;
			}

			const client = resolveClient(stored.clientId);
			if (!client) return null;

			// Re-resolve the standing on refresh so a token authorized while
			// unverified catches up once the user verifies — without it the
			// install-then-verify cohort would re-store emailVerified=false on every
			// refresh and keep paying the userId-index read forever. Verification is
			// monotonic, so an already-verified token needs no lookup.
			let emailVerified = stored.emailVerified === true;
			if (!emailVerified && findUserById) {
				const user = await findUserById(stored.userId);
				if (user) {
					emailVerified = user.emailVerified === true;
				}
			}

			return {
				refreshToken: stored.refreshToken,
				refreshTokenExpiresAt: stored.refreshTokenExpiresAt,
				scope: stored.scope,
				client: {
					id: client.id,
					grants: client.grants,
					redirectUris: client.redirectUris,
				},
				user: { id: stored.userId, emailVerified },
			};
		},

		async revokeToken(token: RefreshToken): Promise<boolean> {
			const accessToken = deps.refreshTokenIndex.get(token.refreshToken);
			if (!accessToken) return false;

			const stored = deps.tokens.get(accessToken);
			if (stored) {
				const userTokens = deps.userIdIndex.get(stored.userId);
				userTokens?.delete(accessToken);
			}

			deps.refreshTokenIndex.delete(token.refreshToken);
			deps.tokens.delete(accessToken);
			return true;
		},

		// TODO: Update this function when scopes are added. Currently returns true
		// because no scopes are implemented. Once scopes are added, this must
		// validate that the token has the requested scope(s).
		async verifyScope(_token: Token, _scope: string | string[]): Promise<boolean> {
			return true;
		},

		async revokeAllUserTokens(userId: UserId): Promise<void> {
			const accessTokens = deps.userIdIndex.get(userId);
			if (!accessTokens) return;

			for (const accessToken of accessTokens) {
				const stored = deps.tokens.get(accessToken);
				if (stored) {
					deps.refreshTokenIndex.delete(stored.refreshToken);
				}
				deps.tokens.delete(accessToken);
			}
			deps.userIdIndex.delete(userId);
		},

		generateAccessToken: async () => generateToken(),
		generateRefreshToken: async () => generateToken(),
		generateAuthorizationCode: async () => generateToken(),
	};
}
