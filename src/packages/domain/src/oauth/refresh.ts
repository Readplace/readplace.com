import { isCurrentGrant, isExemptGrant, type RefreshAccount } from "./current-grant";

export interface RefreshCredential {
	accessToken: string;
	refreshToken: string;
	accessExpiresAt: number;
	refreshExpiresAt: number;
	grantId: string;
	userId: string;
	clientId: string;
	epoch: number;
	generation: number;
	emailVerified: boolean;
	keyThumbprint?: string;
	parentFingerprint?: string;
	scope?: string[];
}

export interface RefreshGrant {
	id: string;
	userId: string;
	clientId: string;
	epoch: number;
	generation: number;
	accessToken: string;
	refreshFingerprint: string;
	keyThumbprint?: string;
	state: "active" | "revoked";
	expiresAt: number;
	latest?: { operationId: string; parentFingerprint: string; bodyHash: string };
}

export interface RefreshHistory {
	grantId: string;
	fingerprint: string;
	expiresAt: number;
	revocation?: { cause: "rotation" | "logout" | "logout-all" | "account-deletion" | "disconnect"; completedAt: number };
}

export interface RefreshProof {
	keyThumbprint: string;
	id: string;
	expiresAt: number;
}

export type RefreshCommit = {
	expectedGrant: RefreshGrant | undefined;
	grant: RefreshGrant;
	proof?: RefreshProof;
	now: number;
	accountEpoch: number;
} & (
	{ cause: "recovery"; parent?: never; child?: never } |
	{ cause: "rotation" | "logout" | "disconnect" | "logout-all" | "account-deletion"; parent?: RefreshCredential; child?: RefreshCredential }
);

export interface RefreshStore {
	locate(token: string): Promise<{ credential?: RefreshCredential; history?: RefreshHistory }>;
	readGrant(id: string): Promise<RefreshGrant | undefined>;
	readCredential(accessToken: string): Promise<RefreshCredential | undefined>;
	readAccount(userId: string): Promise<RefreshAccount>;
	commit(input: RefreshCommit): Promise<"committed" | "conflict" | "proof_replayed">;
}

export type RefreshFailure = {
	ok: false;
	error: "invalid_grant" | "invalid_request" | "invalid_dpop_proof" | "invalid_scope" | "temporarily_unavailable";
	reason: "unknown" | "expired" | "revoked" | "superseded" | "operation_mismatch" | "proof_required" | "key_mismatch" | "proof_replayed" | "invalid_scope" | "enrollment_disabled";
};

export type RotateRefreshInput = {
	clientId: string;
	refreshToken: string;
	now: number;
	operationId?: string;
	bodyHash?: string;
	proof?: RefreshProof;
	scope?: string[];
};

export type RotateRefreshResult = RefreshFailure | {
	ok: true;
	credential: RefreshCredential;
	recovered: boolean;
};

type RevokeRefreshResult = RefreshFailure | {
	ok: true;
	grant?: RefreshGrant;
};

export interface OAuthRefresh {
	readonly enrollmentEnabled: boolean;
	rotate(input: RotateRefreshInput): Promise<RotateRefreshResult>;
	revoke(input: { token: string; clientId?: string; proof?: RefreshProof; now: number }): Promise<RevokeRefreshResult>;
}

