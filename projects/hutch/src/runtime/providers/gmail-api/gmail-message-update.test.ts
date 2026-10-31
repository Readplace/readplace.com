import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { NormalizedMessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { OpenedGmailMailbox } from "@packages/provider-contracts/gmail-message-update";
import { GMAIL_MODIFY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { initOpenGmailMailboxForUpdate } from "./gmail-message-update";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const ACCOUNT = GmailAccountEmailSchema.parse("Reader@gmail.com");
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const SETTINGS = "https://www.googleapis.com/auth/gmail.settings.basic";
const MESSAGE = GmailMessageIdSchema.parse("18c2f0a1b2c3d4e5");

interface Sent {
	url: URL;
	method: string;
	authorization: string | undefined;
	body: string | undefined;
}

type Route = (request: Sent) => Response | undefined;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function harness(input: { grantedScope?: string | undefined; routes?: Route[] } = {}) {
	const sent: Sent[] = [];
	const routes: Route[] = [
		...(input.routes ?? []),
		(request) => (request.url.pathname === "/token" ? json({ access_token: "token-1", expires_in: 3600 }) : undefined),
		(request) => (request.url.pathname.endsWith("/profile") ? json({ emailAddress: "reader@gmail.com" }) : undefined),
	];
	const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		const request: Sent = {
			url: new URL(String(url)),
			method: init?.method ?? "GET",
			authorization: new Headers(init?.headers).get("authorization") ?? undefined,
			body: typeof init?.body === "string" ? init.body : undefined,
		};
		sent.push(request);
		for (const route of routes) {
			const response = route(request);
			if (response !== undefined) return response;
		}
		throw new Error(`unrouted ${request.method} ${request.url}`);
	}) as typeof globalThis.fetch;
	const grantedScope = "grantedScope" in input ? input.grantedScope : `${SETTINGS} ${MODIFY}`;
	const open = initOpenGmailMailboxForUpdate({
		clientId: "client",
		clientSecret: "secret",
		credentials: {
			findCredentialsByUserId: async () => (grantedScope === undefined ? undefined : { refreshToken: "refresh-1", grantedScope }),
		},
		fetch,
	});
	return { sent, open: () => open({ userId: USER, accountEmail: ACCOUNT }) };
}

async function opened(h: ReturnType<typeof harness>): Promise<OpenedGmailMailbox> {
	const result = await h.open();
	assert(result.ok, "the mailbox opens");
	return result.mailbox;
}

const on = (method: string, path: RegExp, respond: (request: Sent) => Response): Route => (request) =>
	request.method === method && path.test(request.url.pathname) ? respond(request) : undefined;

