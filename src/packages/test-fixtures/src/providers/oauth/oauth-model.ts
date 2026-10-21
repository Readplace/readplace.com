import assert from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { type AdvanceEpochKeeping, initKeepCurrentGrant, initOAuthRefresh, isCurrentGrant, laterSignIn, type OAuthGrantId, type OAuthSignIn, OAuthSignInSchema, type RefreshAccount, type RefreshCredential, type RefreshExemption, type RefreshGrant, type RefreshHistory, type RefreshStore } from "@packages/domain/oauth";
import type {
	Client,
	Token,
	AuthorizationCode,
	User,
	Falsey,
} from "@node-oauth/oauth2-server";
import type {
	MarkOAuthClientActive,
	FindOAuthClient,
	ListUserOAuthClients,
	OAuthModel,
	RevokeAllUserOAuthTokens,
	RevokeOtherUserOAuthGrants,
	RevokeUserOAuthClient,
} from "@packages/provider-contracts/oauth";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { UserId } from "@packages/domain/user";
import type {
	AccessToken as AccessTokenBrand,
	AuthorizationCode as AuthorizationCodeBrand,
	OAuthClient,
	OAuthClientId,
	RefreshToken as RefreshTokenBrand,
} from "@packages/domain/oauth";
import {
	OAuthClientIdSchema,
	AccessTokenSchema,
	AuthorizationCodeSchema,
	RefreshTokenSchema,
	getBuiltInClient,
} from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import { generateToken } from "@packages/domain/oauth";

interface StoredAuthorizationCode {
	grantId?: string;
	epoch?: number;
	code: AuthorizationCodeBrand;
	clientId: OAuthClientId;
	userId: UserId;
	redirectUri: string;
	codeChallenge: string;
	codeChallengeMethod: "S256" | "plain";
	expiresAt: Date;
	scope?: string[];
	emailVerified?: boolean;
	signedIn?: OAuthSignIn;
}

interface StoredToken {
	keyThumbprint?: string;
	grantId?: string;
	epoch?: number;
	generation?: number;
	accessToken: AccessTokenBrand;
	accessTokenExpiresAt: Date;
	refreshToken: RefreshTokenBrand;
	refreshTokenExpiresAt: Date;
	clientId: OAuthClientId;
	userId: UserId;
	scope?: string[];
	emailVerified?: boolean;
	signedIn?: OAuthSignIn;
}

interface OAuthModelDeps {
	deletedAccounts: Set<string>;
	grants: Map<string, RefreshGrant>;
	history: Map<string, RefreshHistory>;
	epochs: Map<string, number>;
	exemptions: Map<string, RefreshExemption>;
	proofs: Map<string, number>;
	codes: Map<string, StoredAuthorizationCode>;
	tokens: Map<string, StoredToken>;
	refreshTokenIndex: Map<string, string>;
	userIdIndex: Map<string, Set<string>>;
}

export function initInMemoryOAuthModel(): OAuthModelDeps {
	return {
		deletedAccounts: new Set(),
		grants: new Map(), history: new Map(), epochs: new Map(), exemptions: new Map(), proofs: new Map(),
		codes: new Map(),
		tokens: new Map(),
		refreshTokenIndex: new Map(),
		userIdIndex: new Map(),
	};
}

export type { OAuthModel };

function retainRevocation(deps: OAuthModelDeps, stored: StoredToken, cause: "logout-all" | "account-deletion" | "disconnect"): void {
	const fingerprint = createHash("sha256").update(stored.refreshToken).digest("hex");
	stored.grantId ??= randomUUID();
	deps.history.set(fingerprint, { grantId: stored.grantId, fingerprint, expiresAt: stored.refreshTokenExpiresAt.getTime(), revocation: { cause, completedAt: Date.now() } });
}

function sweep(deps: OAuthModelDeps, input: { userId: string; cause: "logout-all" | "account-deletion"; spare: OAuthGrantId | undefined }): void {
	const accessTokens = deps.userIdIndex.get(input.userId);
	if (accessTokens) {
		for (const accessToken of accessTokens) {
			const stored = deps.tokens.get(accessToken);
			if (stored && input.spare !== undefined && stored.grantId === input.spare) continue;
			if (stored) retainRevocation(deps, stored, input.cause);
			if (stored?.refreshToken) deps.refreshTokenIndex.delete(stored.refreshToken);
			deps.tokens.delete(accessToken);
			accessTokens.delete(accessToken);
		}
		if (accessTokens.size === 0) deps.userIdIndex.delete(input.userId);
	}
	for (const [code, stored] of deps.codes) {
		if (stored.userId === input.userId) deps.codes.delete(code);
	}
}

