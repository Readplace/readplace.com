import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailAccessTokenResult } from "@packages/provider-contracts/gmail-filters";
import { initGmailFilters } from "./gmail-filters";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = "gmail-a7b2c9@read.place";

interface FakeResponse {
	status: number;
	body?: unknown;
}

interface CapturedRequest {
	url: string;
	method: string;
	authorization: string;
	body: string | undefined;
}

function makeHarness(
	responses: FakeResponse[],
	tokens: GmailAccessTokenResult[] = [
		{ ok: true, value: "at-1" },
		{ ok: true, value: "at-2" },
	],
) {
	const requests: CapturedRequest[] = [];
	const forced: boolean[] = [];

	const fetchFake = (async (
		url: string,
		init: { method: string; headers: Record<string, string>; body?: string },
	) => {
		requests.push({
			url,
			method: init.method,
			authorization: init.headers.Authorization,
			body: init.body,
		});
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

	const filters = initGmailFilters({
		accessToken: async ({ forceRefresh }) => {
			forced.push(forceRefresh);
			const next = tokens.shift();
			assert(next, "the test must queue a token result for every attempt");
			return next;
		},
		fetch: fetchFake,
	});

	return { filters, requests, forced };
}

describe("initGmailFilters", () => {
	it("lists the filters Gmail holds, flattening the ones that forward", async () => {
		const { filters, requests } = makeHarness([
			{
				status: 200,
				body: {
					filter: [
						{ id: "f-1", criteria: { query: "from:(dan@tldr.tech)" }, action: { forward: GATEWAY } },
						{ id: "f-2" },
					],
				},
			},
		]);

		const result = await filters.listFilters({ userId: USER });

		assert.deepEqual(result, {
			ok: true,
			value: [
				{ id: "f-1", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY },
				{ id: "f-2", query: undefined, forwardTo: undefined },
			],
		});
		assert.equal(requests[0].method, "GET");
		assert.equal(requests[0].authorization, "Bearer at-1");
		assert.equal(
			requests[0].url,
			"https://gmail.googleapis.com/gmail/v1/users/me/settings/filters",
		);
	});

	it("reads an empty filter list as no filters rather than a failure", async () => {
		const { filters } = makeHarness([{ status: 200, body: {} }]);

		assert.deepEqual(await filters.listFilters({ userId: USER }), { ok: true, value: [] });
	});

	it("sends the query and the forwarding address when creating a filter", async () => {
		const { filters, requests } = makeHarness([
			{
				status: 200,
				body: { id: "f-9", criteria: { query: "from:(dan@tldr.tech)" }, action: { forward: GATEWAY } },
			},
		]);

		const created = await filters.createForwardingFilter({
			userId: USER,
			query: "from:(dan@tldr.tech)",
			forwardTo: GATEWAY,
		});

		assert.deepEqual(created, {
			ok: true,
			value: { id: "f-9", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY },
		});
		assert.equal(requests[0].method, "POST");
		assert.deepEqual(JSON.parse(String(requests[0].body)), {
			criteria: { query: "from:(dan@tldr.tech)" },
			action: { forward: GATEWAY },
		});
	});

	it("reads one filter back by its id", async () => {
		const { filters, requests } = makeHarness([
			{ status: 200, body: { id: "f 9", criteria: { query: "from:(dan@tldr.tech)" } } },
		]);

		const found = await filters.getFilter({ userId: USER, filterId: "f 9" });

		assert.equal(found.ok && found.value.query, "from:(dan@tldr.tech)");
		assert.equal(
			requests[0].url,
			"https://gmail.googleapis.com/gmail/v1/users/me/settings/filters/f%209",
		);
	});

	it("deletes a filter without reading a body back", async () => {
		const { filters, requests } = makeHarness([{ status: 204 }]);

		assert.deepEqual(await filters.deleteFilter({ userId: USER, filterId: "f-9" }), {
			ok: true,
			value: undefined,
		});
		assert.equal(requests[0].method, "DELETE");
		assert.equal(requests[0].body, undefined);
	});

	it("retries once with a fresh token when Gmail rejects the cached one", async () => {
		const { filters, requests, forced } = makeHarness([
			{ status: 401, body: {} },
			{ status: 200, body: {} },
		]);

		const result = await filters.listFilters({ userId: USER });

		assert.deepEqual(result, { ok: true, value: [] });
		assert.deepEqual(forced, [false, true]);
		assert.deepEqual(
			requests.map((request) => request.authorization),
			["Bearer at-1", "Bearer at-2"],
		);
	});

	it("asks the user to reconnect when even a fresh token is rejected", async () => {
		const { filters } = makeHarness([
			{ status: 401, body: {} },
			{ status: 401, body: {} },
		]);

		assert.deepEqual(await filters.listFilters({ userId: USER }), {
			ok: false,
			reason: "reauth-required",
		});
	});

	it("passes a token failure straight through without calling Gmail", async () => {
		const { filters, requests } = makeHarness([], [{ ok: false, reason: "reauth-required" }]);

		assert.deepEqual(await filters.listFilters({ userId: USER }), {
			ok: false,
			reason: "reauth-required",
		});
		assert.deepEqual(requests, []);
	});

	it("treats a rate limit as retryable", async () => {
		const { filters } = makeHarness([{ status: 429, body: {} }]);

		assert.deepEqual(await filters.listFilters({ userId: USER }), {
			ok: false,
			reason: "unavailable",
			status: 429,
		});
	});

	it("treats a Gmail outage as retryable", async () => {
		const { filters } = makeHarness([{ status: 503, body: {} }]);

		assert.deepEqual(await filters.listFilters({ userId: USER }), {
			ok: false,
			reason: "unavailable",
			status: 503,
		});
	});

	it("surfaces the reason Gmail refused the filter", async () => {
		const { filters } = makeHarness([
			{ status: 400, body: { error: { message: "Invalid forwarding address" } } },
		]);

		assert.deepEqual(
			await filters.createForwardingFilter({
				userId: USER,
				query: "from:(dan@tldr.tech)",
				forwardTo: GATEWAY,
			}),
			{ ok: false, reason: "rejected", status: 400, message: "Invalid forwarding address" },
		);
	});

	it("falls back to the status text when the refusal has no readable body", async () => {
		const { filters } = makeHarness([{ status: 403, body: undefined }]);

		assert.deepEqual(await filters.listFilters({ userId: USER }), {
			ok: false,
			reason: "rejected",
			status: 403,
			message: "status 403",
		});
	});

	it("refuses a filter list it cannot read", async () => {
		const { filters } = makeHarness([{ status: 200, body: { filter: "not-an-array" } }]);

		assert.deepEqual(await filters.listFilters({ userId: USER }), {
			ok: false,
			reason: "rejected",
			status: 200,
			message: "malformed filter list",
		});
	});

	it("refuses a created filter it cannot read", async () => {
		const { filters } = makeHarness([{ status: 200, body: { noId: true } }]);

		assert.deepEqual(
			await filters.createForwardingFilter({
				userId: USER,
				query: "from:(dan@tldr.tech)",
				forwardTo: GATEWAY,
			}),
			{ ok: false, reason: "rejected", status: 200, message: "malformed filter" },
		);
	});
});
