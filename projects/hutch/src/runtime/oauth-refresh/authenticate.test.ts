import { initRecoverAuthenticatedToken } from "./authenticate";
import { refreshContext } from "./evidence";

it("records recovery after authentication and before the business handler resumes", async () => {
	const token = { accessToken: "access", refreshToken: "refresh", client: { id: "client", grants: [] }, user: { id: "user" } };
	let finishRecovery: () => void = () => {};
	const persisted = new Promise<void>(resolve => { finishRecovery = resolve; });
	let beginRecovery: () => void = () => {};
	const started = new Promise<void>(resolve => { beginRecovery = resolve; });
	const recover = jest.fn(async () => {
		beginRecovery();
		await persisted;
	});
	const authenticate = initRecoverAuthenticatedToken({ getAccessToken: async () => token, recover });
	let businessResumed = false;
	const response = refreshContext.run({ recoveryProof: "proof" }, async () => {
		const authenticated = await authenticate("access");
		businessResumed = true;
		return { authenticated, status: 422 };
	});
	await started;
	await Promise.resolve();
	expect(businessResumed).toBe(false);
	expect(recover.mock.calls).toEqual([[{ proof: "proof", authenticatedRefreshToken: "refresh" }]]);
	finishRecovery();
	expect(await response).toEqual({ authenticated: token, status: 422 });
	expect(businessResumed).toBe(true);
});

it("cannot recover a request whose bearer authentication fails", async () => {
	const recover = jest.fn();
	const authenticate = initRecoverAuthenticatedToken({ getAccessToken: async () => null, recover });
	await refreshContext.run({ recoveryProof: "proof" }, async () => { expect(await authenticate("invalid")).toBeNull(); });
	expect(recover.mock.calls).toEqual([]);
});

it("does not infer recovery from an unrelated ordinary success", async () => {
	const token = { accessToken: "access", client: { id: "client", grants: [] }, user: { id: "user" } };
	const recover = jest.fn();
	const authenticate = initRecoverAuthenticatedToken({ getAccessToken: async () => token, recover });
	expect(await authenticate("access")).toEqual(token);
	await refreshContext.run({ recoveryProof: "proof" }, async () => { expect(await authenticate("access")).toEqual(token); });
	expect(recover.mock.calls).toEqual([]);
});
