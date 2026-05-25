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

	it("findByUserIdConsistent mirrors findByUserId for the in-memory store", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		expect(await subs.findByUserIdConsistent(userId)).toBeUndefined();
		await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });
		const row = await subs.findByUserIdConsistent(userId);
		assert(row);
		expect(row.status).toBe("trialing");
	});

	describe("upsertCustomerId", () => {
		it("creates a cancelled row with the customerId when none exists", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			const result = await subs.upsertCustomerId({ userId, customerId: "cus_brand_new" });
			expect(result.ok).toBe(true);
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.status).toBe("cancelled");
			expect(row.customerId).toBe("cus_brand_new");
		});

		it("writes the customerId onto an existing trialing row without changing status", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });
			const result = await subs.upsertCustomerId({ userId, customerId: "cus_added" });
			expect(result.ok).toBe(true);
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.status).toBe("trialing");
			expect(row.customerId).toBe("cus_added");
		});

		it("returns customer-id-already-set when the row already has a customerId", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertCustomerId({ userId, customerId: "cus_winner" });
			const result = await subs.upsertCustomerId({ userId, customerId: "cus_loser" });
			expect(result).toEqual({ ok: false, reason: "customer-id-already-set" });
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.customerId).toBe("cus_winner");
		});
	});

	describe("upsertPaymentMethod", () => {
		it("writes paymentMethodId, brand, last4 and clears any prior chargeFailedAt", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			subs.seedRow({
				userId,
				provider: "stripe",
				status: "cancelled",
				customerId: "cus_x",
				chargeFailedAt: "2026-05-01T00:00:00.000Z",
				chargeFailedReason: "card_declined",
				createdAt: "2026-04-01T00:00:00.000Z",
				updatedAt: "2026-05-01T00:00:00.000Z",
			});
			await subs.upsertPaymentMethod({ userId, paymentMethodId: "pm_new", brand: "visa", last4: "4242" });
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.paymentMethodId).toBe("pm_new");
			expect(row.paymentMethodBrand).toBe("visa");
			expect(row.paymentMethodLast4).toBe("4242");
			expect(row.chargeFailedAt).toBeUndefined();
			expect(row.chargeFailedReason).toBeUndefined();
		});

		it("throws when called for an unknown user", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await expect(
				subs.upsertPaymentMethod({ userId, paymentMethodId: "pm_x", brand: "visa", last4: "0000" }),
			).rejects.toThrow(/No subscription row/);
		});
	});

	describe("markChargeRequested", () => {
		it("returns ok and writes chargeRequestedAt on first call", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });
			const res = await subs.markChargeRequested({ userId, requestedAt: "2026-06-05T00:00:00.000Z" });
			expect(res.ok).toBe(true);
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.chargeRequestedAt).toBe("2026-06-05T00:00:00.000Z");
		});

		it("returns charge-already-requested when the sentinel is set", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			subs.seedRow({
				userId,
				provider: "stripe",
				status: "trialing",
				customerId: "cus_x",
				paymentMethodId: "pm_x",
				paymentMethodBrand: "visa",
				paymentMethodLast4: "4242",
				chargeRequestedAt: "2026-06-05T00:00:00.000Z",
				createdAt: "2026-05-01T00:00:00.000Z",
				updatedAt: "2026-05-01T00:00:00.000Z",
			});
			const res = await subs.markChargeRequested({ userId, requestedAt: "2026-06-06T00:00:00.000Z" });
			expect(res).toEqual({ ok: false, reason: "charge-already-requested" });
		});

		it("throws when called for an unknown user", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await expect(subs.markChargeRequested({ userId, requestedAt: "2026-06-05T00:00:00.000Z" })).rejects.toThrow(
				/No subscription row/,
			);
		});
	});

	describe("markChargeFailed and clearChargeFailed", () => {
		it("writes chargeFailedAt + chargeFailedReason and clears chargeRequestedAt", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			subs.seedRow({
				userId,
				provider: "stripe",
				status: "cancelled",
				customerId: "cus_x",
				paymentMethodId: "pm_x",
				paymentMethodBrand: "visa",
				paymentMethodLast4: "4242",
				chargeRequestedAt: "2026-06-05T00:00:00.000Z",
				createdAt: "2026-05-01T00:00:00.000Z",
				updatedAt: "2026-05-01T00:00:00.000Z",
			});
			await subs.markChargeFailed({ userId, failedAt: "2026-06-05T00:01:00.000Z", reason: "card_declined" });
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.chargeFailedAt).toBe("2026-06-05T00:01:00.000Z");
			expect(row.chargeFailedReason).toBe("card_declined");
			expect(row.chargeRequestedAt).toBeUndefined();
		});

		it("clearChargeFailed removes chargeFailedAt + chargeFailedReason", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			subs.seedRow({
				userId,
				provider: "stripe",
				status: "active",
				customerId: "cus_x",
				subscriptionId: "sub_x",
				chargeFailedAt: "2026-05-01T00:00:00.000Z",
				chargeFailedReason: "card_declined",
				createdAt: "2026-04-01T00:00:00.000Z",
				updatedAt: "2026-05-01T00:00:00.000Z",
			});
			await subs.clearChargeFailed({ userId });
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.chargeFailedAt).toBeUndefined();
			expect(row.chargeFailedReason).toBeUndefined();
		});

		it("markChargeFailed throws for an unknown user", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await expect(
				subs.markChargeFailed({ userId, failedAt: "2026-06-05T00:00:00.000Z", reason: "card_declined" }),
			).rejects.toThrow(/No subscription row/);
		});

		it("clearChargeFailed throws for an unknown user", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await expect(subs.clearChargeFailed({ userId })).rejects.toThrow(/No subscription row/);
		});
	});

	describe("upsertCancelled", () => {
		it("creates a cancelled row for an unknown user", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertCancelled({ userId });
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.status).toBe("cancelled");
		});

		it("preserves customerId and payment method fields when cancelling an existing row", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });
			await subs.upsertCustomerId({ userId, customerId: "cus_keep" });
			await subs.upsertPaymentMethod({ userId, paymentMethodId: "pm_keep", brand: "visa", last4: "4242" });
			await subs.upsertCancelled({ userId });
			const row = await subs.findByUserId(userId);
			assert(row);
			expect(row.status).toBe("cancelled");
			expect(row.customerId).toBe("cus_keep");
			expect(row.paymentMethodId).toBe("pm_keep");
			expect(row.paymentMethodBrand).toBe("visa");
			expect(row.paymentMethodLast4).toBe("4242");
		});
	});

	it("upsertActive preserves payment method fields when activating an existing row", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		subs.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			paymentMethodId: "pm_keep",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			createdAt: "2026-04-01T00:00:00.000Z",
			updatedAt: "2026-04-01T00:00:00.000Z",
		});
		await subs.upsertActive({ userId, subscriptionId: "sub_new", customerId: "cus_x" });
		const row = await subs.findByUserId(userId);
		assert(row);
		expect(row.paymentMethodId).toBe("pm_keep");
		expect(row.paymentMethodBrand).toBe("visa");
		expect(row.paymentMethodLast4).toBe("4242");
	});
});
