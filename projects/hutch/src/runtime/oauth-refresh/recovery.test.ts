import { noopLogger } from "@packages/hutch-logger";
import { initRefreshProof, CredentialHistory, OAuthGrantId } from "./evidence";
import { initVerifyRefreshRecovery } from "./recovery";

const now = 1_800_000_000_000;
const proof = initRefreshProof("secret");
function credential(token: string, parent?: string): CredentialHistory {
	return CredentialHistory.parse({ pk: token, grantId: "connection", fingerprint: proof.fingerprint(token), credentialExpiresAt: now + 10000, expiresAt: now / 1000 + 100000,
		...(parent ? { parentFingerprint: proof.fingerprint(parent) } : {}), revocation: { cause: "rotation", completedAt: now - 1000 } });
}
function setup(rows: CredentialHistory[]) {
	const recover = jest.fn().mockResolvedValue(undefined);
	const logger = { ...noopLogger, error: jest.fn() };
	const findHistory = jest.fn(async (fingerprint: string) => rows.find(row => row.fingerprint === fingerprint));
	return { recover, logger, findHistory, verify: initVerifyRefreshRecovery({ secret: "secret", findHistory, recover, now: () => now, logger }) };
}

it("only recovers the exact refused ancestor after descendant authentication", async () => {
	const deps = setup([credential("old"), credential("middle", "old"), credential("current", "middle")]);
	const attempt = proof.attempt("old", now - 5000);
	await deps.verify({ proof: proof.sign(attempt), authenticatedRefreshToken: "current" });
	expect(deps.recover.mock.calls).toEqual([[attempt, now]]);
});

it.each(["unrelated", "old", "missing"])("does not recover with %s credentials", async token => {
	const deps = setup([credential("old"), credential("unrelated")]);
	await deps.verify({ proof: proof.sign(proof.attempt("old", now - 5000)), authenticatedRefreshToken: token });
	expect(deps.recover.mock.calls).toEqual([]);
});

it.each(["forged", proof.sign(proof.attempt("old", now + 1)), proof.sign(proof.attempt("old", now - 32 * 86400_000))])("rejects invalid or expired proofs", async value => {
	const deps = setup([]);
	await deps.verify({ proof: value, authenticatedRefreshToken: "current" });
	expect(deps.findHistory.mock.calls).toEqual([]);
});

it.each([undefined, { ...credential("old"), grantId: OAuthGrantId.parse("other") }, { ...credential("old"), revocation: undefined }, { ...credential("old"), revocation: { cause: "logout" as const, completedAt: now } }])("rejects an unproven successor relationship", async parent => {
	const rows = [credential("current", "old")];
	if (parent) rows.push(parent);
	const deps = setup(rows);
	await deps.verify({ proof: proof.sign(proof.attempt("old", now - 5000)), authenticatedRefreshToken: "current" });
	expect(deps.recover.mock.calls).toEqual([]);
});

it("terminates a malformed ancestry cycle", async () => {
	const deps = setup([credential("current", "current")]);
	await deps.verify({ proof: proof.sign(proof.attempt("old", now - 5000)), authenticatedRefreshToken: "current" });
	expect(deps.recover.mock.calls).toEqual([]);
});

it("retries persistence and preserves authentication when storage remains unavailable", async () => {
	const deps = setup([credential("old"), credential("current", "old")]);
	deps.recover.mockRejectedValue(new Error("unavailable"));
	await deps.verify({ proof: proof.sign(proof.attempt("old", now - 5000)), authenticatedRefreshToken: "current" });
	expect(deps.recover.mock.calls).toHaveLength(3);
	expect(deps.findHistory.mock.calls).toHaveLength(6);
	expect(JSON.parse(deps.logger.error.mock.calls[0][0]).event).toBe("oauth_refresh_recovery_persistence_failed");
});

it("recovers after a transient persistence failure", async () => {
	const deps = setup([credential("old"), credential("current", "old")]);
	deps.recover.mockRejectedValueOnce("unavailable");
	await deps.verify({ proof: proof.sign(proof.attempt("old", now - 5000)), authenticatedRefreshToken: "current" });
	expect(deps.recover.mock.calls).toHaveLength(2);
	expect(deps.logger.error.mock.calls).toEqual([]);
});

it("surfaces non-Error history storage failures", async () => {
	const deps = setup([]);
	deps.findHistory.mockRejectedValue("unavailable");
	await deps.verify({ proof: proof.sign(proof.attempt("old", now - 5000)), authenticatedRefreshToken: "current" });
	expect(JSON.parse(deps.logger.error.mock.calls[0][0]).error).toBe("unknown");
	expect(deps.findHistory.mock.calls).toHaveLength(3);
});


it("retries history lookup before persisting a verified recovery", async () => {
	const deps = setup([credential("old"), credential("current", "old")]);
	deps.findHistory.mockRejectedValueOnce(new Error("read unavailable"));
	const attempt = proof.attempt("old", now - 5000);
	await deps.verify({ proof: proof.sign(attempt), authenticatedRefreshToken: "current" });
	expect(deps.findHistory.mock.calls).toHaveLength(3);
	expect(deps.recover.mock.calls).toEqual([[attempt, now]]);
	expect(deps.logger.error.mock.calls).toEqual([]);
});

it("revalidates the whole ancestry after a transient parent lookup failure", async () => {
	const deps = setup([credential("old"), credential("current", "old")]);
	deps.findHistory.mockResolvedValueOnce(credential("current", "old")).mockRejectedValueOnce(new Error("parent unavailable"));
	const attempt = proof.attempt("old", now - 5000);
	await deps.verify({ proof: proof.sign(attempt), authenticatedRefreshToken: "current" });
	expect(deps.findHistory.mock.calls.map(([fingerprint]) => fingerprint)).toEqual([
		proof.fingerprint("current"), proof.fingerprint("old"), proof.fingerprint("current"), proof.fingerprint("old"),
	]);
	expect(deps.recover.mock.calls).toEqual([[attempt, now]]);
	expect(deps.logger.error.mock.calls).toEqual([]);
});

it("stops retrying when revalidation finds an unrelated grant", async () => {
	const deps = setup([credential("old"), credential("current", "old")]);
	deps.recover.mockRejectedValueOnce(new Error("write unavailable"));
	deps.findHistory.mockResolvedValueOnce(credential("current", "old")).mockResolvedValueOnce(credential("old")).mockResolvedValueOnce(credential("unrelated"));
	await deps.verify({ proof: proof.sign(proof.attempt("old", now - 5000)), authenticatedRefreshToken: "current" });
	expect(deps.findHistory.mock.calls).toHaveLength(3);
	expect(deps.recover.mock.calls).toHaveLength(1);
	expect(deps.logger.error.mock.calls).toEqual([]);
});