export function createRevokeAllUserOAuthTokens(deps: OAuthModelDeps): RevokeAllUserOAuthTokens {
	return async (userId, cause) => {
		deps.epochs.set(userId, (deps.epochs.get(userId) ?? 0) + 1);
		if (cause === "account-deletion") deps.deletedAccounts.add(userId);
		sweep(deps, { userId, cause, spare: undefined });
	};
}

export function createRevokeOtherUserOAuthGrants(deps: OAuthModelDeps): RevokeOtherUserOAuthGrants {
	const { store, advanceEpochKeeping } = createInMemoryRefreshStore(deps);
	const keepCurrentGrant = initKeepCurrentGrant({ store, advanceEpochKeeping });
	return async ({ userId, keep }) => {
		const kept = keep !== undefined && (await keepCurrentGrant({ userId, grantId: keep })) ? keep : undefined;
		if (kept === undefined) deps.epochs.set(userId, (deps.epochs.get(userId) ?? 0) + 1);
		sweep(deps, { userId, cause: "logout-all", spare: kept });
		return { kept };
	};
}

export function createInMemoryRefreshStore(deps: OAuthModelDeps): { store: RefreshStore; fingerprint: (token: string) => string; advanceEpochKeeping: AdvanceEpochKeeping } {
	const fingerprint = (token: string) => createHash("sha256").update(token).digest("hex");
	function credential(row: StoredToken): RefreshCredential {
		row.grantId ??= randomUUID();
		return { ...row, grantId: row.grantId, epoch: row.epoch ?? 0, generation: row.generation ?? 0, emailVerified: row.emailVerified === true,
			accessExpiresAt: row.accessTokenExpiresAt.getTime(), refreshExpiresAt: row.refreshTokenExpiresAt.getTime() };
	}
	function saveCredential(value: RefreshCredential) {
		const row: StoredToken = { ...value, accessToken: AccessTokenSchema.parse(value.accessToken), refreshToken: RefreshTokenSchema.parse(value.refreshToken),
			clientId: OAuthClientIdSchema.parse(value.clientId), userId: UserIdSchema.parse(value.userId), accessTokenExpiresAt: new Date(value.accessExpiresAt), refreshTokenExpiresAt: new Date(value.refreshExpiresAt) };
		deps.tokens.set(value.accessToken, row);
		deps.refreshTokenIndex.set(value.refreshToken, value.accessToken);
		const userTokens = deps.userIdIndex.get(value.userId) ?? new Set<string>();
		userTokens.add(value.accessToken); deps.userIdIndex.set(value.userId, userTokens);
	}
	const account = (userId: string): RefreshAccount => ({ epoch: deps.epochs.get(userId) ?? 0, exemption: deps.exemptions.get(userId) });
	const store: RefreshStore = {
		async locate(token) {
			const row = deps.tokens.get(deps.refreshTokenIndex.get(token) ?? token);
			return { credential: row ? credential(row) : undefined, history: deps.history.get(fingerprint(token)) };
		},
		async readGrant(id) { return deps.grants.get(id); },
		async readAccount(userId) { return account(userId); },
		async readCredential(accessToken) { const row = deps.tokens.get(accessToken); return row ? credential(row) : undefined; },
		async commit(input) {
			const current = deps.grants.get(input.grant.id);
			if (deps.deletedAccounts.has(input.grant.userId) || (deps.epochs.get(input.grant.userId) ?? 0) !== input.accountEpoch || JSON.stringify(current) !== JSON.stringify(input.expectedGrant)) return "conflict";
			const proofKey = input.proof ? `${input.proof.keyThumbprint}:${input.proof.id}` : undefined;
			if (proofKey && (deps.proofs.get(proofKey) ?? 0) > input.now) return "proof_replayed";
			if (input.parent && !deps.tokens.has(input.parent.accessToken)) return "conflict";
			if (proofKey && input.proof) deps.proofs.set(proofKey, input.proof.expiresAt);
			if (input.parent) {
				deps.tokens.delete(input.parent.accessToken); deps.refreshTokenIndex.delete(input.parent.refreshToken);
				deps.userIdIndex.get(input.parent.userId)?.delete(input.parent.accessToken);
				deps.history.set(fingerprint(input.parent.refreshToken), { grantId: input.parent.grantId, fingerprint: fingerprint(input.parent.refreshToken), expiresAt: input.parent.refreshExpiresAt,
					revocation: { cause: input.cause === "logout" ? "logout" : "rotation", completedAt: input.now } });
			}
			if (input.child) saveCredential(input.child);
			deps.grants.set(input.grant.id, input.grant);
			return "committed";
		},
	};
	const advanceEpochKeeping: AdvanceEpochKeeping = async input => {
		if (deps.deletedAccounts.has(input.userId) || (deps.epochs.get(input.userId) ?? 0) !== input.exemption.atEpoch - 1 || JSON.stringify(deps.grants.get(input.expectedGrant.id)) !== JSON.stringify(input.expectedGrant)) return "conflict";
		deps.epochs.set(input.userId, input.exemption.atEpoch);
		deps.exemptions.set(input.userId, input.exemption);
		return "committed";
	};
	return { store, fingerprint, advanceEpochKeeping };
}

