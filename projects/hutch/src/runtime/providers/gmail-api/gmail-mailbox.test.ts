import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { GmailAccessTokenResult } from "@packages/provider-contracts/gmail-filters";
import { initGmailMailbox } from "./gmail-mailbox";

const USER = UserIdSchema.parse("reader");
interface Reply { status: number; body?: unknown }

function harness(reply: (url: URL) => Reply | Promise<Reply>, tokens?: GmailAccessTokenResult[]) {
	const requests: { url: URL; authorization: string | null }[] = [];
	const refreshes: boolean[] = [];
	const mailbox = initGmailMailbox({
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
			const response = await reply(url);
			return new Response(JSON.stringify(response.body), { status: response.status, statusText: `status ${response.status}` });
		},
	});
	return { mailbox, requests, refreshes };
}

function metadata(from: string, labelIds: string[] = []) {
	return { labelIds, payload: { headers: [{ name: "From", value: from }] } };
}

describe("initGmailMailbox", () => {
	it("reads the mailbox identity and history checkpoint without any message body", async () => {
		const { mailbox, requests } = harness(() => ({ status: 200, body: { emailAddress: "Reader@Gmail.com", historyId: "100" } }));

		assert.deepEqual(await mailbox.findProfile({ userId: USER }), { ok: true, value: { accountEmail: "reader@gmail.com", historyId: "100" } });
		assert.equal(requests[0].url.pathname, "/gmail/v1/users/me/profile");
		assert.equal(requests[0].url.searchParams.get("fields"), "emailAddress,historyId");
		assert.equal(requests[0].authorization, "Bearer cached");
	});

	it("paginates all historical messages using metadata scope and deduplicates From addresses", async () => {
		const bodies: Record<string, unknown> = {
			one: metadata("Sender@Example.com"),
			two: metadata("News <sender@example.com>"),
			three: metadata("Later name <sender@example.com>"),
			four: { payload: { headers: [{ name: "To", value: "ignore@example.com" }, { name: "fRoM", value: "Other <other@example.com>" }] } },
			five: { payload: {} },
			six: {},
			seven: metadata("invalid sender"),
		};
		const { mailbox, requests } = harness((url) => {
			if (url.pathname.endsWith("/messages")) return { status: 200, body: { messages: [...Object.keys(bodies), "one"].map((id) => ({ id })), nextPageToken: "older-page" } };
			const id = url.pathname.split("/").at(-1);
			assert(id);
			return { status: 200, body: bodies[id] };
		});

		assert.deepEqual(await mailbox.listMessageSenders({ userId: USER, pageToken: "previous-page" }), {
			ok: true, value: {
				senders: [{ email: "sender@example.com", name: "News" }, { email: "other@example.com", name: "Other" }],
				nextPageToken: "older-page", scannedMessages: 7,
			},
		});
		const list = requests[0].url;
		assert.equal(list.searchParams.get("pageToken"), "previous-page");
		assert.equal(list.searchParams.get("includeSpamTrash"), "false");
		assert.equal(list.searchParams.get("maxResults"), "25");
		assert.equal(list.searchParams.has("q"), false);
		for (const { url } of requests.slice(1)) {
			assert.equal(url.searchParams.get("format"), "METADATA");
			assert.equal(url.searchParams.get("metadataHeaders"), "From");
			assert.equal(url.searchParams.get("fields"), "labelIds,payload(headers)");
		}
	});

	it("excludes Spam, Trash, drafts and sent-only messages while including received archived mail", async () => {
		const labels = [["SPAM"], ["TRASH"], ["DRAFT"], ["SENT", "STARRED"], ["SENT", "INBOX"], ["CATEGORY_UPDATES"]];
		const { mailbox } = harness((url) => {
			if (url.pathname.endsWith("/messages")) return { status: 200, body: { messages: labels.map((_, index) => ({ id: String(index) })) } };
			const index = Number(url.pathname.split("/").at(-1));
			return { status: 200, body: metadata(`sender${index}@example.com`, labels[index]) };
		});

		assert.deepEqual(await mailbox.listMessageSenders({ userId: USER }), { ok: true, value: {
			senders: [{ email: "sender4@example.com", name: undefined }, { email: "sender5@example.com", name: undefined }],
			nextPageToken: undefined, scannedMessages: 6,
		} });
	});

	it("handles an empty mailbox", async () => {
		const { mailbox } = harness(() => ({ status: 200, body: {} }));
		assert.deepEqual(await mailbox.listMessageSenders({ userId: USER }), { ok: true, value: { senders: [], nextPageToken: undefined, scannedMessages: 0 } });
	});

	it("skips a message that disappeared between list and metadata reads", async () => {
		const { mailbox } = harness((url) => url.pathname.endsWith("/messages")
			? { status: 200, body: { messages: [{ id: "removed" }, { id: "live" }] } }
			: url.pathname.endsWith("/removed")
				? { status: 404, body: { error: { message: "Not found" } } }
				: { status: 200, body: metadata("live@example.com") });

		assert.deepEqual(await mailbox.listMessageSenders({ userId: USER }), { ok: true, value: {
			senders: [{ email: "live@example.com", name: undefined }], nextPageToken: undefined, scannedMessages: 2,
		} });
	});

	it("bounds metadata concurrency to five requests", async () => {
		let active = 0;
		let maximum = 0;
		const { mailbox } = harness(async (url) => {
			if (url.pathname.endsWith("/messages")) return { status: 200, body: { messages: Array.from({ length: 12 }, (_, index) => ({ id: String(index) })) } };
			active++;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setImmediate(resolve));
			active--;
			return { status: 200, body: metadata("sender@example.com") };
		});

		const result = await mailbox.listMessageSenders({ userId: USER });
		assert(result.ok);
		assert.equal(result.value.scannedMessages, 12);
		assert.equal(maximum, 5);
	});

	it("reads changed message senders and follows both metadata subpages and Gmail history pages", async () => {
		const ids = Array.from({ length: 27 }, (_, index) => ({ id: String(index) }));
		const { mailbox, requests } = harness((url) => {
			if (!url.pathname.endsWith("/history")) return { status: 200, body: metadata(`sender${url.pathname.split("/").at(-1)}@example.com`) };
			if (url.searchParams.has("pageToken")) return { status: 200, body: { history: [{}, { messages: [{ id: "last" }] }], historyId: "200" } };
			return { status: 200, body: { history: [{ messages: [...ids, ids[0]] }], nextPageToken: "google-page-2", historyId: "200" } };
		});

		const first = await mailbox.listChangedMessageSenders({ userId: USER, startHistoryId: "100" });
		assert(first.ok);
		assert.equal(first.value.scannedMessages, 25);
		assert(first.value.nextPageToken);
		const second = await mailbox.listChangedMessageSenders({ userId: USER, startHistoryId: "100", pageToken: first.value.nextPageToken });
		assert(second.ok);
		assert.equal(second.value.scannedMessages, 2);
		assert(second.value.nextPageToken);
		const third = await mailbox.listChangedMessageSenders({ userId: USER, startHistoryId: "100", pageToken: second.value.nextPageToken });
		assert.deepEqual(third, { ok: true, value: {
			senders: [{ email: "senderlast@example.com", name: undefined }], nextPageToken: undefined, scannedMessages: 1, historyId: "200",
		} });
		const historyRequests = requests.filter(({ url }) => url.pathname.endsWith("/history"));
		assert.equal(historyRequests[2].url.searchParams.get("pageToken"), "google-page-2");
		assert.equal(historyRequests[0].url.searchParams.get("startHistoryId"), "100");
		assert.deepEqual([...historyRequests[0].url.searchParams.getAll("historyTypes")], ["messageAdded", "labelAdded", "labelRemoved"]);
	});

	it("returns the current checkpoint when no messages have changed", async () => {
		const { mailbox } = harness(() => ({ status: 200, body: { historyId: "200" } }));
		assert.deepEqual(await mailbox.listChangedMessageSenders({ userId: USER, startHistoryId: "100" }), { ok: true, value: { senders: [], scannedMessages: 0, nextPageToken: undefined, historyId: "200" } });
	});

	it("distinguishes an expired history checkpoint from a transient Gmail failure", async () => {
		const { mailbox } = harness(() => ({ status: 404, body: { error: { message: "History expired" } } }));
		assert.deepEqual(await mailbox.listChangedMessageSenders({ userId: USER, startHistoryId: "old" }), { ok: false, reason: "history-expired" });
	});

	it.each([401, 403])("refreshes the cached token once after HTTP %i and retries using the newly consented grant", async (status) => {
		let requests = 0;
		const { mailbox, refreshes } = harness(() => ++requests === 1
			? { status, body: { error: { message: "Missing scope", errors: [{ reason: "insufficientPermissions" }] } } }
			: { status: 200, body: { emailAddress: "reader@gmail.com", historyId: "1" } });
		const result = await mailbox.findProfile({ userId: USER });
		assert(result.ok);
		assert.deepEqual(refreshes, [false, true]);
	});

	it.each([
		{ status: 401, body: {}, expected: { ok: false, reason: "reauth-required" } },
		{ status: 403, body: { error: { message: "Missing scope", errors: [{ reason: "insufficientPermissions" }] } }, expected: { ok: false, reason: "metadata-permission-required" } },
		{ status: 403, body: { error: { message: "Missing scope", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }, expected: { ok: false, reason: "metadata-permission-required" } },
	])("stops after a second authentication rejection: $status $expected.reason", async ({ status, body, expected }) => {
		const { mailbox, refreshes } = harness(() => ({ status, body }));
		assert.deepEqual(await mailbox.findProfile({ userId: USER }), expected);
		assert.deepEqual(refreshes, [false, true]);
	});

	it.each(["rateLimitExceeded", "userRateLimitExceeded"])("retries HTTP 403 %s as a quota failure without forcing consent", async (reason) => {
		const { mailbox, refreshes } = harness(() => ({ status: 403, body: { error: { message: "Slow down", errors: [{ reason }] } } }));
		assert.deepEqual(await mailbox.listMessageSenders({ userId: USER }), { ok: false, reason: "unavailable", status: 403 });
		assert.deepEqual(refreshes, [false]);
	});

	it.each([429, 503])("surfaces HTTP %i as retryable", async (status) => {
		const { mailbox } = harness(() => ({ status }));
		assert.deepEqual(await mailbox.listChangedMessageSenders({ userId: USER, startHistoryId: "100" }), { ok: false, reason: "unavailable", status });
	});

	it.each([
		{ status: 403, body: { error: { message: "Domain policy", details: [{}] } }, message: "Domain policy" },
		{ status: 400, body: { error: { message: "Invalid request" } }, message: "Invalid request" },
		{ status: 403, body: { unexpected: "shape" }, message: "status 403" },
		{ status: 403, body: undefined, message: "status 403" },
	])("reports other rejections without treating them as missing metadata access: $message", async ({ status, body, message }) => {
		const { mailbox, refreshes } = harness(() => ({ status, body }));
		assert.deepEqual(await mailbox.findProfile({ userId: USER }), { ok: false, reason: "rejected", status, message });
		assert.deepEqual(refreshes, [false]);
	});

	it("retries malformed successful API responses", async () => {
		const { mailbox } = harness(() => ({ status: 200, body: { messages: "invalid" } }));
		assert.deepEqual(await mailbox.listMessageSenders({ userId: USER }), { ok: false, reason: "unavailable", status: 200 });
	});

	it.each(["full", "history"])("propagates metadata failures during a %s scan", async (mode) => {
		const { mailbox } = harness((url) => {
			if (url.pathname.endsWith("/messages")) return { status: 200, body: { messages: [{ id: "one" }] } };
			if (url.pathname.endsWith("/history")) return { status: 200, body: { history: [{ messages: [{ id: "one" }] }], historyId: "200" } };
			return { status: 503 };
		});
		const result = mode === "full"
			? await mailbox.listMessageSenders({ userId: USER })
			: await mailbox.listChangedMessageSenders({ userId: USER, startHistoryId: "100" });
		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 503 });
	});

	it("returns credential failure without requesting the mailbox", async () => {
		const { mailbox, requests } = harness(() => { throw new Error("no request expected"); }, [{ ok: false, reason: "reauth-required" }]);
		assert.deepEqual(await mailbox.findProfile({ userId: USER }), { ok: false, reason: "reauth-required" });
		assert.deepEqual(requests, []);
	});
});
