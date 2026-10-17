import type { RefreshExemption } from "./current-grant";
import { initOAuthRefresh, type RefreshCredential, type RefreshGrant, type RefreshHistory, type RefreshStore } from "./refresh";

function setup(enrollmentEnabled = true) {
	const original: RefreshCredential = { accessToken: "a0", refreshToken: "r0", accessExpiresAt: 1, refreshExpiresAt: 1_000_000, grantId: "grant", userId: "user", clientId: "client", epoch: 0, generation: 0, emailVerified: true, scope: ["read"] };
	const credentials = new Map([[original.accessToken, original]]);
	const history = new Map<string, RefreshHistory>();
	const grants = new Map<string, RefreshGrant>();
	const proofs = new Set<string>();
	const controls: { epoch: number; exemption: RefreshExemption | undefined; conflicts: number; fail: boolean; beforeReadAccount: (() => void) | undefined } = { epoch: 0, exemption: undefined, conflicts: 0, fail: false, beforeReadAccount: undefined };
	const commits: number[] = [];
	let sequence = 0;
	const store: RefreshStore = {
		async locate(token) { return { credential: [...credentials.values()].find(value => value.refreshToken === token), history: history.get(token) }; },
		async readGrant(id) { return grants.get(id); },
		async readCredential(access) { return credentials.get(access); },
		async readAccount() { controls.beforeReadAccount?.(); return { epoch: controls.epoch, exemption: controls.exemption }; },
		async commit(input) {
			commits.push(input.accountEpoch);
			if (controls.fail) throw new Error("storage unavailable");
			if (controls.conflicts-- > 0) return "conflict";
			if (input.proof && proofs.has(input.proof.id)) return "proof_replayed";
			if (input.proof) proofs.add(input.proof.id);
			if (input.parent) {
				credentials.delete(input.parent.accessToken);
				history.set(input.parent.refreshToken, { grantId: input.parent.grantId, fingerprint: input.parent.refreshToken, expiresAt: input.parent.refreshExpiresAt, revocation: { cause: input.cause === "logout" ? "logout" : "rotation", completedAt: input.now } });
			}
			if (input.child) credentials.set(input.child.accessToken, input.child);
			grants.set(input.grant.id, input.grant);
			return "committed";
		},
	};
	const refresh = initOAuthRefresh({ enrollmentEnabled, store, fingerprint: value => value, generateToken: () => `new${++sequence}`, resolveEmailVerified: async () => true });
	const input = { clientId: "client", refreshToken: "r0", now: 100, operationId: "operation", bodyHash: "body", proof: { keyThumbprint: "key", id: "proof", expiresAt: 1000 } };
	return { refresh, input, credentials, grants, history, controls, commits, original };
}

it("recovers exactly one durable successor after an overnight lost response without extending expiry", async () => {
	const s = setup();
	const first = await s.refresh.rotate(s.input);
	expect(first.ok).toBe(true);
	const recovered = await s.refresh.rotate({ ...s.input, now: 86_400_100, proof: { ...s.input.proof, id: "retry" } });
	expect(recovered).toEqual({ ...first, recovered: true });
	expect(s.credentials.size).toBe(1);
});

it("rejects an automatic transport replay of a proof then recovers with a fresh proof", async () => {
	const s = setup();
	await s.refresh.rotate(s.input);
	expect(await s.refresh.rotate(s.input)).toMatchObject({ ok: false, reason: "proof_replayed" });
	expect((await s.refresh.rotate({ ...s.input, proof: { ...s.input.proof, id: "fresh" } })).ok).toBe(true);
});

it("does not consume a parent when persistence fails", async () => {
	const s = setup(); s.controls.fail = true;
	await expect(s.refresh.rotate(s.input)).rejects.toThrow("storage unavailable");
	expect(s.credentials.get("a0")).toEqual(s.original);
});

it.each([
	{ proof: undefined }, { operationId: undefined }, { bodyHash: undefined },
])("rejects partial operation identity before spending credentials: %j", async replacement => {
	const s = setup();
	expect(await s.refresh.rotate({ ...s.input, ...replacement })).toMatchObject({ reason: "operation_mismatch" });
});

it("keeps legacy rotation atomic without enabling recovery or requiring a key", async () => {
	const s = setup();
	const input = { clientId: "client", refreshToken: "r0", now: 100 };
	expect(await s.refresh.rotate(input)).toMatchObject({ ok: true, recovered: false });
	expect(await s.refresh.rotate(input)).toMatchObject({ reason: "superseded" });
});

