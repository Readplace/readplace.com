import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { initRevokeExternalIdpTokens } from "./revoke-external-idp-tokens";

const USER_ID = UserIdSchema.parse("user-1");

function buildRevoker(opts: {
	storedToken: string | null;
	responseStatus?: number;
}) {
	const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];
	const fakeFetch: typeof globalThis.fetch = async (input, init) => {
		fetchCalls.push({ url: typeof input === "string" ? input : input.toString(), init });
		return new Response(null, { status: opts.responseStatus ?? 200 });
	};
	const revokeExternalIdpTokens = initRevokeExternalIdpTokens({
		findAppleRefreshTokenByUserId: async () => opts.storedToken,
		appleClientId: "com.readplace.web",
		createAppleClientSecret: () => "minted-client-secret-jwt",
		fetch: fakeFetch,
		logger: HutchLogger.from(noopLogger),
	});
	return { revokeExternalIdpTokens, fetchCalls };
}

describe("initRevokeExternalIdpTokens", () => {
	it("resolves without calling Apple when the user has no stored refresh token (password/Google accounts)", async () => {
		const s = buildRevoker({ storedToken: null });

		await assert.doesNotReject(s.revokeExternalIdpTokens(USER_ID));

		assert.equal(s.fetchCalls.length, 0);
	});

	it("POSTs the stored refresh token to Apple's revocation endpoint with a freshly minted client secret", async () => {
		const s = buildRevoker({ storedToken: "stored-apple-refresh-token" });

		await s.revokeExternalIdpTokens(USER_ID);

		assert.equal(s.fetchCalls.length, 1);
		const call = s.fetchCalls[0];
		assert(call, "revocation must issue exactly one request");
		assert.equal(call.url, "https://appleid.apple.com/auth/revoke");
		assert.equal(call.init?.method, "POST");
		const headers = new Headers(call.init?.headers);
		assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
		const body = call.init?.body;
		assert(typeof body === "string");
		const params = new URLSearchParams(body);
		assert.equal(params.get("client_id"), "com.readplace.web");
		assert.equal(params.get("client_secret"), "minted-client-secret-jwt");
		assert.equal(params.get("token"), "stored-apple-refresh-token");
		assert.equal(params.get("token_type_hint"), "refresh_token");
	});

	it("rejects on a non-2xx Apple response so the SQS record redrives and revocation is retried", async () => {
		const s = buildRevoker({ storedToken: "stored-apple-refresh-token", responseStatus: 400 });

		await assert.rejects(s.revokeExternalIdpTokens(USER_ID), /Apple token revocation failed with status 400/);
	});
});