export function initOAuthRefresh(deps: {
	enrollmentEnabled: boolean;
	store: RefreshStore;
	fingerprint: (token: string) => string;
	generateToken: () => string;
	resolveEmailVerified: (input: { userId: string; clientId: string; emailVerified: boolean }) => Promise<boolean>;
}): OAuthRefresh {
	function fail(reason: RefreshFailure["reason"]): RefreshFailure {
		const error = reason === "enrollment_disabled" ? "temporarily_unavailable" : reason === "invalid_scope" ? "invalid_scope" : reason === "operation_mismatch" ? "invalid_request"
			: reason === "key_mismatch" || reason === "proof_required" || reason === "proof_replayed" ? "invalid_dpop_proof" : "invalid_grant";
		return { ok: false, error, reason };
	}
	function adopted(credential: RefreshCredential): RefreshGrant {
		return {
			id: credential.grantId, userId: credential.userId, clientId: credential.clientId,
			epoch: credential.epoch, generation: credential.generation, accessToken: credential.accessToken,
			refreshFingerprint: deps.fingerprint(credential.refreshToken), state: "active", expiresAt: credential.refreshExpiresAt,
		};
	}
	function binding(grant: RefreshGrant, proof: RefreshProof | undefined): RefreshFailure | undefined {
		if (!grant.keyThumbprint) return undefined;
		if (!proof) return fail("proof_required");
		if (proof.keyThumbprint !== grant.keyThumbprint) return fail("key_mismatch");
		return undefined;
	}
	async function rotate(input: RotateRefreshInput): Promise<RotateRefreshResult> {
		if (Boolean(input.proof) !== Boolean(input.operationId) || Boolean(input.proof) !== Boolean(input.bodyHash)) return fail("operation_mismatch");
		for (let attempt = 0; attempt < 4; attempt++) {
			const located = await deps.store.locate(input.refreshToken);
			const grantId = located.credential?.grantId ?? located.history?.grantId;
			if (!grantId) return fail("unknown");
			const existing = await deps.store.readGrant(grantId);
			if (!existing && located.credential?.keyThumbprint) throw new Error("Bound refresh grant is missing");
			const grant = existing ?? (located.credential ? adopted(located.credential) : undefined);
			if (!grant) {
				const cause = located.history?.revocation?.cause;
				return fail(cause ? cause === "rotation" ? "superseded" : "revoked" : "unknown");
			}
			if (grant.clientId !== input.clientId) return fail("unknown");
			const rejectedBinding = binding(grant, input.proof);
			if (rejectedBinding) return rejectedBinding;
			if (grant.state !== "active") return fail("revoked");
			const account = await deps.store.readAccount(grant.userId);
			if (!isCurrentGrant({ account, credential: { grantId: grant.id, epoch: grant.epoch } })) {
				if (existing && isExemptGrant({ account, grantId: grant.id })) continue;
				return fail("revoked");
			}
			if (grant.expiresAt <= input.now) return fail("expired");
			if (input.proof && !grant.keyThumbprint && !deps.enrollmentEnabled) return fail("enrollment_disabled");
			const parentFingerprint = deps.fingerprint(input.refreshToken);
			const latest = grant.latest;
			if (latest && latest.operationId === input.operationId && input.operationId) {
				if (latest.parentFingerprint !== parentFingerprint || latest.bodyHash !== input.bodyHash) return fail("operation_mismatch");
				const child = await deps.store.readCredential(grant.accessToken);
				if (!child) throw new Error("Refresh result credential is missing");
				const result = await deps.store.commit({ expectedGrant: existing, grant, proof: input.proof, cause: "recovery", now: input.now, accountEpoch: account.epoch });
				if (result === "proof_replayed") return fail(result);
				if (result === "conflict") continue;
				return { ok: true, credential: child, recovered: true };
			}
			const parent = located.credential;
			if (!parent || grant.refreshFingerprint !== parentFingerprint) return fail("superseded");
			if (parent.refreshExpiresAt <= input.now) return fail("expired");
			if (input.scope?.some(scope => !parent.scope?.includes(scope))) return fail("invalid_scope");
			const child: RefreshCredential = {
				...parent,
				accessToken: deps.generateToken(), refreshToken: deps.generateToken(),
				accessExpiresAt: input.now + 3_600_000,
				refreshExpiresAt: input.now + 180 * 86_400_000,
				epoch: account.epoch,
				generation: grant.generation + 1,
				keyThumbprint: input.proof?.keyThumbprint ?? parent.keyThumbprint,
				parentFingerprint,
				emailVerified: await deps.resolveEmailVerified(parent),
				scope: input.scope ?? parent.scope,
			};
			const next: RefreshGrant = {
				...grant, epoch: account.epoch, generation: child.generation, accessToken: child.accessToken,
				refreshFingerprint: deps.fingerprint(child.refreshToken), expiresAt: child.refreshExpiresAt,
				keyThumbprint: input.proof?.keyThumbprint ?? grant.keyThumbprint,
				latest: input.operationId && input.bodyHash ? { operationId: input.operationId, parentFingerprint, bodyHash: input.bodyHash } : undefined,
			};
			const result = await deps.store.commit({ expectedGrant: existing, grant: next, parent, child, proof: input.proof, cause: "rotation", now: input.now, accountEpoch: account.epoch });
			if (result === "proof_replayed") return fail(result);
			if (result === "conflict") continue;
			return { ok: true, credential: child, recovered: false };
		}
		throw new Error("Concurrent refresh could not settle");
	}
	async function revoke(input: { token: string; clientId?: string; proof?: RefreshProof; now: number }): Promise<RevokeRefreshResult> {
		for (let attempt = 0; attempt < 4; attempt++) {
			const located = await deps.store.locate(input.token);
			const grantId = located.credential?.grantId ?? located.history?.grantId;
			if (!grantId) return { ok: true };
			const existing = await deps.store.readGrant(grantId);
			if (!existing && located.credential?.keyThumbprint) throw new Error("Bound refresh grant is missing");
			const grant = existing ?? (located.credential ? adopted(located.credential) : undefined);
			if (!grant || (input.clientId && input.clientId !== grant.clientId)) return { ok: true };
			const rejectedBinding = binding(grant, input.proof);
			if (rejectedBinding) return rejectedBinding;
			if (grant.state === "revoked") return { ok: true };
			const account = await deps.store.readAccount(grant.userId);
			if (!isCurrentGrant({ account, credential: { grantId: grant.id, epoch: grant.epoch } })) {
				if (existing && isExemptGrant({ account, grantId: grant.id })) continue;
				return { ok: true };
			}
			const parent = await deps.store.readCredential(grant.accessToken);
			const result = await deps.store.commit({ expectedGrant: existing, grant: { ...grant, state: "revoked" }, parent, proof: input.proof, cause: "logout", now: input.now, accountEpoch: account.epoch });
			if (result === "proof_replayed") return fail(result);
			if (result === "conflict") continue;
			return { ok: true, grant };
		}
		throw new Error("Concurrent revocation could not settle");
	}
	return { rotate, revoke, enrollmentEnabled: deps.enrollmentEnabled };
}