it.each([
	{ clientId: "other", reason: "unknown" },
	{ refreshToken: "missing", reason: "unknown" },
	{ now: 1_000_000, reason: "expired" },
	{ scope: ["write"], reason: "invalid_scope" },
])("rejects invalid input without rotating: %j", async ({ reason, ...replacement }) => {
	const s = setup();
	expect(await s.refresh.rotate({ ...s.input, ...replacement })).toMatchObject({ reason });
	expect(s.credentials.get("a0")).toEqual(s.original);
});

it("narrows scope and admits an already-authorized subset", async () => {
	const s = setup();
	expect(await s.refresh.rotate({ ...s.input, scope: ["read"] })).toMatchObject({ ok: true, credential: { scope: ["read"] } });
	const other = setup(); other.original.scope = undefined;
	expect(await other.refresh.rotate({ ...other.input, scope: ["read"] })).toMatchObject({ reason: "invalid_scope" });
});

it("fences a previously issued parent after logout-all", async () => {
	const s = setup(); s.controls.epoch = 1;
	expect(await s.refresh.rotate(s.input)).toMatchObject({ reason: "revoked" });
});

it("fences bound grants against legacy downgrade, wrong keys, and reused operation bodies", async () => {
	const s = setup(); const first = await s.refresh.rotate(s.input);
	if (!first.ok) throw new Error("expected successful grant");
	expect(await s.refresh.rotate({ clientId: "client", refreshToken: first.credential.refreshToken, now: 200 })).toMatchObject({ reason: "proof_required" });
	expect(await s.refresh.rotate({ ...s.input, proof: { ...s.input.proof, keyThumbprint: "other" } })).toMatchObject({ reason: "key_mismatch" });
	expect(await s.refresh.rotate({ ...s.input, bodyHash: "different" })).toMatchObject({ reason: "operation_mismatch" });
	expect(await s.refresh.rotate({ ...s.input, refreshToken: first.credential.refreshToken })).toMatchObject({ reason: "operation_mismatch" });
});

it("supersedes only the previous result when its child rotates", async () => {
	const s = setup(); const first = await s.refresh.rotate(s.input);
	if (!first.ok) throw new Error("expected successful grant");
	expect(await s.refresh.rotate({ ...s.input, refreshToken: first.credential.refreshToken, operationId: "next", proof: { ...s.input.proof, id: "next" } })).toMatchObject({ ok: true });
	expect(await s.refresh.rotate({ ...s.input, proof: { ...s.input.proof, id: "late" } })).toMatchObject({ reason: "superseded" });
});

it("reports missing committed result as a storage error", async () => {
	const s = setup(); await s.refresh.rotate(s.input); s.credentials.clear();
	await expect(s.refresh.rotate(s.input)).rejects.toThrow("Refresh result credential is missing");
});

it("retries conflicts but bounds contention", async () => {
	const s = setup(); s.controls.conflicts = 1;
	expect((await s.refresh.rotate(s.input)).ok).toBe(true);
	s.controls.conflicts = 1;
	expect((await s.refresh.rotate({ ...s.input, proof: { ...s.input.proof, id: "retry" } })).ok).toBe(true);
	const busy = setup(); busy.controls.conflicts = 4;
	await expect(busy.refresh.rotate(busy.input)).rejects.toThrow("Concurrent refresh could not settle");
});

it.each(["rotation", "logout"] as const)("classifies retained history without an active grant: %s", async cause => {
	const s = setup(); s.credentials.clear();
	s.history.set("r0", { grantId: "grant", fingerprint: "r0", expiresAt: 1000, revocation: { cause, completedAt: 10 } });
	expect(await s.refresh.rotate(s.input)).toMatchObject({ reason: cause === "rotation" ? "superseded" : "revoked" });
	expect(await s.refresh.revoke({ token: "r0", now: 100 })).toEqual({ ok: true });
});

it("revokes a migrated grant through its historical parent and prevents recovery", async () => {
	const s = setup(); await s.refresh.rotate(s.input);
	expect(await s.refresh.revoke({ token: "r0", proof: { ...s.input.proof, id: "logout" }, now: 200 })).toMatchObject({ ok: true });
	expect(await s.refresh.rotate(s.input)).toMatchObject({ reason: "revoked" });
	expect(await s.refresh.revoke({ token: "r0", proof: s.input.proof, now: 201 })).toMatchObject({ ok: true });
});

