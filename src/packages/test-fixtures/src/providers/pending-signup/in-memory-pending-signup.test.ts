import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { CheckoutSessionIdSchema } from "../hosted-checkout/hosted-checkout.schema";
import { initInMemoryPendingSignup } from "./in-memory-pending-signup";

describe("initInMemoryPendingSignup", () => {
	it("returns null for an unknown checkout session", async () => {
		const { consumePendingSignup } = initInMemoryPendingSignup();
		const result = await consumePendingSignup(CheckoutSessionIdSchema.parse("cs_test_unknown"));
		expect(result).toBeNull();
	});

	it("returns the stored signup once and then null", async () => {
		const { storePendingSignup, consumePendingSignup } = initInMemoryPendingSignup();
		const checkoutSessionId = CheckoutSessionIdSchema.parse("cs_test_subscribe");
		const userId = UserIdSchema.parse("u-subscribe-123");
		await storePendingSignup({
			checkoutSessionId,
			signup: {
				method: "existing-user-subscribe",
				email: "subscriber@example.com",
				userId,
				returnUrl: "/save",
				entrySource: null,
				offer: "none",
			},
			createdAt: 1735000000,
		});

		const first = await consumePendingSignup(checkoutSessionId);
		assert(first, "first consume should return the stored signup");
		expect(first.email).toBe("subscriber@example.com");
		expect(first.userId).toBe(userId);
		expect(first.returnUrl).toBe("/save");

		const second = await consumePendingSignup(checkoutSessionId);
		expect(second).toBeNull();
	});

	it("hands back the entry source and the offer the signup was stored with", async () => {
		const { storePendingSignup, consumePendingSignup } = initInMemoryPendingSignup();
		const checkoutSessionId = CheckoutSessionIdSchema.parse("cs_test_attribution");
		await storePendingSignup({
			checkoutSessionId,
			signup: {
				method: "existing-user-subscribe",
				email: "attributed@example.com",
				userId: UserIdSchema.parse("u-attributed"),
				entrySource: "keep-panel",
				offer: "first-year-49",
			},
			createdAt: 1735000000,
		});

		const consumed = await consumePendingSignup(checkoutSessionId);
		assert(consumed, "consume should return the stored signup");
		expect(consumed.entrySource).toBe("keep-panel");
		expect(consumed.offer).toBe("first-year-49");
	});

	it("deletes every abandoned-checkout row for a user and leaves other users' rows intact", async () => {
		const { storePendingSignup, consumePendingSignup, deleteByUser } = initInMemoryPendingSignup();
		const targetUser = UserIdSchema.parse("u-del-target");
		const otherUser = UserIdSchema.parse("u-del-other");
		const targetSession = CheckoutSessionIdSchema.parse("cs_test_del_target");
		const otherSession = CheckoutSessionIdSchema.parse("cs_test_del_other");
		await storePendingSignup({
			checkoutSessionId: targetSession,
			signup: { method: "existing-user-subscribe", email: "t@example.com", userId: targetUser, entrySource: null, offer: "none" },
			createdAt: 1,
		});
		await storePendingSignup({
			checkoutSessionId: otherSession,
			signup: { method: "existing-user-subscribe", email: "o@example.com", userId: otherUser, entrySource: null, offer: "none" },
			createdAt: 2,
		});

		await deleteByUser({ userId: targetUser, email: null });

		expect(await consumePendingSignup(targetSession)).toBeNull();
		const survivor = await consumePendingSignup(otherSession);
		assert(survivor, "other user's pending signup must survive");
		expect(survivor.userId).toBe(otherUser);
	});

	it("deletes a row whose userId differs but whose email matches, ignoring casing", async () => {
		const { storePendingSignup, consumePendingSignup, deleteByUser } = initInMemoryPendingSignup();
		// A pre-userId row is reachable only by email: it was written under a
		// throwaway id (or none), so the userId scrub alone would miss it.
		const staleUser = UserIdSchema.parse("u-stale-checkout-id");
		const targetSession = CheckoutSessionIdSchema.parse("cs_test_del_by_email");
		const otherSession = CheckoutSessionIdSchema.parse("cs_test_del_keep");
		await storePendingSignup({
			checkoutSessionId: targetSession,
			signup: { method: "existing-user-subscribe", email: "Deleted@Example.com", userId: staleUser, entrySource: null, offer: "none" },
			createdAt: 1,
		});
		await storePendingSignup({
			checkoutSessionId: otherSession,
			signup: { method: "existing-user-subscribe", email: "someone-else@example.com", userId: staleUser, entrySource: null, offer: "none" },
			createdAt: 2,
		});

		await deleteByUser({ userId: UserIdSchema.parse("u-real-deleted"), email: "deleted@example.com" });

		expect(await consumePendingSignup(targetSession)).toBeNull();
		const survivor = await consumePendingSignup(otherSession);
		assert(survivor, "an unrelated email must survive");
		expect(survivor.email).toBe("someone-else@example.com");
	});
});
