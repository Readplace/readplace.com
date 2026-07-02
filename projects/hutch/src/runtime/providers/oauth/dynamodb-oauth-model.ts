/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import type {
	AuthorizationCode,
	Client,
	Falsey,
	RefreshToken,
	Token,
	User,
} from "@node-oauth/oauth2-server";
import type { UserId } from "@packages/domain/user";
import { UserIdSchema } from "@packages/domain/user";
import type {
	FindOAuthClient,
	MarkOAuthClientActive,
	OAuthModel,
} from "@packages/provider-contracts/oauth";
import type { FindUserById } from "@packages/provider-contracts/auth";
import { generateToken } from "@packages/test-fixtures/providers/oauth";

function toEpochSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

const AuthCodeRow = z.object({
	pk: z.string(),
	expiresAt: z.number(),
	clientId: z.string(),
	userId: z.string(),
	redirectUri: z.string(),
	codeChallenge: z.string(),
	codeChallengeMethod: z.enum(["S256", "plain"]),
	scope: z.array(z.string()).optional(),
	emailVerified: z.boolean(),
});

const TokenRow = z.object({
	pk: z.string(),
	accessToken: z.string(),
	refreshToken: z.string(),
	accessTokenExpiresAt: z.number(),
	refreshTokenExpiresAt: z.number(),
	clientId: z.string(),
	userId: z.string(),
	scope: z.array(z.string()).optional(),
	emailVerified: z.boolean().optional(),
});

const RefreshIndexRow = z.object({
	pk: z.string(),
	accessToken: z.string(),
});

const RevokeItemRow = z.object({ pk: z.string(), refreshToken: z.string().optional() });