export function createListUserOAuthClients(deps: OAuthModelDeps): ListUserOAuthClients {
	return async (userId) => {
		const now = new Date();
		const latest = new Map<OAuthClientId, OAuthSignIn | undefined>();
		for (const stored of deps.tokens.values()) {
			if (stored.userId === userId && (stored.accessTokenExpiresAt > now || stored.refreshTokenExpiresAt > now)) {
				latest.set(stored.clientId, laterSignIn(latest.get(stored.clientId), stored.signedIn));
			}
		}
		return [...latest].map(([clientId, latestSignIn]) => ({ clientId, latestSignIn }));
	};
}

export function createRevokeUserOAuthClient(deps: OAuthModelDeps): RevokeUserOAuthClient {
	return async ({ userId, clientId }) => {
		for (const [id, grant] of deps.grants) {
			if (grant.userId === userId && grant.clientId === clientId) deps.grants.set(id, { ...grant, state: "revoked" });
		}
		for (const [accessToken, stored] of deps.tokens) {
			if (stored.userId !== userId || stored.clientId !== clientId) continue;
			retainRevocation(deps, stored, "disconnect");
			deps.refreshTokenIndex.delete(stored.refreshToken);
			deps.tokens.delete(accessToken);
			const userTokens = deps.userIdIndex.get(userId);
			assert(userTokens, "every stored token is indexed under its user");
			userTokens.delete(accessToken);
		}
		for (const [code, stored] of deps.codes) {
			if (stored.userId === userId && stored.clientId === clientId) deps.codes.delete(code);
		}
	};
}

