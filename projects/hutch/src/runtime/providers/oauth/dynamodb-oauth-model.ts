/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import { authDiagnosticContext } from "../../auth-diagnostics/record";
import { attributeOAuthClient } from "../../auth-diagnostics/oauth-context";
import { initAuthDiagnosticPermits } from "../../auth-diagnostics/permit";
import { randomUUID } from "node:crypto";
import { initDynamoRefreshStore } from "./dynamodb-refresh-store";
import { initRefreshProof } from "../../oauth-refresh/evidence";
import { OAuthGrantId } from "../../oauth-refresh/evidence";
import { OAuthTokenRow, initOAuthCredentialLifecycle } from "./oauth-credential-lifecycle";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
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
import { UserIdSchema } from "@packages/domain/user";
import type {
	FindOAuthClient,
	ListUserOAuthClients,
	MarkOAuthClientActive,
	OAuthModel,
	RevokeAllUserOAuthTokens,
	RevokeUserOAuthClient,
} from "@packages/provider-contracts/oauth";
import type { FindUserById } from "@packages/provider-contracts/auth";
import { generateToken, initOAuthRefresh } from "@packages/domain/oauth";

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
	grantId: OAuthGrantId.optional(),
	epoch: z.number().optional(),
});

export function initRevokeAllUserOAuthTokens(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	secret: string;
}): RevokeAllUserOAuthTokens {
	return initOAuthCredentialLifecycle(deps).revokeAll;
}

export function initDynamoDbOAuthModel(deps: {
	enrollmentEnabled: boolean;
	client: DynamoDBDocumentClient;
	tableName: string;
	findUserById: FindUserById;
	findClient: FindOAuthClient;
	markClientActive: MarkOAuthClientActive;
	secret: string;
}): OAuthModel & {
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
	listUserOAuthClients: ListUserOAuthClients;
	revokeUserOAuthClient: RevokeUserOAuthClient;
} {
	const { client, tableName, findUserById, findClient, markClientActive } = deps;
	const authCodes = defineDynamoTable({ client, tableName, schema: AuthCodeRow });
	const tokens = defineDynamoTable({ client, tableName, schema: OAuthTokenRow });
	const credentials = initOAuthCredentialLifecycle(deps);
	const atomic = initDynamoRefreshStore(deps);
	const references = initAuthDiagnosticPermits({ salt: deps.secret, now: () => new Date() });
	const refresh = initOAuthRefresh({ enrollmentEnabled: deps.enrollmentEnabled, store: atomic.store, fingerprint: initRefreshProof(deps.secret).fingerprint, generateToken,
		resolveEmailVerified: async value => {
			await markClientActive(value.clientId);
			return value.emailVerified || (await findUserById(UserIdSchema.parse(value.userId)))?.emailVerified === true;
		},
	});

	async function resolveClient(clientId: string): Promise<Client | null> {
		const found = await findClient(clientId);
		if (!found) return null;
		return { id: found.id, grants: found.grants, redirectUris: found.redirectUris };
	}

	return {
		refresh,
		revokeAllUserOAuthTokens: credentials.revokeAll,
		listUserOAuthClients: credentials.listClients,
		revokeUserOAuthClient: credentials.revokeClient,
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
					grantId: OAuthGrantId.parse(randomUUID()),
					epoch: (await atomic.store.readAccount(user.id)).epoch,
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
			if (!row || (await atomic.store.readAccount(row.userId)).epoch !== (row.epoch ?? 0)) return null;

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
				user: { id: row.userId, emailVerified: row.emailVerified, grantId: row.grantId, epoch: row.epoch ?? 0 },
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
			const grant = credentials.grant(user);
			const accessTokenExpiresAt =
				token.accessTokenExpiresAt ?? new Date(Date.now() + 24 * 3600000);
			const refreshTokenExpiresAt =
				token.refreshTokenExpiresAt ?? new Date(Date.now() + 180 * 24 * 3600000);

			await atomic.saveInitial({
				grantId: grant.grantId, parentFingerprint: grant.parentFingerprint, epoch: typeof user.epoch === "number" ? user.epoch : (await atomic.store.readAccount(user.id)).epoch, generation: 0,
				userId: user.id, clientId: oauthClient.id, accessToken: token.accessToken, refreshToken,
				accessExpiresAt: accessTokenExpiresAt.getTime(), refreshExpiresAt: refreshTokenExpiresAt.getTime(),
				scope: token.scope, emailVerified: user.emailVerified === true,
			});

			// Token issuance is the "used" signal that extends a dynamic client's
			// sliding TTL past the refresh-token lifetime; no-op for built-ins.
			await markClientActive(oauthClient.id);

			return { ...token, client: oauthClient, user: { ...user, grantId: grant.grantId } };
		},

		async getAccessToken(accessToken: string): Promise<Token | Falsey> {
			const row = await tokens.get({ pk: `token#${accessToken}` }, { consistentRead: true });
			if (!row) return null;
			attributeOAuthClient(row.clientId);
			const context = authDiagnosticContext.getStore();
			if (context) {
				context.grant_id = row.grantId;
				context.subject_ref = references.reference({ kind: "subject", value: row.userId });
			}
			if (!await atomic.active(row)) {
				if (context) context.auth_refusal_reason = "revoked";
				return null;
			}

			const accessTokenExpiresAt = new Date(row.accessTokenExpiresAt * 1000);
			if (accessTokenExpiresAt < new Date()) {
				if (context) context.auth_refusal_reason = "expired";
				return null;
			}

			const oauthClient = await resolveClient(row.clientId);
			if (!oauthClient) return null;


			return {
				accessToken: row.accessToken,
				accessTokenExpiresAt,
				refreshToken: row.refreshToken,
				refreshTokenExpiresAt: new Date(row.refreshTokenExpiresAt * 1000),
				scope: row.scope,
				client: oauthClient,
				user: { id: row.userId, emailVerified: row.emailVerified, grantId: row.grantId },
			};
		},

		async getRefreshToken(refreshToken: string): Promise<RefreshToken | Falsey> {
			const found = await credentials.findRefresh(refreshToken);
			if (!found) return null;
			const { row, credential } = found;
			if (!await atomic.active(row) || (await atomic.store.readGrant(credential.grantId))?.keyThumbprint) return null;
			const refreshTokenExpiresAt = new Date(row.refreshTokenExpiresAt * 1000);

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
				user: { id: row.userId, emailVerified, grantId: credential.grantId, parentFingerprint: credential.fingerprint },
			};
		},

		revokeToken(token: RefreshToken): Promise<boolean> {
			return credentials.revoke(token.refreshToken);
		},

		async verifyScope(_token: Token, _scope: string | string[]): Promise<boolean> {
			return true;
		},

		generateAccessToken: async () => generateToken(),
		generateRefreshToken: async () => generateToken(),
		generateAuthorizationCode: async () => generateToken(),
	};
}
/* c8 ignore stop */
