import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemorySubscriptionProviders } from "./in-memory-subscription-providers";

describe("initInMemorySubscriptionProviders", () => {
	const userId = UserIdSchema.parse("u-1");
	const otherUserId = UserIdSchema.parse("u-2");

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

	it("marks a subscription as cancelled by subscriptionId", async () => {
		const clock = { iso: "2026-05-22T00:00:00.000Z" };
		const subs = initInMemorySubscriptionProviders({ now: () => new Date(clock.iso) });
		await subs.upsertActive({ userId, subscriptionId: "sub_a", customerId: "cus_a" });
		await subs.upsertActive({ userId: otherUserId, subscriptionId: "sub_b", customerId: "cus_b" });

		clock.iso = "2026-06-01T00:00:00.000Z";
		await subs.markCancelled({ subscriptionId: "sub_a" });

		const a = await subs.findByUserId(userId);
		const b = await subs.findByUserId(otherUserId);
		assert(a && b, "both rows must exist");
		expect(a.status).toBe("cancelled");
		expect(a.updatedAt).toBe("2026-06-01T00:00:00.000Z");
		expect(b.status).toBe("active");
	});

	it("throws when markCancelled cannot find the subscriptionId", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await expect(subs.markCancelled({ subscriptionId: "sub_missing" })).rejects.toThrow(/No subscription row/);
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
});
