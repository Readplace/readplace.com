import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailHistoryResult } from "@packages/provider-contracts/gmail-history";
import { initGmailHistory } from "./gmail-history";

const USER = UserIdSchema.parse("reader");
const SENDER = ForwardableSenderSchema.parse("news@example.com");
const WINDOW = { start: "2026-08-31T00:00:00.000Z", end: "2026-09-30T00:00:00.500Z" };
const MESSAGE_ID = GmailMessageIdSchema.parse("18c2f0a1b2");
const RAW_MAIL = "From: News <news@example.com>\r\nMessage-ID: <m-1@example.com>\r\n\r\nHello";

interface Reply {
	status: number;
	body?: unknown;
}

function harness(reply: (url: URL) => Reply, tokens?: GmailHistoryResult<string>[]) {
	const requests: { url: URL; authorization: string | null }[] = [];
	const refreshes: boolean[] = [];
	const history = initGmailHistory({
		accessToken: async ({ forceRefresh }) => {
			refreshes.push(forceRefresh);
			if (tokens !== undefined) {
				const token = tokens.shift();
				assert(token, "a token response must be queued");
				return token;
			}
			return { ok: true, value: forceRefresh ? "renewed" : "cached" };
		},
		fetch: async (input, init) => {
			const url = new URL(String(input));
			requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
			const response = reply(url);
			return new Response(response.body === undefined ? "not json" : JSON.stringify(response.body), {
				status: response.status,
				statusText: `status ${response.status}`,
			});
		},
	});
	return { history, requests, refreshes };
}

describe("initGmailHistory", () => {
	describe("listUnreadMessageIds", () => {
		it("asks Gmail for one page of the sender's unread mail inside the window, spam and trash excluded", async () => {
			const { history, requests } = harness(() => ({
				status: 200,
				body: { messages: [{ id: "18c2f0a1b2" }, { id: "18c2f0a1b3" }], nextPageToken: "page-2" },
			}));

			const result = await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: "page-1" });

			assert.deepEqual(result, { ok: true, value: { messageIds: ["18c2f0a1b2", "18c2f0a1b3"], nextPageToken: "page-2" } });
			const { url, authorization } = requests[0];
			assert.equal(url.pathname, "/gmail/v1/users/me/messages");
			assert.equal(url.searchParams.get("q"), "from:news@example.com is:unread after:1788134400 before:1790726400");
			assert.equal(url.searchParams.get("maxResults"), "25");
			assert.equal(url.searchParams.get("includeSpamTrash"), "false");
			assert.equal(url.searchParams.get("fields"), "messages(id),nextPageToken");
			assert.equal(url.searchParams.get("pageToken"), "page-1");
			assert.equal(authorization, "Bearer cached");
		});

		it("reports an empty last page when the sender has no unread mail", async () => {
			const { history, requests } = harness(() => ({ status: 200, body: {} }));

			const result = await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined });

			assert.deepEqual(result, { ok: true, value: { messageIds: [], nextPageToken: undefined } });
			assert.equal(requests[0].url.searchParams.has("pageToken"), false);
		});

		it("reports a listing it cannot read as retryable", async () => {
			const { history } = harness(() => ({ status: 200, body: { messages: [{ id: "not/an/id" }] } }));

			assert.deepEqual(
				await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined }),
				{ ok: false, reason: "unavailable", status: 200 },
			);
		});
	});

	describe("fetchRawMessage", () => {
		it("returns the decoded RFC 822 bytes with the message's received time and labels", async () => {
			const { history, requests } = harness(() => ({
				status: 200,
				body: { raw: Buffer.from(RAW_MAIL).toString("base64url"), internalDate: "1759190400000", labelIds: ["UNREAD", "INBOX"] },
			}));

			const result = await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID });

			assert.deepEqual(result, {
				ok: true,
				value: { raw: Buffer.from(RAW_MAIL), internalDate: "2025-09-30T00:00:00.000Z", labelIds: ["UNREAD", "INBOX"] },
			});
			const { url } = requests[0];
			assert.equal(url.pathname, "/gmail/v1/users/me/messages/18c2f0a1b2");
			assert.equal(url.searchParams.get("format"), "RAW");
			assert.equal(url.searchParams.get("fields"), "raw,internalDate,labelIds");
		});

		it("treats a message without labels as unlabelled", async () => {
			const { history } = harness(() => ({ status: 200, body: { raw: "", internalDate: 0 } }));

			assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID }), {
				ok: true,
				value: { raw: Buffer.alloc(0), internalDate: "1970-01-01T00:00:00.000Z", labelIds: [] },
			});
		});

		it("reports a message deleted since it was listed as not found", async () => {
			const { history } = harness(() => ({ status: 404, body: { error: { message: "Not Found" } } }));

			assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID }), { ok: true, value: { notFound: true } });
		});
	});

	describe("Gmail refusals", () => {
		it("renews the token once after a 401 and retries", async () => {
			let calls = 0;
			const { history, requests, refreshes } = harness(() => {
				calls += 1;
				return calls === 1 ? { status: 401, body: {} } : { status: 200, body: {} };
			});

			const result = await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined });

			assert.equal(result.ok, true);
			assert.deepEqual(refreshes, [false, true]);
			assert.equal(requests[1].authorization, "Bearer renewed");
		});

		it("asks the user to reconnect when a renewed token is still refused", async () => {
			const { history } = harness(() => ({ status: 401, body: {} }));

			assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID }), { ok: false, reason: "reauth-required" });
		});

		it("passes on a token failure without calling Gmail", async () => {
			const { history, requests } = harness(() => ({ status: 200, body: {} }), [{ ok: false, reason: "readonly-permission-required" }]);

			assert.deepEqual(
				await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined }),
				{ ok: false, reason: "readonly-permission-required" },
			);
			assert.equal(requests.length, 0);
		});

		it("asks for read-only permission when Gmail says the token lacks the scope", async () => {
			for (const body of [
				{ error: { message: "Insufficient Permission", errors: [{ reason: "insufficientPermissions" }] } },
				{ error: { message: "Insufficient Permission", details: [{}, { reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } },
			]) {
				const { history } = harness(() => ({ status: 403, body }));
				assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID }), {
					ok: false,
					reason: "readonly-permission-required",
				});
			}
		});

		it("reports rate limiting and outages as retryable", async () => {
			for (const reply of [
				{ status: 403, body: { error: { message: "Rate Limit Exceeded", errors: [{ reason: "userRateLimitExceeded" }] } } },
				{ status: 429, body: {} },
				{ status: 503 },
			]) {
				const { history } = harness(() => reply);
				assert.deepEqual(
					await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined }),
					{ ok: false, reason: "unavailable", status: reply.status },
				);
			}
		});

		it("reports any other refusal as rejected with Gmail's message", async () => {
			for (const [reply, message] of [
				[{ status: 403, body: { error: { message: "Mail service not enabled" } } }, "Mail service not enabled"],
				[{ status: 403 }, "status 403"],
				[{ status: 400, body: { error: { message: "Invalid query" } } }, "Invalid query"],
			] as const) {
				const { history } = harness(() => reply);
				assert.deepEqual(
					await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined }),
					{ ok: false, reason: "rejected", status: reply.status, message },
				);
			}
		});
	});
});