describe("initOpenGmailMailboxForUpdate", () => {
	it("reports a reader with no stored grant as not connected", async () => {
		assert.deepEqual(await harness({ grantedScope: undefined }).open(), { ok: false, reason: "not-connected" });
	});

	it("refuses to open a mailbox whose grant lacks modify permission, without calling Google", async () => {
		const h = harness({ grantedScope: `${SETTINGS} https://www.googleapis.com/auth/gmail.readonly` });

		assert.deepEqual(await h.open(), { ok: false, reason: "modify-permission-required" });
		assert.deepEqual(h.sent, []);
	});

	it("mints one modify-scoped access token from the stored refresh token and checks the mailbox's address", async () => {
		const h = harness();

		const result = await h.open();

		assert.equal(result.ok, true);
		assert.equal(h.sent[0]?.url.pathname, "/token");
		assert.equal(new URLSearchParams(h.sent[0]?.body).get("refresh_token"), "refresh-1");
		assert.equal(new URLSearchParams(h.sent[0]?.body).get("scope"), GMAIL_MODIFY_SCOPE);
		assert.equal(h.sent[1]?.authorization, "Bearer token-1");
	});

	it("needs modify permission when Google refuses to narrow the token to it", async () => {
		const h = harness({ routes: [on("POST", /^\/token$/, () => json({ error: "invalid_scope" }, 400))] });

		assert.deepEqual(await h.open(), { ok: false, reason: "modify-permission-required" });
	});

	it("needs reauthorisation when Google rejects the stored grant", async () => {
		const h = harness({ routes: [on("POST", /^\/token$/, () => json({ error: "invalid_grant" }, 400))] });

		assert.deepEqual(await h.open(), { ok: false, reason: "reauth-required" });
	});

	it("reports the token endpoint failing as unavailable", async () => {
		const h = harness({ routes: [on("POST", /^\/token$/, () => new Response("down", { status: 503 }))] });

		assert.deepEqual(await h.open(), { ok: false, reason: "unavailable", status: 503 });
	});

	it("refuses a mailbox that belongs to a different account", async () => {
		const h = harness({ routes: [on("GET", /\/profile$/, () => json({ emailAddress: "someone-else@gmail.com" }))] });

		assert.deepEqual(await h.open(), { ok: false, reason: "account-mismatch" });
	});

	it("needs reauthorisation when the fresh token is refused", async () => {
		const h = harness({ routes: [on("GET", /\/profile$/, () => new Response("", { status: 401 }))] });

		assert.deepEqual(await h.open(), { ok: false, reason: "reauth-required" });
	});

	it("reports a profile Gmail cannot serve as unavailable", async () => {
		const h = harness({ routes: [on("GET", /\/profile$/, () => json({}, 500))] });

		assert.deepEqual(await h.open(), { ok: false, reason: "unavailable", status: 500 });
	});

	it("reports a refused profile as unavailable", async () => {
		const h = harness({ routes: [on("GET", /\/profile$/, () => json({ error: { message: "Forbidden" } }, 403))] });

		assert.deepEqual(await h.open(), { ok: false, reason: "unavailable", status: 403 });
	});

	it("reports an unreadable profile as unavailable", async () => {
		const h = harness({ routes: [on("GET", /\/profile$/, () => new Response("not json", { status: 200 }))] });

		assert.deepEqual(await h.open(), { ok: false, reason: "unavailable", status: 200 });
	});

	it("finds a history message by its Gmail id", async () => {
		const h = harness({ routes: [on("GET", /\/messages\/18c2f0a1b2c3d4e5$/, () => json({ id: MESSAGE }))] });
		const mailbox = await opened(h);

		assert.deepEqual(await mailbox.findMessage({ messageId: MESSAGE }), { ok: true, value: { found: true } });
		assert.equal(h.sent.at(-1)?.url.searchParams.get("format"), "minimal");
	});

	it("reports a deleted history message as not found", async () => {
		const mailbox = await opened(harness({ routes: [on("GET", /\/messages\/18c2f0a1b2c3d4e5$/, () => json({}, 404))] }));

		assert.deepEqual(await mailbox.findMessage({ messageId: MESSAGE }), { ok: true, value: { found: false } });
	});

	it("searches by RFC Message-ID and sender, then reads each candidate's identifying headers", async () => {
		const h = harness({
			routes: [
				on("GET", /\/messages$/, () => json({ messages: [{ id: MESSAGE }] })),
				on("GET", /\/messages\/18c2f0a1b2c3d4e5$/, () =>
					json({ id: MESSAGE, payload: { headers: [{ name: "Message-Id", value: "<issue@news.test>" }, { name: "From", value: "News <dan@news.test>" }] } }),
				),
			],
		});
		const mailbox = await opened(h);

		const found = await mailbox.searchByRfcMessageId({
			rfcMessageId: NormalizedMessageIdSchema.parse("issue@news.test"),
			senderEmail: ForwardableSenderSchema.parse("dan@news.test"),
		});

		assert.deepEqual(found, { ok: true, value: [{ id: MESSAGE, messageIdHeader: "<issue@news.test>", fromHeader: "News <dan@news.test>" }] });
		const search = h.sent.find((request) => request.url.pathname.endsWith("/messages"));
		assert.equal(search?.url.searchParams.get("q"), "rfc822msgid:issue@news.test from:dan@news.test");
		assert.equal(h.sent.at(-1)?.url.searchParams.getAll("metadataHeaders").join(","), "Message-ID,From");
	});

	it("returns no candidates when the search finds nothing", async () => {
		const mailbox = await opened(harness({ routes: [on("GET", /\/messages$/, () => json({}))] }));

		const found = await mailbox.searchByRfcMessageId({
			rfcMessageId: NormalizedMessageIdSchema.parse("issue@news.test"),
			senderEmail: ForwardableSenderSchema.parse("dan@news.test"),
		});

		assert.deepEqual(found, { ok: true, value: [] });
	});

	it("reads a candidate with no headers as unidentified", async () => {
		const mailbox = await opened(harness({
			routes: [
				on("GET", /\/messages$/, () => json({ messages: [{ id: MESSAGE }] })),
				on("GET", /\/messages\/18c2f0a1b2c3d4e5$/, () => json({ id: MESSAGE })),
			],
		}));

		const found = await mailbox.searchByRfcMessageId({
			rfcMessageId: NormalizedMessageIdSchema.parse("issue@news.test"),
			senderEmail: ForwardableSenderSchema.parse("dan@news.test"),
		});

		assert.deepEqual(found, { ok: true, value: [{ id: MESSAGE, messageIdHeader: undefined, fromHeader: undefined }] });
	});

	it("passes on a failed search or header read", async () => {
		const failedSearch = await opened(harness({ routes: [on("GET", /\/messages$/, () => json({}, 503))] }));
		const failedRead = await opened(harness({
			routes: [
				on("GET", /\/messages$/, () => json({ messages: [{ id: MESSAGE }] })),
				on("GET", /\/messages\/18c2f0a1b2c3d4e5$/, () => json({}, 429)),
			],
		}));
		const query = { rfcMessageId: NormalizedMessageIdSchema.parse("issue@news.test"), senderEmail: ForwardableSenderSchema.parse("dan@news.test") };

		assert.deepEqual(await failedSearch.searchByRfcMessageId(query), { ok: false, reason: "unavailable", status: 503 });
		assert.deepEqual(await failedRead.searchByRfcMessageId(query), { ok: false, reason: "unavailable", status: 429 });
	});

	it("finds a label only by its exact name", async () => {
		const mailbox = await opened(harness({
			routes: [on("GET", /\/labels$/, () => json({ labels: [{ id: "Label_1", name: "Imported-To-Readplace" }, { id: "Label_2", name: "imported-to-readplace" }] }))],
		}));

		assert.deepEqual(await mailbox.findLabelId({ name: "imported-to-readplace" }), { ok: true, value: "Label_2" });
		assert.deepEqual(await mailbox.findLabelId({ name: "missing" }), { ok: true, value: undefined });
	});

	it("reads a mailbox with no labels and passes on a failed listing", async () => {
		const empty = await opened(harness({ routes: [on("GET", /\/labels$/, () => json({}))] }));
		const failing = await opened(harness({ routes: [on("GET", /\/labels$/, () => json({}, 500))] }));

		assert.deepEqual(await empty.findLabelId({ name: "imported-to-readplace" }), { ok: true, value: undefined });
		assert.deepEqual(await failing.findLabelId({ name: "imported-to-readplace" }), { ok: false, reason: "unavailable", status: 500 });
	});

	it("creates a visible label", async () => {
		const h = harness({ routes: [on("POST", /\/labels$/, () => json({ id: "Label_42", name: "imported-to-readplace" }))] });
		const mailbox = await opened(h);

		assert.deepEqual(await mailbox.createLabel({ name: "imported-to-readplace" }), { ok: true, value: { created: "Label_42" } });
		assert.deepEqual(JSON.parse(h.sent.at(-1)?.body ?? "{}"), { name: "imported-to-readplace", labelListVisibility: "labelShow", messageListVisibility: "show" });
	});

	it("reports a label that already exists as a conflict", async () => {
		const mailbox = await opened(harness({ routes: [on("POST", /\/labels$/, () => json({ error: { message: "Label name exists or conflicts" } }, 409))] }));

		assert.deepEqual(await mailbox.createLabel({ name: "imported-to-readplace" }), { ok: true, value: { conflict: true } });
	});

	it("passes on a refused label creation", async () => {
		const mailbox = await opened(harness({ routes: [on("POST", /\/labels$/, () => json({ error: { message: "Invalid label name" } }, 400))] }));

		assert.deepEqual(await mailbox.createLabel({ name: "imported-to-readplace" }), { ok: false, reason: "rejected", status: 400, message: "Invalid label name" });
	});

	it("modifies one message's labels in a single request", async () => {
		const h = harness({ routes: [on("POST", /\/messages\/18c2f0a1b2c3d4e5\/modify$/, () => json({ id: MESSAGE }))] });
		const mailbox = await opened(h);

		assert.deepEqual(await mailbox.modifyMessage({ messageId: MESSAGE, addLabelIds: ["Label_42"], removeLabelIds: ["UNREAD"] }), { ok: true, value: undefined });
		assert.deepEqual(JSON.parse(h.sent.at(-1)?.body ?? "{}"), { addLabelIds: ["Label_42"], removeLabelIds: ["UNREAD"] });
		assert.equal(h.sent.at(-1)?.authorization, "Bearer token-1");
	});

	it("needs reauthorisation when a call within the session is refused its token", async () => {
		const mailbox = await opened(harness({ routes: [on("POST", /\/modify$/, () => new Response("", { status: 401 }))] }));

		assert.deepEqual(await mailbox.modifyMessage({ messageId: MESSAGE, addLabelIds: ["Label_42"], removeLabelIds: ["UNREAD"] }), { ok: false, reason: "reauth-required" });
	});
});
