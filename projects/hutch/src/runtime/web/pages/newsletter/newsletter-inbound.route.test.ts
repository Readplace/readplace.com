import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const DAY_MS = 24 * 60 * 60 * 1000;

type Harness = ReturnType<typeof useApp>;
type Fixture = ReturnType<typeof createDefaultTestAppFixture>;

function signedHeaders(input: {
	secret: string;
	id: string;
	timestamp: number;
	payload: string;
}): Record<string, string> {
	const secretBytes = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
	const signature = createHmac("sha256", secretBytes)
		.update(`${input.id}.${input.timestamp}.${input.payload}`)
		.digest("base64");
	return {
		"svix-id": input.id,
		"svix-timestamp": String(input.timestamp),
		"svix-signature": `v1,${signature}`,
	};
}

function receivedEvent(input: { to: string; emailId?: string; subject?: string }) {
	return {
		type: "email.received",
		created_at: "2026-06-05T10:00:00.000Z",
		data: {
			email_id: input.emailId ?? "email-default",
			from: "newsletter@substack.com",
			to: input.to,
			...(input.subject !== undefined ? { subject: input.subject } : {}),
		},
	};
}

function postWebhook(
	harness: Harness,
	fixture: Fixture,
	payloadObj: unknown,
	opts?: { id?: string; timestamp?: number; headers?: Record<string, string> },
) {
	const payload = JSON.stringify(payloadObj);
	const id = opts?.id ?? "evt_1";
	const timestamp = opts?.timestamp ?? Math.floor(Date.now() / 1000);
	const headers =
		opts?.headers ??
		signedHeaders({ secret: fixture.newsletter.inboundSigningSecret, id, timestamp, payload });
	return request(harness.server)
		.post("/webhooks/resend-inbound")
		.set("Content-Type", "application/json")
		.set(headers)
		.send(payload);
}

async function setupInbox(harness: Harness, fixture: Fixture) {
	await loginAgent(harness.server, harness.auth);
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "user must exist after login");
	const inbox = await fixture.newsletter.inboxStore.getOrCreateInbox(user.userId);
	return { userId: user.userId, address: `${inbox.token}@${fixture.newsletter.inboxDomain}` };
}