it("checks proof binding before revocation and treats missing tokens idempotently", async () => {
	const s = setup(); await s.refresh.rotate(s.input);
	expect(await s.refresh.revoke({ token: "r0", now: 200 })).toMatchObject({ reason: "proof_required" });
	expect(await s.refresh.revoke({ token: "r0", proof: s.input.proof, now: 200 })).toMatchObject({ reason: "proof_replayed" });
	expect(await s.refresh.revoke({ token: "missing", now: 200 })).toEqual({ ok: true });
	s.controls.epoch = 1;
	expect(await s.refresh.revoke({ token: "r0", proof: s.input.proof, now: 200 })).toMatchObject({ ok: true });
});

it("adopts a legacy grant for logout and bounds revocation contention", async () => {
	const s = setup(); s.controls.conflicts = 1;
	expect(await s.refresh.revoke({ token: "r0", now: 200 })).toMatchObject({ ok: true });
	const busy = setup(); busy.controls.conflicts = 4;
	await expect(busy.refresh.revoke({ token: "r0", now: 200 })).rejects.toThrow("Concurrent revocation could not settle");
});

it("fails closed when bound credentials have lost their grant record", async () => {
	const s = setup(); const first = await s.refresh.rotate(s.input);
	if (!first.ok) throw new Error("expected grant");
	s.grants.clear();
	await expect(s.refresh.rotate({ ...s.input, refreshToken: first.credential.refreshToken })).rejects.toThrow("Bound refresh grant is missing");
	await expect(s.refresh.revoke({ token: first.credential.refreshToken, now: 200 })).rejects.toThrow("Bound refresh grant is missing");
});

it("rejects a parent expired before its retained grant record and an inconsistent active fingerprint", async () => {
	const s = setup();
	s.grants.set("grant", { id: "grant", userId: "user", clientId: "client", epoch: 0, generation: 0, accessToken: "a0", refreshFingerprint: "r0", state: "active", expiresAt: 2_000_000 });
	expect(await s.refresh.rotate({ ...s.input, now: 1_000_000 })).toMatchObject({ reason: "expired" });
	const grant = s.grants.get("grant"); if (!grant) throw new Error("expected grant");
	grant.refreshFingerprint = "different";
	expect(await s.refresh.rotate(s.input)).toMatchObject({ reason: "superseded" });
});

it("refuses to reuse a proof on the next rotation and checks the revoke client identity", async () => {
	const s = setup(); const first = await s.refresh.rotate(s.input);
	if (!first.ok) throw new Error("expected grant");
	expect(await s.refresh.rotate({ ...s.input, refreshToken: first.credential.refreshToken, operationId: "next" })).toMatchObject({ reason: "proof_replayed" });
	expect(await s.refresh.revoke({ token: "r0", clientId: "wrong-client", now: 200 })).toEqual({ ok: true });
	expect(await s.refresh.revoke({ token: "r0", clientId: "client", proof: { ...s.input.proof, id: "revoke" }, now: 200 })).toMatchObject({ ok: true });
});

it("classifies incomplete legacy history and permits logout after a cached credential disappears", async () => {
	const s = setup(); s.credentials.clear();
	s.history.set("r0", { grantId: "grant", fingerprint: "r0", expiresAt: 1000 });
	expect(await s.refresh.rotate(s.input)).toMatchObject({ reason: "unknown" });
	const bound = setup(); await bound.refresh.rotate(bound.input); bound.credentials.clear();
	expect(await bound.refresh.revoke({ token: "r0", proof: { ...bound.input.proof, id: "revoke" }, now: 200 })).toMatchObject({ ok: true });
});

it("disables new enrollment while retaining legacy refresh and recovery of previously bound grants", async () => {
	const s = setup(false);
	expect(s.refresh.enrollmentEnabled).toBe(false);
	expect(await s.refresh.rotate(s.input)).toMatchObject({ error: "temporarily_unavailable", reason: "enrollment_disabled" });
	expect(await s.refresh.rotate({ clientId: "client", refreshToken: "r0", now: 100 })).toMatchObject({ ok: true });
	const active = setup(); const first = await active.refresh.rotate(active.input); if (!first.ok) throw new Error("expected grant");
	const disabled = setup(false); disabled.credentials.clear();
	for (const [id, value] of active.credentials) disabled.credentials.set(id, value);
	for (const [id, value] of active.grants) disabled.grants.set(id, value);
	for (const [id, value] of active.history) disabled.history.set(id, value);
	expect(await disabled.refresh.rotate({ ...disabled.input, proof: { ...disabled.input.proof, id: "retry" } })).toEqual({ ...first, recovered: true });
});

