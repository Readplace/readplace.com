import assert from "node:assert/strict";
import { initGmailAccountEmail } from "./gmail-account";

function harness(body: unknown, status = 200) {
	const requests: { url: string; authorization: string | null }[] = [];
	const findGmailAccountEmail = initGmailAccountEmail({
		fetch: async (url, init) => {
			requests.push({ url: String(url), authorization: new Headers(init?.headers).get("Authorization") });
			return new Response(JSON.stringify(body), { status });
		},
	});
	return { findGmailAccountEmail, requests };
}

describe("initGmailAccountEmail", () => {
	it("resolves the freshly granted token's primary mailbox before any credentials are persisted", async () => {
		const { findGmailAccountEmail, requests } = harness({ sendAs: [
			{ sendAsEmail: "alias@read.place" },
			{ sendAsEmail: " Reader@Gmail.com ", isPrimary: true },
		] });

		assert.deepEqual(await findGmailAccountEmail({ accessToken: "new-grant-access-token" }), { ok: true, value: "reader@gmail.com" });
		assert.deepEqual(requests, [{ url: "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", authorization: "Bearer new-grant-access-token" }]);
	});

	it.each([{ sendAs: [{ sendAsEmail: "alias@read.place" }] }, {}, { sendAs: "invalid" }])("rejects an unidentified mailbox: %j", async (body) => {
		const { findGmailAccountEmail } = harness(body);
		assert.deepEqual(await findGmailAccountEmail({ accessToken: "token" }), { ok: false, reason: "rejected", status: 200, message: "no primary sendAs address" });
	});

	it("reports an invalid grant without looking up a previously saved token", async () => {
		const { findGmailAccountEmail, requests } = harness({}, 401);
		assert.deepEqual(await findGmailAccountEmail({ accessToken: "invalid-token" }), { ok: false, reason: "reauth-required" });
		assert.equal(requests.length, 1);
	});

	it("reports the rejection message Gmail returned", async () => {
		const { findGmailAccountEmail } = harness({ error: { message: "Insufficient Permission" } }, 403);
		assert.deepEqual(await findGmailAccountEmail({ accessToken: "token" }), { ok: false, reason: "rejected", status: 403, message: "Insufficient Permission" });
	});

	it("reports rate limiting as unavailable", async () => {
		const { findGmailAccountEmail } = harness({}, 429);
		assert.deepEqual(await findGmailAccountEmail({ accessToken: "token" }), { ok: false, reason: "unavailable", status: 429 });
	});
});