export function initDynamoDbOAuthModel(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	findUserById: FindUserById;
	findClient: FindOAuthClient;
	markClientActive: MarkOAuthClientActive;
}): OAuthModel {
	const { client, tableName, findUserById, findClient, markClientActive } = deps;
	const authCodes = defineDynamoTable({ client, tableName, schema: AuthCodeRow });
	const tokens = defineDynamoTable({ client, tableName, schema: TokenRow });
	const refreshIndex = defineDynamoTable({ client, tableName, schema: RefreshIndexRow });
	const revokeView = defineDynamoTable({ client, tableName, schema: RevokeItemRow });

	async function resolveClient(clientId: string): Promise<Client | null> {
		const found = await findClient(clientId);
		if (!found) return null;
		return { id: found.id, grants: found.grants, redirectUris: found.redirectUris };
	}

	return {
		async getClient(clientId: string, _clientSecret: string): Promise<Client | Falsey> {
			return resolveClient(clientId);
		},

		async saveAuthorizationCode(
			code: AuthorizationCode,
			oauthClient: Client,
			user: User,
		): Promise<AuthorizationCode> {
			assert(code.codeChallenge, "PKCE code_challenge is required for authorization_code grants");

			await authCodes.put({
				Item: {
					pk: `code#${code.authorizationCode}`,
					clientId: oauthClient.id,
					userId: user.id,
					redirectUri: code.redirectUri,
					codeChallenge: code.codeChallenge,
					codeChallengeMethod: code.codeChallengeMethod ?? "S256",
					scope: code.scope,
					expiresAt: toEpochSeconds(code.expiresAt),
					emailVerified: user.emailVerified === true,
				},
			});

			return { ...code, client: oauthClient, user };
		},

		async getAuthorizationCode(
			authorizationCode: string,
		): Promise<AuthorizationCode | Falsey> {
			const row = await authCodes.get({ pk: `code#${authorizationCode}` });
			if (!row) return null;

			const expiresAt = new Date(row.expiresAt * 1000);
			if (expiresAt < new Date()) {
				await authCodes.delete({ Key: { pk: `code#${authorizationCode}` } });
				return null;
			}

			const oauthClient = await resolveClient(row.clientId);
			if (!oauthClient) return null;

			return {
				authorizationCode,
				expiresAt,
				redirectUri: row.redirectUri,
				scope: row.scope,
				codeChallenge: row.codeChallenge,
				codeChallengeMethod: row.codeChallengeMethod,
				client: oauthClient,
				user: { id: row.userId, emailVerified: row.emailVerified },
			};
		},

		async revokeAuthorizationCode(code: AuthorizationCode): Promise<boolean> {
			const existing = await authCodes.get({ pk: `code#${code.authorizationCode}` });
			if (!existing) return false;

			await authCodes.delete({ Key: { pk: `code#${code.authorizationCode}` } });
			return true;
		},

		async saveToken(token: Token, oauthClient: Client, user: User): Promise<Token> {
			const refreshToken = token.refreshToken ?? "";
			const accessTokenExpiresAt =
				token.accessTokenExpiresAt ?? new Date(Date.now() + 24 * 3600000);
			const refreshTokenExpiresAt =
				token.refreshTokenExpiresAt ?? new Date(Date.now() + 180 * 24 * 3600000);

			const ttl = toEpochSeconds(
				refreshTokenExpiresAt > accessTokenExpiresAt
					? refreshTokenExpiresAt
					: accessTokenExpiresAt,
			);

			await tokens.put({
				Item: {
					pk: `token#${token.accessToken}`,
					userId: user.id,
					clientId: oauthClient.id,
					accessToken: token.accessToken,
					refreshToken,
					accessTokenExpiresAt: toEpochSeconds(accessTokenExpiresAt),
					refreshTokenExpiresAt: toEpochSeconds(refreshTokenExpiresAt),
					scope: token.scope,
					expiresAt: ttl,
					emailVerified: user.emailVerified === true,
				},
			});

			if (refreshToken) {
				await refreshIndex.put({
					Item: {
						pk: `refresh#${refreshToken}`,
						accessToken: token.accessToken,
						expiresAt: toEpochSeconds(refreshTokenExpiresAt),
					},
				});
			}

			// Token issuance is the "used" signal that extends a dynamic client's
			// sliding TTL past the refresh-token lifetime; no-op for built-ins.
			await markClientActive(oauthClient.id);

			return { ...token, client: oauthClient, user };
		},

		async getAccessToken(accessToken: string): Promise<Token | Falsey> {
			const row = await tokens.get({ pk: `token#${accessToken}` });
			if (!row) return null;

			const accessTokenExpiresAt = new Date(row.accessTokenExpiresAt * 1000);
			if (accessTokenExpiresAt < new Date()) return null;

			const oauthClient = await resolveClient(row.clientId);
			if (!oauthClient) return null;

			return {
				accessToken: row.accessToken,
				accessTokenExpiresAt,
				refreshToken: row.refreshToken,
				refreshTokenExpiresAt: new Date(row.refreshTokenExpiresAt * 1000),
				scope: row.scope,
				client: oauthClient,
				user: { id: row.userId, emailVerified: row.emailVerified },
			};
		},

		async getRefreshToken(refreshToken: string): Promise<RefreshToken | Falsey> {
			const indexRow = await refreshIndex.get({ pk: `refresh#${refreshToken}` });
			if (!indexRow) return null;

			const row = await tokens.get({ pk: `token#${indexRow.accessToken}` });
			if (!row) return null;

			const refreshTokenExpiresAt = new Date(row.refreshTokenExpiresAt * 1000);
			if (refreshTokenExpiresAt < new Date()) return null;

			const oauthClient = await resolveClient(row.clientId);
			if (!oauthClient) return null;

			// Re-resolve the standing on refresh so a token authorized while
			// unverified catches up once the user verifies — without it the
			// install-then-verify cohort would re-store emailVerified=false on every
			// refresh and keep paying the userId-index read forever. Verification is
			// monotonic, so an already-verified token needs no lookup.
			let emailVerified = row.emailVerified === true;
			if (!emailVerified) {
				const user = await findUserById(UserIdSchema.parse(row.userId));
				if (user) {
					emailVerified = user.emailVerified === true;
				}
			}

			return {
				refreshToken: row.refreshToken,
				refreshTokenExpiresAt,
				scope: row.scope,
				client: oauthClient,
				user: { id: row.userId, emailVerified },
			};
		},

		async revokeToken(token: RefreshToken): Promise<boolean> {
			const indexRow = await refreshIndex.get({ pk: `refresh#${token.refreshToken}` });
			if (!indexRow) return false;

			await refreshIndex.delete({ Key: { pk: `refresh#${token.refreshToken}` } });
			await tokens.delete({ Key: { pk: `token#${indexRow.accessToken}` } });

			return true;
		},

		async verifyScope(_token: Token, _scope: string | string[]): Promise<boolean> {
			return true;
		},

		async revokeAllUserTokens(userId: UserId): Promise<void> {
			await forEachQueryPage(
				revokeView,
				{
					IndexName: "userId-index",
					KeyConditionExpression: "userId = :userId",
					ExpressionAttributeValues: { ":userId": userId },
				},
				async (items) => {
					await Promise.all(
						items.map(async (item) => {
							if (item.pk.startsWith("token#") && item.refreshToken) {
								await refreshIndex.delete({ Key: { pk: `refresh#${item.refreshToken}` } });
							}
							await revokeView.delete({ Key: { pk: item.pk } });
						}),
					);
				},
			);
		},

		generateAccessToken: async () => generateToken(),
		generateRefreshToken: async () => generateToken(),
		generateAuthorizationCode: async () => generateToken(),
	};
}
/* c8 ignore stop */
