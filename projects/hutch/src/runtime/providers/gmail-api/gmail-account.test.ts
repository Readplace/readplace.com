import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailAccessTokenResult } from "@packages/provider-contracts/gmail-filters";
import { initGmailAccountEmail } from "./gmail-account";

const USER = UserIdSchema.parse("00000000000000000000000000000001");

interface FakeResponse {
	status: number;
	body?: unknown;
}

function makeHarness(
	responses: FakeResponse[],
	tokens: GmailAccessTokenResult[] = [
		{ ok: true, value: "at-1" },
		{ ok: true, value: "at-2" },
	],
) {
	const requests: { url: string; method: string; authorization: string }[] = [];

	const fetchFake = (async (
		url: string,
		init: { method: string; headers: Record<string, string> },
	) => {
		requests.push({ url, method: init.method, authorization: init.headers.Authorization });
		const next = responses.shift();
		assert(next, "the test must queue a response for every request");
		return {
			ok: next.status >= 200 && next.status < 300,
			status: next.status,
			statusText: `status ${next.status}`,
			json: async () => {
				assert("body" in next, "the test must queue a body for every parsed response");
				return next.body;
			},
		};
	}) as unknown as typeof globalThis.fetch;

	const findGmailAccountEmail = initGmailAccountEmail({
		accessToken: async () => {
			const next = tokens.shift();
			assert(next, "the test must queue a token result for every attempt");
			return next;
		},
		fetch: fetchFake,
	});

	return { findGmailAccountEmail, requests };
}

describe("initGmailAccountEmail", () => {
	it("returns the primary sendAs address", async () => {
		const { findGmailAccountEmail, requests } = makeHarness([
			{
				status: 200,
				body: {
					sendAs: [
						{ sendAsEmail: "alias@read.place" },
						{ sendAsEmail: "reader@gmail.com", isPrimary: true },
					],
				},
			},
		]);

		const result = await findGmailAccountEmail({ userId: USER });

		assert.deepEqual(result, { ok: true, value: "reader@gmail.com" });
		assert.equal(
			requests[0].url,
			"https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
		);
		assert.equal(requests[0].method, "GET");
		assert.equal(requests[0].authorization, "Bearer at-1");
	});

	it("rejects a mailbox with no primary alias", async () => {
		const { findGmailAccountEmail } = makeHarness([
			{ status: 200, body: { sendAs: [{ sendAsEmail: "alias@read.place" }] } },
		]);

		const result = await findGmailAccountEmail({ userId: USER });

		assert.deepEqual(result, {
			ok: false,
			reason: "rejected",
			status: 200,
			message: "no primary sendAs address",
		});
	});

	it("rejects a response Gmail did not shape as a sendAs list", async () => {
		const { findGmailAccountEmail } = makeHarness([{ status: 200, body: { sendAs: "nope" } }]);

		const result = await findGmailAccountEmail({ userId: USER });

		assert.deepEqual(result, {
			ok: false,
			reason: "rejected",
			status: 200,
			message: "no primary sendAs address",
		});
	});

	it("reports reauth-required when the refreshed token is still rejected", async () => {
		const { findGmailAccountEmail } = makeHarness([{ status: 401 }, { status: 401 }]);

		const result = await findGmailAccountEmail({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
	});

	it("reports the rejection message Gmail returned", async () => {
		const { findGmailAccountEmail } = makeHarness([
			{ status: 403, body: { error: { message: "Insufficient Permission" } } },
		]);

		const result = await findGmailAccountEmail({ userId: USER });

		assert.deepEqual(result, {
			ok: false,
			reason: "rejected",
			status: 403,
			message: "Insufficient Permission",
		});
	});

	it("reports the service as unavailable when Gmail is rate limiting", async () => {
		const { findGmailAccountEmail } = makeHarness([{ status: 429 }]);

		const result = await findGmailAccountEmail({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 429 });
	});

	it("gives up when the stored refresh token no longer mints an access token", async () => {
		const { findGmailAccountEmail } = makeHarness([], [{ ok: false, reason: "reauth-required" }]);

		const result = await findGmailAccountEmail({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
	});
});
