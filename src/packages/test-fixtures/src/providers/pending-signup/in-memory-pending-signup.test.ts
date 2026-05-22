import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { CheckoutSessionIdSchema } from "../stripe-checkout/stripe-checkout.schema";
import { initInMemoryPendingSignup } from "./in-memory-pending-signup";

describe("initInMemoryPendingSignup", () => {
	it("returns null for an unknown checkout session", async () => {
		const { consumePendingSignup } = initInMemoryPendingSignup();
		const result = await consumePendingSignup(CheckoutSessionIdSchema.parse("cs_test_unknown"));
		expect(result).toBeNull();
	});

	it("returns the stored email signup once and then null", async () => {
		const { storePendingSignup, consumePendingSignup } = initInMemoryPendingSignup();
		const checkoutSessionId = CheckoutSessionIdSchema.parse("cs_test_email");
		await storePendingSignup({
			checkoutSessionId,
			signup: { method: "email", email: "buyer@example.com", passwordHash: "hash:hex" },
			createdAt: 1735000000,
		});

		const first = await consumePendingSignup(checkoutSessionId);
		assert(first, "first consume should return the stored signup");
		expect(first.method).toBe("email");
		if (first.method === "email") {
			expect(first.email).toBe("buyer@example.com");
			expect(first.passwordHash).toBe("hash:hex");
		}

		const second = await consumePendingSignup(checkoutSessionId);
		expect(second).toBeNull();
	});

	it("returns the stored google signup once and then null", async () => {
		const { storePendingSignup, consumePendingSignup } = initInMemoryPendingSignup();
		const checkoutSessionId = CheckoutSessionIdSchema.parse("cs_test_google");
		const userId = UserIdSchema.parse("u-google-123");
		await storePendingSignup({
			checkoutSessionId,
			signup: { method: "google", email: "google@example.com", userId, returnUrl: "/save" },
			createdAt: 1735000000,
		});

		const first = await consumePendingSignup(checkoutSessionId);
		assert(first, "first consume should return the stored google signup");
		expect(first.method).toBe("google");
		if (first.method === "google") {
			expect(first.email).toBe("google@example.com");
			expect(first.userId).toBe(userId);
			expect(first.returnUrl).toBe("/save");
		}

		const second = await consumePendingSignup(checkoutSessionId);
		expect(second).toBeNull();
	});

	it("lists all stored signups and reflects markCheckoutRecoveryEmailSent", async () => {
		const {
			storePendingSignup,
			listAllPendingSignups,
			markCheckoutRecoveryEmailSent,
		} = initInMemoryPendingSignup();
		const emailId = CheckoutSessionIdSchema.parse("cs_test_list_email");
		const googleId = CheckoutSessionIdSchema.parse("cs_test_list_google");
		const userId = UserIdSchema.parse("u-list-1");
		await storePendingSignup({
			checkoutSessionId: emailId,
			signup: { method: "email", email: "a@example.com", passwordHash: "hash" },
			createdAt: 1734000000,
		});
		await storePendingSignup({
			checkoutSessionId: googleId,
			signup: { method: "google", email: "b@example.com", userId },
			createdAt: 1734000001,
		});

		const before = await listAllPendingSignups();
		expect(before).toHaveLength(2);
		const emailRow = before.find((r) => r.checkoutSessionId === emailId);
		assert(emailRow, "email row must be present");
		expect(emailRow.email).toBe("a@example.com");
		expect(emailRow.createdAt).toBe(1734000000);
		expect(emailRow.checkoutRecoveryEmailSentAt).toBeUndefined();

		await markCheckoutRecoveryEmailSent({
			checkoutSessionId: emailId,
			sentAt: 1735000000,
		});

		const after = await listAllPendingSignups();
		const emailRowAfter = after.find((r) => r.checkoutSessionId === emailId);
		assert(emailRowAfter, "email row must still be present");
		expect(emailRowAfter.checkoutRecoveryEmailSentAt).toBe(1735000000);
		const googleRowAfter = after.find((r) => r.checkoutSessionId === googleId);
		assert(googleRowAfter, "google row must still be present");
		expect(googleRowAfter.checkoutRecoveryEmailSentAt).toBeUndefined();
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
});