describe("Newsletter inbound webhook", () => {
	it("rejects an invalid signature with 401", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { address } = await setupInbox(harness, fixture);

		const response = await postWebhook(harness, fixture, receivedEvent({ to: address }), {
			headers: {
				"svix-id": "evt_1",
				"svix-timestamp": String(Math.floor(Date.now() / 1000)),
				"svix-signature": "v1,not-the-real-signature",
			},
		});

		expect(response.status).toBe(401);
	});

	it("rejects a non-JSON payload with 400", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		await setupInbox(harness, fixture);
		const payload = "this is not json";
		const timestamp = Math.floor(Date.now() / 1000);

		const response = await request(harness.server)
			.post("/webhooks/resend-inbound")
			.set("Content-Type", "application/json")
			.set(signedHeaders({ secret: fixture.newsletter.inboundSigningSecret, id: "evt_1", timestamp, payload }))
			.send(payload);

		expect(response.status).toBe(400);
	});

	it("returns 401 for a request that is not application/json", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		await setupInbox(harness, fixture);

		const response = await request(harness.server)
			.post("/webhooks/resend-inbound")
			.set("Content-Type", "text/plain")
			.send("hello");

		expect(response.status).toBe(401);
	});

	it("acknowledges a non-received event type without processing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { address } = await setupInbox(harness, fixture);

		const response = await postWebhook(harness, fixture, {
			...receivedEvent({ to: address }),
			type: "email.delivered",
		});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ status: "ignored" });
	});

	it("ignores a message addressed to a non-inbox recipient", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		await setupInbox(harness, fixture);

		const response = await postWebhook(harness, fixture, receivedEvent({ to: "someone@example.com" }));

		expect(response.body).toEqual({ status: "ignored" });
	});

	it("ignores an inbox token that maps to no user", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		await setupInbox(harness, fixture);
		const unknown = `${"f".repeat(24)}@${fixture.newsletter.inboxDomain}`;

		const response = await postWebhook(harness, fixture, receivedEvent({ to: unknown }));

		expect(response.body).toEqual({ status: "ignored" });
	});

	it("ignores an event whose email id is not a valid message id", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { address } = await setupInbox(harness, fixture);

		const response = await postWebhook(
			harness,
			fixture,
			receivedEvent({ to: address, emailId: "bad id with spaces" }),
		);

		expect(response.body).toEqual({ status: "ignored" });
	});

	it("ignores when the message body cannot be fetched", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { address } = await setupInbox(harness, fixture);

		const response = await postWebhook(
			harness,
			fixture,
			receivedEvent({ to: address, emailId: "missing-body" }),
		);

		expect(response.body).toEqual({ status: "ignored" });
	});

	it("saves the harvested links to the queue and records the message", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { userId, address } = await setupInbox(harness, fixture);
		fixture.newsletter.seedInboundEmail("email-with-links", {
			html:
				'<a href="https://example.com/post-1">One</a> plus a private link http://router.lan/admin and https://example.com/post-2',
		});

		const response = await postWebhook(
			harness,
			fixture,
			receivedEvent({ to: address, emailId: "email-with-links", subject: "Weekly digest" }),
		);

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ status: "processed", saved: 2, skipped: 1 });

		const { articles } = await fixture.articleStore.findArticlesByUser({ userId });
		const urls = articles.map((article) => article.url);
		expect(urls).toEqual(
			expect.arrayContaining(["https://example.com/post-1", "https://example.com/post-2"]),
		);

		const list = await fixture.newsletter.messageStore.listMessages(userId);
		expect(list).toHaveLength(1);
		expect(list[0].subject).toBe("Weekly digest");
		expect(list[0].savedCount).toBe(2);
	});

	it("records a message that has no links and no subject", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { userId, address } = await setupInbox(harness, fixture);
		fixture.newsletter.seedInboundEmail("email-empty", { html: "<p>No links in this issue.</p>" });

		const response = await postWebhook(
			harness,
			fixture,
			receivedEvent({ to: address, emailId: "email-empty" }),
		);

		expect(response.body).toEqual({ status: "processed", saved: 0, skipped: 0 });
		const list = await fixture.newsletter.messageStore.listMessages(userId);
		expect(list[0].subject).toBe("");
	});

	it("records the message but saves no links when the recipient is read-only", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { userId, address } = await setupInbox(harness, fixture);
		await fixture.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: "2020-01-01T00:00:00.000Z",
		});
		fixture.newsletter.seedInboundEmail("email-readonly", {
			html: '<a href="https://example.com/post-1">One</a> and https://example.com/post-2',
		});

		const response = await postWebhook(
			harness,
			fixture,
			receivedEvent({ to: address, emailId: "email-readonly", subject: "Weekly digest" }),
		);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ status: "save-disabled", saved: 0, skipped: 0 });

		const { articles } = await fixture.articleStore.findArticlesByUser({ userId });
		expect(articles).toHaveLength(0);

		const list = await fixture.newsletter.messageStore.listMessages(userId);
		expect(list).toHaveLength(1);
		expect(list[0].subject).toBe("Weekly digest");
		expect(list[0].savedCount).toBe(0);
	});

	it("records the message but saves no links when the recipient is locked (email unverified past the window)", async () => {
		/** A full-access founding user who never verified their email is locked once
		 * the 7-day window lapses. Running the server clock 8 days ahead lands a
		 * freshly-created user past it; the Svix timestamp is moved in lockstep so the
		 * signature stays inside its ±5-min replay window. */
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const clockMs = Date.now() + 8 * DAY_MS;
		fixture.shared.now = () => new Date(clockMs);
		const harness = useApp(fixture);
		const { userId, address } = await setupInbox(harness, fixture);
		fixture.newsletter.seedInboundEmail("email-locked", {
			html: '<a href="https://example.com/post-1">One</a> and https://example.com/post-2',
		});

		const response = await postWebhook(
			harness,
			fixture,
			receivedEvent({ to: address, emailId: "email-locked", subject: "Weekly digest" }),
			{ timestamp: Math.floor(clockMs / 1000) },
		);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ status: "save-disabled", saved: 0, skipped: 0 });

		const { articles } = await fixture.articleStore.findArticlesByUser({ userId });
		expect(articles).toHaveLength(0);

		const list = await fixture.newsletter.messageStore.listMessages(userId);
		expect(list).toHaveLength(1);
		expect(list[0].subject).toBe("Weekly digest");
		expect(list[0].savedCount).toBe(0);
	});

	it("isolates a single link's save failure, saving the rest and recording the message", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			freshness: {
				refreshArticleIfStale: async (params) => {
					if (params.url === "https://example.com/boom") {
						throw new Error("save boom");
					}
					return fixture.freshness.refreshArticleIfStale(params);
				},
			},
		});
		const { userId, address } = await setupInbox(harness, fixture);
		fixture.newsletter.seedInboundEmail("email-partial-failure", {
			html: '<a href="https://example.com/boom">Boom</a> and <a href="https://example.com/ok">OK</a>',
		});

		const response = await postWebhook(
			harness,
			fixture,
			receivedEvent({ to: address, emailId: "email-partial-failure", subject: "Weekly digest" }),
		);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ status: "processed", saved: 1, skipped: 1 });

		const { articles } = await fixture.articleStore.findArticlesByUser({ userId });
		expect(articles.map((article) => article.url)).toEqual(["https://example.com/ok"]);

		const list = await fixture.newsletter.messageStore.listMessages(userId);
		expect(list).toHaveLength(1);
		expect(list[0].savedCount).toBe(1);
	});
});