export function createOAuthModel(
	deps: OAuthModelDeps,
	options?: {
		refreshEnrollmentEnabled?: boolean;
		appOrigin?: string;
		findUserById?: FindUserById;
		findClient?: FindOAuthClient;
		markClientActive?: MarkOAuthClientActive;
	},
): OAuthModel {
	const findUserById = options?.findUserById;
	const findClient = options?.findClient;
	const markClientActive = options?.markClientActive;

	async function resolveClient(clientId: string): Promise<OAuthClient | null> {
		const resolved = findClient
			? (await findClient(clientId)) ?? null
			: getBuiltInClient(clientId) ?? null;
		if (!resolved) return null;
		// A dev/e2e server binds a dynamic loopback port, but built-in clients only
		// register fixed ports; oauth2-server exact-matches redirect_uri at both
		// authorize and token time, so add this origin's callback for built-ins on a
		// 127.0.0.1 appOrigin. Dynamically-registered clients already carry their
		// exact redirect_uri, so they are never augmented.
		if (getBuiltInClient(clientId) && options?.appOrigin?.includes("127.0.0.1")) {
			return {
				...resolved,
				redirectUris: [...resolved.redirectUris, `${options.appOrigin}/oauth/callback`],
			};
		}
		return resolved;
	}

	const { store, fingerprint } = createInMemoryRefreshStore(deps);
	const refresh = initOAuthRefresh({ enrollmentEnabled: options?.refreshEnrollmentEnabled ?? true, store, fingerprint, generateToken,
		resolveEmailVerified: async value => {
			if (markClientActive) await markClientActive(value.clientId);
			return value.emailVerified || (findUserById ? (await findUserById(UserIdSchema.parse(value.userId)))?.emailVerified === true : false);
		},
	});
	async function active(row: StoredToken): Promise<boolean> {
		const grant = row.grantId ? deps.grants.get(row.grantId) : undefined;
		return isCurrentGrant({ account: await store.readAccount(row.userId), credential: { grantId: row.grantId, epoch: row.epoch ?? 0 } }) && (!grant || (grant.state === "active" && grant.generation === (row.generation ?? 0)));
	}
	return {
		refresh,
		async getClient(clientId: string, _clientSecret: string): Promise<Client | Falsey> {
			const client = await resolveClient(clientId);
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
				grantId: randomUUID(), epoch: deps.epochs.get(user.id) ?? 0,
				clientId: OAuthClientIdSchema.parse(client.id),
				userId: UserIdSchema.parse(user.id),
				redirectUri: code.redirectUri,
				codeChallenge: code.codeChallenge,
				codeChallengeMethod: code.codeChallengeMethod === "plain" ? "plain" : "S256",
				expiresAt: code.expiresAt,
				scope: code.scope,
				emailVerified: user.emailVerified === true,
				signedIn: OAuthSignInSchema.optional().parse(user.signedIn),
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
			if (!stored || (deps.epochs.get(stored.userId) ?? 0) !== (stored.epoch ?? 0)) return null;

			if (stored.expiresAt < new Date()) {
				deps.codes.delete(authorizationCode);
				return null;
			}

			const client = await resolveClient(stored.clientId);
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
				user: { id: stored.userId, emailVerified: stored.emailVerified, grantId: stored.grantId, epoch: stored.epoch ?? 0, signedIn: stored.signedIn },
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

			const epoch = typeof user.epoch === "number" ? user.epoch : deps.epochs.get(user.id) ?? 0;
			if (deps.deletedAccounts.has(user.id) || epoch !== (deps.epochs.get(user.id) ?? 0)) throw new Error("Authorization was revoked");
			const stored: StoredToken = {
				grantId: typeof user.grantId === "string" ? user.grantId : randomUUID(), epoch, generation: 0,
				accessToken: AccessTokenSchema.parse(token.accessToken),
				accessTokenExpiresAt,
				refreshToken: RefreshTokenSchema.parse(refreshToken),
				refreshTokenExpiresAt,
				clientId: OAuthClientIdSchema.parse(client.id),
				userId: UserIdSchema.parse(user.id),
				scope: token.scope,
				emailVerified: user.emailVerified === true,
				signedIn: OAuthSignInSchema.optional().parse(user.signedIn),
			};

			deps.tokens.set(token.accessToken, stored);
			if (refreshToken) {
				deps.refreshTokenIndex.set(refreshToken, token.accessToken);
			}

			const userTokens = deps.userIdIndex.get(user.id) ?? new Set();
			userTokens.add(token.accessToken);
			deps.userIdIndex.set(user.id, userTokens);

			if (markClientActive) await markClientActive(client.id);

			return {
				...token,
				client,
				user: { ...user, grantId: stored.grantId },
			};
		},

		async getAccessToken(accessToken: string): Promise<Token | Falsey> {
			const stored = deps.tokens.get(accessToken);
			if (!stored || !(await active(stored))) return null;

			if (stored.accessTokenExpiresAt < new Date()) {
				return null;
			}

			const client = await resolveClient(stored.clientId);
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
				user: { id: stored.userId, emailVerified: stored.emailVerified, grantId: stored.grantId, epoch: stored.epoch ?? 0 },
			};
		},

		async verifyScope(_token: Token, _scope: string | string[]): Promise<boolean> {
			return true;
		},

		generateAccessToken: async () => generateToken(),
		generateRefreshToken: async () => generateToken(),
		generateAuthorizationCode: async () => generateToken(),
	};
}