it("rotates an exempt grant onto the account epoch, where its child rotates again without the exemption", async () => {
	const s = setup(); s.controls.epoch = 1; s.controls.exemption = { atEpoch: 1, grantId: "grant", grantEpoch: 0 };
	const first = await s.refresh.rotate(s.input);
	expect(first).toMatchObject({ ok: true, recovered: false, credential: { epoch: 1, generation: 1 } });
	expect(s.grants.get("grant")).toMatchObject({ epoch: 1, generation: 1, state: "active" });
	expect(s.commits).toEqual([1]);
	if (!first.ok) throw new Error("expected grant");
	s.controls.exemption = undefined;
	expect(await s.refresh.rotate({ ...s.input, refreshToken: first.credential.refreshToken, operationId: "next", proof: { ...s.input.proof, id: "next" } })).toMatchObject({ ok: true, credential: { epoch: 1, generation: 2 } });
	expect(s.commits).toEqual([1, 1]);
});

it("recovers an exempt grant's cached child at the account epoch", async () => {
	const s = setup(); const first = await s.refresh.rotate(s.input);
	s.controls.epoch = 1; s.controls.exemption = { atEpoch: 1, grantId: "grant", grantEpoch: 0 };
	expect(await s.refresh.rotate({ ...s.input, proof: { ...s.input.proof, id: "retry" } })).toEqual({ ...first, recovered: true });
	expect(s.commits).toEqual([0, 1]);
});

it("revokes an exempt grant at the account epoch and leaves the grant on its own", async () => {
	const s = setup(); s.controls.epoch = 1; s.controls.exemption = { atEpoch: 1, grantId: "grant", grantEpoch: 0 };
	expect(await s.refresh.revoke({ token: "r0", now: 200 })).toMatchObject({ ok: true, grant: { id: "grant" } });
	expect(s.grants.get("grant")).toMatchObject({ state: "revoked", epoch: 0 });
	expect(s.commits).toEqual([1]);
	expect(await s.refresh.rotate(s.input)).toMatchObject({ reason: "revoked" });
});

it.each([
	{ operationId: "operation", outcome: { ok: true, recovered: true, credential: { accessToken: "a1" } }, commits: [1, 1] },
	{ operationId: "other", outcome: { ok: false, reason: "superseded" }, commits: [1] },
])("keeps a stale copy of a kept grant current when a rotation and the keep both land inside its reads: %j", async ({ operationId, outcome, commits }) => {
	const s = setup();
	s.controls.beforeReadAccount = () => {
		s.controls.beforeReadAccount = undefined;
		s.credentials.delete("a0");
		s.credentials.set("a1", { ...s.original, accessToken: "a1", refreshToken: "r1", generation: 1, keyThumbprint: "key", parentFingerprint: "r0" });
		s.history.set("r0", { grantId: "grant", fingerprint: "r0", expiresAt: 1_000_000, revocation: { cause: "rotation", completedAt: 50 } });
		s.grants.set("grant", { id: "grant", userId: "user", clientId: "client", epoch: 0, generation: 1, accessToken: "a1", refreshFingerprint: "r1", keyThumbprint: "key", state: "active", expiresAt: 1_000_000, latest: { operationId: "operation", parentFingerprint: "r0", bodyHash: "body" } });
		s.controls.epoch = 1; s.controls.exemption = { atEpoch: 1, grantId: "grant", grantEpoch: 0 };
		s.controls.conflicts = 1;
	};
	expect(await s.refresh.rotate({ ...s.input, operationId })).toMatchObject(outcome);
	expect(s.commits).toEqual(commits);
});

it("keeps retrying an exempt grant while the account epoch moves and never answers invalid_grant", async () => {
	const s = setup(); s.controls.conflicts = 4;
	s.controls.beforeReadAccount = () => { s.controls.epoch += 1; s.controls.exemption = { atEpoch: s.controls.epoch, grantId: "grant", grantEpoch: 0 }; };
	await expect(s.refresh.rotate(s.input)).rejects.toThrow("Concurrent refresh could not settle");
	expect(s.commits).toEqual([1, 2, 3, 4]);
	expect(s.credentials.get("a0")).toEqual(s.original);
});
