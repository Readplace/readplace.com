import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemorySubscriptionProviders } from "./in-memory-subscription-providers";

describe("initInMemorySubscriptionProviders", () => {
	const userId = UserIdSchema.parse("u-1");

	function fixedNow(iso: string) {
		return () => new Date(iso);
	}

	it("returns undefined for an unknown userId", async () => {
		const { findByUserId } = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		expect(await findByUserId(userId)).toBeUndefined();
	});

	it("returns undefined for an unknown subscriptionId", async () => {
		const { findBySubscriptionId } = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		expect(await findBySubscriptionId("sub_missing")).toBeUndefined();
	});

	it("writes a trialing row with trialEndsAt and no Stripe ids", async () => {
		const { upsertTrialing, findByUserId } = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });

		await upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });

		const row = await findByUserId(userId);
		assert(row, "trialing row must exist");
		expect(row.status).toBe("trialing");
		expect(row.provider).toBe("stripe");
		expect(row.trialEndsAt).toBe("2026-06-05T00:00:00.000Z");
		expect(row.subscriptionId).toBeUndefined();
		expect(row.customerId).toBeUndefined();
		expect(row.createdAt).toBe("2026-05-22T00:00:00.000Z");
		expect(row.updatedAt).toBe("2026-05-22T00:00:00.000Z");
	});

	it("writes an active row with Stripe ids and clears trialEndsAt", async () => {
		const { upsertActive, findByUserId, findBySubscriptionId } = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });

		await upsertActive({ userId, subscriptionId: "sub_123", customerId: "cus_123" });

		const row = await findByUserId(userId);
		assert(row, "active row must exist");
		expect(row.status).toBe("active");
		expect(row.subscriptionId).toBe("sub_123");
		expect(row.customerId).toBe("cus_123");
		expect(row.trialEndsAt).toBeUndefined();

		const byId = await findBySubscriptionId("sub_123");
		expect(byId?.userId).toBe(userId);
	});

	it("preserves createdAt when upserting active over a trialing row", async () => {
		const clock = { iso: "2026-05-22T00:00:00.000Z" };
		const subs = initInMemorySubscriptionProviders({ now: () => new Date(clock.iso) });
		await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });

		clock.iso = "2026-05-24T00:00:00.000Z";
		await subs.upsertActive({ userId, subscriptionId: "sub_abc", customerId: "cus_abc" });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist after upsert");
		expect(row.status).toBe("active");
		expect(row.trialEndsAt).toBeUndefined();
		expect(row.createdAt).toBe("2026-05-22T00:00:00.000Z");
		expect(row.updatedAt).toBe("2026-05-24T00:00:00.000Z");
	});

	it("marks a subscription as pending_cancellation with effective date", async () => {
		const clock = { iso: "2026-05-22T00:00:00.000Z" };
		const subs = initInMemorySubscriptionProviders({ now: () => new Date(clock.iso) });
		await subs.upsertActive({ userId, subscriptionId: "sub_x", customerId: "cus_x" });

		clock.iso = "2026-05-30T00:00:00.000Z";
		await subs.markPendingCancellation({ userId, cancellationEffectiveAt: "2026-06-22T00:00:00.000Z" });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("pending_cancellation");
		expect(row.cancellationEffectiveAt).toBe("2026-06-22T00:00:00.000Z");
		expect(row.subscriptionId).toBe("sub_x");
		expect(row.updatedAt).toBe("2026-05-30T00:00:00.000Z");
	});

	it("throws when markPendingCancellation is called for an unknown user", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await expect(
			subs.markPendingCancellation({ userId, cancellationEffectiveAt: "2026-06-22T00:00:00.000Z" }),
		).rejects.toThrow(/No subscription row/);
	});

	it("marks a trialing subscription as cancelled by userId and clears trialEndsAt", async () => {
		const clock = { iso: "2026-05-22T00:00:00.000Z" };
		const subs = initInMemorySubscriptionProviders({ now: () => new Date(clock.iso) });
		await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });

		clock.iso = "2026-06-01T00:00:00.000Z";
		await subs.markCancelledByUserId({ userId });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("cancelled");
		expect(row.trialEndsAt).toBeUndefined();
		expect(row.cancellationEffectiveAt).toBeUndefined();
		expect(row.updatedAt).toBe("2026-06-01T00:00:00.000Z");
	});

	it("marks an active subscription as cancelled by userId and clears cancellationEffectiveAt", async () => {
		const clock = { iso: "2026-05-22T00:00:00.000Z" };
		const subs = initInMemorySubscriptionProviders({ now: () => new Date(clock.iso) });
		await subs.upsertActive({ userId, subscriptionId: "sub_paid", customerId: "cus_paid" });
		await subs.markPendingCancellation({ userId, cancellationEffectiveAt: "2026-07-01T00:00:00.000Z" });

		clock.iso = "2026-06-01T00:00:00.000Z";
		await subs.markCancelledByUserId({ userId });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("cancelled");
		expect(row.cancellationEffectiveAt).toBeUndefined();
		expect(row.subscriptionId).toBe("sub_paid");
		expect(row.updatedAt).toBe("2026-06-01T00:00:00.000Z");
	});

	it("throws when markCancelledByUserId is called for an unknown user", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await expect(subs.markCancelledByUserId({ userId })).rejects.toThrow(/No subscription row/);
	});

	it("marks a pending_cancellation row back to active when resumed", async () => {
		const clock = { iso: "2026-05-22T00:00:00.000Z" };
		const subs = initInMemorySubscriptionProviders({ now: () => new Date(clock.iso) });
		await subs.upsertActive({ userId, subscriptionId: "sub_r", customerId: "cus_r" });
		await subs.markPendingCancellation({ userId, cancellationEffectiveAt: "2026-06-22T00:00:00.000Z" });

		clock.iso = "2026-05-28T00:00:00.000Z";
		await subs.markActive({ userId });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("active");
		expect(row.cancellationEffectiveAt).toBeUndefined();
		expect(row.updatedAt).toBe("2026-05-28T00:00:00.000Z");
	});

	it("throws when markActive is called for an unknown user", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await expect(subs.markActive({ userId })).rejects.toThrow(/No subscription row/);
	});

	it("markTrialFeedbackEmailSent records the sentAt timestamp on the row", async () => {
		const clock = { iso: "2026-05-22T00:00:00.000Z" };
		const subs = initInMemorySubscriptionProviders({ now: () => new Date(clock.iso) });
		await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });
		await subs.markCancelledByUserId({ userId });

		clock.iso = "2026-06-04T00:00:00.000Z";
		await subs.markTrialFeedbackEmailSent({ userId, sentAt: "2026-06-04T00:00:00.000Z" });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.trialFeedbackEmailSentAt).toBe("2026-06-04T00:00:00.000Z");
		expect(row.status).toBe("cancelled");
		expect(row.updatedAt).toBe("2026-06-04T00:00:00.000Z");
	});

	it("throws when markTrialFeedbackEmailSent is called for an unknown user", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await expect(
			subs.markTrialFeedbackEmailSent({ userId, sentAt: "2026-06-04T00:00:00.000Z" }),
		).rejects.toThrow(/No subscription row/);
	});

	it("markTrialReminderEmailSent records the sentAt timestamp on the row", async () => {
		const clock = { iso: "2026-05-22T00:00:00.000Z" };
		const subs = initInMemorySubscriptionProviders({ now: () => new Date(clock.iso) });
		await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });

		clock.iso = "2026-06-03T00:00:00.000Z";
		await subs.markTrialReminderEmailSent({ userId, sentAt: "2026-06-03T00:00:00.000Z" });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.trialReminderEmailSentAt).toBe("2026-06-03T00:00:00.000Z");
		expect(row.status).toBe("trialing");
		expect(row.updatedAt).toBe("2026-06-03T00:00:00.000Z");
	});

	it("throws when markTrialReminderEmailSent is called for an unknown user", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await expect(
			subs.markTrialReminderEmailSent({ userId, sentAt: "2026-06-03T00:00:00.000Z" }),
		).rejects.toThrow(/No subscription row/);
	});

	it("seedRow lets tests inject hypothetical row shapes (e.g. trialing with customerId)", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });

		subs.seedRow({
			userId,
			provider: "stripe",
			status: "trialing",
			customerId: "cus_seeded",
			trialEndsAt: "2026-06-05T00:00:00.000Z",
			createdAt: "2026-05-01T00:00:00.000Z",
			updatedAt: "2026-05-01T00:00:00.000Z",
		});

		const row = await subs.findByUserId(userId);
		assert(row, "seeded row must be findable");
		expect(row.status).toBe("trialing");
		expect(row.customerId).toBe("cus_seeded");
		expect(row.trialEndsAt).toBe("2026-06-05T00:00:00.000Z");
	});
});
