import assert from "node:assert/strict";
import { initRevokeGmailGrant } from "./gmail-revoke";

function makeHarness(status: number) {
	const requests: URLSearchParams[] = [];
	const revoke = initRevokeGmailGrant({
		fetch: (async (_url: string, init?: { body?: string }) => {
			requests.push(new URLSearchParams(init?.body));
			return { ok: status >= 200 && status < 300, status };
		}) as unknown as typeof globalThis.fetch,
	});
	return { revoke, requests };
}

describe("initRevokeGmailGrant", () => {
	it("sends the refresh token to Google's revoke endpoint", async () => {
		const { revoke, requests } = makeHarness(200);

		assert.deepEqual(await revoke({ refreshToken: "refresh-1" }), { ok: true });
		assert.equal(requests[0].get("token"), "refresh-1");
	});

	it("treats an already-revoked grant as revoked rather than a failure", async () => {
		const { revoke } = makeHarness(400);

		assert.deepEqual(await revoke({ refreshToken: "refresh-1" }), { ok: true });
	});

	it("reports a Google outage as retryable", async () => {
		const { revoke } = makeHarness(503);

		assert.deepEqual(await revoke({ refreshToken: "refresh-1" }), {
			ok: false,
			reason: "unavailable",
			status: 503,
		});
	});
});
