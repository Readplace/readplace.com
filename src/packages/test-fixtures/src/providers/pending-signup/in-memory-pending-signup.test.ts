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

	it("lists all stored signups and reflects markCheckoutRecoveryEmailSent", async () => {
		const {
			storePendingSignup,
			listAllPendingSignups,
			markCheckoutRecoveryEmailSent,
		} = initInMemoryPendingSignup();
		const firstId = CheckoutSessionIdSchema.parse("cs_test_list_1");
		const secondId = CheckoutSessionIdSchema.parse("cs_test_list_2");
		const firstUserId = UserIdSchema.parse("u-list-1");
		const secondUserId = UserIdSchema.parse("u-list-2");
		await storePendingSignup({
			checkoutSessionId: firstId,
			signup: { method: "existing-user-subscribe", email: "a@example.com", userId: firstUserId },
			createdAt: 1734000000,
		});
		await storePendingSignup({
			checkoutSessionId: secondId,
			signup: { method: "existing-user-subscribe", email: "b@example.com", userId: secondUserId },
			createdAt: 1734000001,
		});

		const before = await listAllPendingSignups();
		expect(before).toHaveLength(2);
		const firstRow = before.find((r) => r.checkoutSessionId === firstId);
		assert(firstRow, "first row must be present");
		expect(firstRow.email).toBe("a@example.com");
		expect(firstRow.createdAt).toBe(1734000000);
		expect(firstRow.checkoutRecoveryEmailSentAt).toBeUndefined();

		await markCheckoutRecoveryEmailSent({
			checkoutSessionId: firstId,
			sentAt: 1735000000,
		});

		const after = await listAllPendingSignups();
		const firstRowAfter = after.find((r) => r.checkoutSessionId === firstId);
		assert(firstRowAfter, "first row must still be present");
		expect(firstRowAfter.checkoutRecoveryEmailSentAt).toBe(1735000000);
		const secondRowAfter = after.find((r) => r.checkoutSessionId === secondId);
		assert(secondRowAfter, "second row must still be present");
		expect(secondRowAfter.checkoutRecoveryEmailSentAt).toBeUndefined();
	});

	it("throws when marking an unknown checkout session as checkout-recovery-email sent", async () => {
		const { markCheckoutRecoveryEmailSent } = initInMemoryPendingSignup();
		await expect(
			markCheckoutRecoveryEmailSent({
				checkoutSessionId: CheckoutSessionIdSchema.parse("cs_test_missing"),
				sentAt: 1,
			}),
		).rejects.toThrow(/No pending signup/);
	});

	it("deletes every abandoned-checkout row for a user and leaves other users' rows intact", async () => {
		const { storePendingSignup, consumePendingSignup, deleteByUser } = initInMemoryPendingSignup();
		const targetUser = UserIdSchema.parse("u-del-target");
		const otherUser = UserIdSchema.parse("u-del-other");
		const targetSession = CheckoutSessionIdSchema.parse("cs_test_del_target");
		const otherSession = CheckoutSessionIdSchema.parse("cs_test_del_other");
		await storePendingSignup({
			checkoutSessionId: targetSession,
			signup: { method: "existing-user-subscribe", email: "t@example.com", userId: targetUser },
			createdAt: 1,
		});
		await storePendingSignup({
			checkoutSessionId: otherSession,
			signup: { method: "existing-user-subscribe", email: "o@example.com", userId: otherUser },
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
			signup: { method: "existing-user-subscribe", email: "Deleted@Example.com", userId: staleUser },
			createdAt: 1,
		});
		await storePendingSignup({
			checkoutSessionId: otherSession,
			signup: { method: "existing-user-subscribe", email: "someone-else@example.com", userId: staleUser },
			createdAt: 2,
		});

		await deleteByUser({ userId: UserIdSchema.parse("u-real-deleted"), email: "deleted@example.com" });

		expect(await consumePendingSignup(targetSession)).toBeNull();
		const survivor = await consumePendingSignup(otherSession);
		assert(survivor, "an unrelated email must survive");
		expect(survivor.email).toBe("someone-else@example.com");
	});
});
