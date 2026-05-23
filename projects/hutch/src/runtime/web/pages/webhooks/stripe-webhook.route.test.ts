import assert from "node:assert/strict";
import request from "supertest";
import { useTestServer, TEST_STRIPE_WEBHOOK_SECRET } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { signStripeWebhookHeader } from "./stripe-webhook.page";

const useApp = useTestServer();

function buildEvent(params: { type: string; subscriptionId: string }): Buffer {
	return Buffer.from(
		JSON.stringify({
			id: `evt_${Math.random().toString(36).slice(2)}`,
			type: params.type,
			data: { object: { id: params.subscriptionId } },
		}),
	);
}

function buildSignature(rawBody: Buffer, opts?: { secret?: string; timestampSeconds?: number }): string {
	return signStripeWebhookHeader({
		rawBody,
		secret: opts?.secret ?? TEST_STRIPE_WEBHOOK_SECRET,
		timestampSeconds: opts?.timestampSeconds ?? Math.floor(Date.now() / 1000),
	});
}

describe("POST /webhooks/stripe", () => {
	it("flips an active subscription_providers row to cancelled on customer.subscription.deleted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, subscriptionProviders } = harness;
		const createResult = await auth.createUser({ email: "active@example.com", password: "password123" });
		assert(createResult.ok, "setup user");
		await subscriptionProviders.upsertActive({
			userId: createResult.userId,
			subscriptionId: "sub_live_1",
			customerId: "cus_live_1",
		});

		const rawBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_live_1" });
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", buildSignature(rawBody))
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(200);
		const row = await subscriptionProviders.findByUserId(createResult.userId);
		assert(row, "row must still exist");
		expect(row.status).toBe("cancelled");
		expect(row.subscriptionId).toBe("sub_live_1");
	});

	it("acknowledges unknown event types with 200 so Stripe stops retrying", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, subscriptionProviders } = harness;
		const createResult = await auth.createUser({ email: "noop@example.com", password: "password123" });
		assert(createResult.ok, "setup user");
		await subscriptionProviders.upsertActive({
			userId: createResult.userId,
			subscriptionId: "sub_live_noop",
			customerId: "cus_live_noop",
		});

		const rawBody = buildEvent({ type: "invoice.created", subscriptionId: "sub_live_noop" });
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", buildSignature(rawBody))
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(200);
		const row = await subscriptionProviders.findByUserId(createResult.userId);
		assert(row, "row must still exist");
		expect(row.status).toBe("active");
	});

	it("rejects requests with no Stripe-Signature header so spoofed callers cannot trigger handlers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const rawBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_x" });
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(400);
		expect(response.text).toContain("Missing signature");
	});

	it("rejects requests whose signature was computed with a different secret", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, subscriptionProviders } = harness;
		const createResult = await auth.createUser({ email: "spoofed@example.com", password: "password123" });
		assert(createResult.ok, "setup user");
		await subscriptionProviders.upsertActive({
			userId: createResult.userId,
			subscriptionId: "sub_spoofed",
			customerId: "cus_spoofed",
		});

		const rawBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_spoofed" });
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", buildSignature(rawBody, { secret: "whsec_attacker_guess" }))
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(400);
		const row = await subscriptionProviders.findByUserId(createResult.userId);
		expect(row?.status).toBe("active");
	});

	it("rejects requests whose timestamp drifts beyond the 5-minute tolerance window so replay attacks are bounded", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const rawBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_stale" });
		const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", buildSignature(rawBody, { timestampSeconds: tenMinutesAgo }))
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(400);
	});

	it("rejects requests whose body has been mutated after signing so signature pinning works", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const signedBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_signed" });
		const signature = buildSignature(signedBody);
		const tamperedBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_TAMPERED" });
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", signature)
			.set("Content-Type", "application/json")
			.send(tamperedBody.toString("utf-8"));

		expect(response.status).toBe(400);
	});

	it("returns 200 for re-deliveries of an already-cancelled event so Stripe's at-least-once delivery does not error-flap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, subscriptionProviders } = harness;
		const createResult = await auth.createUser({ email: "redelivered@example.com", password: "password123" });
		assert(createResult.ok, "setup user");
		await subscriptionProviders.upsertActive({
			userId: createResult.userId,
			subscriptionId: "sub_redeliver",
			customerId: "cus_redeliver",
		});

		const rawBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_redeliver" });
		const sig = buildSignature(rawBody);
		const first = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", sig)
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));
		const second = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", sig)
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		const row = await subscriptionProviders.findByUserId(createResult.userId);
		expect(row?.status).toBe("cancelled");
	});

	it("rejects requests whose Stripe-Signature header is missing the t= and v1= parts", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const rawBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_malformed" });
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", "scheme=v0,nope=garbage")
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(400);
		expect(response.text).toContain("Bad signature");
	});

	it("rejects requests whose Stripe-Signature header carries a non-numeric timestamp", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const rawBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_nonnumeric" });
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", "t=NaN,v1=fff")
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(400);
	});

	it("rejects requests whose body is signed correctly but is not a valid Stripe event shape", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const rawBody = Buffer.from(JSON.stringify({ id: "evt", type: "x" /* missing data.object */ }));
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", buildSignature(rawBody))
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(400);
	});

	it("returns 200 when Stripe sends customer.subscription.deleted for a subscription we have no row for so unrelated webhooks do not crash the handler", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const rawBody = buildEvent({ type: "customer.subscription.deleted", subscriptionId: "sub_unknown" });
		const response = await request(harness.server)
			.post("/webhooks/stripe")
			.set("Stripe-Signature", buildSignature(rawBody))
			.set("Content-Type", "application/json")
			.send(rawBody.toString("utf-8"));

		expect(response.status).toBe(200);
	});
});
