import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { CheckoutSessionIdSchema } from "../hosted-checkout/hosted-checkout.schema";
import { initInMemoryPendingSignup } from "./in-memory-pending-signup";

function claimFrom(
	claimPendingSignup: ReturnType<typeof initInMemoryPendingSignup>["claimPendingSignup"],
	checkoutSessionId: ReturnType<typeof CheckoutSessionIdSchema.parse>,
) {
	return claimPendingSignup({ checkoutSessionId, activatedBy: "redirect", claimedAt: "2026-11-15T00:00:00.000Z" });
}

describe("initInMemoryPendingSignup", () => {
	it("reads a stored signup as pending until it is claimed, then as already-activated", async () => {
		const { storePendingSignup, findPendingSignup, claimPendingSignup } = initInMemoryPendingSignup();
		const checkoutSessionId = CheckoutSessionIdSchema.parse("cs_test_find");
		const userId = UserIdSchema.parse("u-find");
		await storePendingSignup({
			checkoutSessionId,
			signup: {
				method: "existing-user-subscribe",
				email: "find@example.com",
				userId,
				returnUrl: "/queue",
				entrySource: null,
				offer: "none",
			},
			createdAt: 1735000000,
		});

		const before = await findPendingSignup(checkoutSessionId);
		assert(before.outcome === "pending", "an unclaimed signup reads as pending");
		expect(before.signup.userId).toBe(userId);

		await claimFrom(claimPendingSignup, checkoutSessionId);

		expect(await findPendingSignup(checkoutSessionId)).toEqual({ outcome: "already-activated", returnUrl: "/queue" });
		expect(await findPendingSignup(CheckoutSessionIdSchema.parse("cs_test_unknown"))).toEqual({ outcome: "not-found" });
	});


	it("answers not-found for an unknown checkout session", async () => {
		const { claimPendingSignup } = initInMemoryPendingSignup();
		const claim = await claimFrom(claimPendingSignup, CheckoutSessionIdSchema.parse("cs_test_unknown"));
		expect(claim).toEqual({ outcome: "not-found" });
	});

	it("hands the stored signup to the first claim and answers already-activated with the return URL to every later one", async () => {
		const { storePendingSignup, claimPendingSignup } = initInMemoryPendingSignup();
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

		const first = await claimPendingSignup({ checkoutSessionId, activatedBy: "webhook", claimedAt: "2026-11-15T00:00:00.000Z" });
		assert(first.outcome === "claimed", "first claim should win");
		expect(first.signup.email).toBe("subscriber@example.com");
		expect(first.signup.userId).toBe(userId);
		expect(first.signup.returnUrl).toBe("/save");

		const second = await claimFrom(claimPendingSignup, checkoutSessionId);
		expect(second).toEqual({ outcome: "already-activated", returnUrl: "/save" });
	});

	it("answers already-activated with no return URL when the signup was stored without one", async () => {
		const { storePendingSignup, claimPendingSignup } = initInMemoryPendingSignup();
		const checkoutSessionId = CheckoutSessionIdSchema.parse("cs_test_no_return");
		await storePendingSignup({
			checkoutSessionId,
			signup: {
				method: "existing-user-subscribe",
				email: "no-return@example.com",
				userId: UserIdSchema.parse("u-no-return"),
				entrySource: null,
				offer: "none",
			},
			createdAt: 1735000000,
		});
		await claimFrom(claimPendingSignup, checkoutSessionId);

		expect(await claimFrom(claimPendingSignup, checkoutSessionId)).toEqual({ outcome: "already-activated" });
	});

	it("hands back the entry source and the offer the signup was stored with", async () => {
		const { storePendingSignup, claimPendingSignup } = initInMemoryPendingSignup();
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

		const claim = await claimFrom(claimPendingSignup, checkoutSessionId);
		assert(claim.outcome === "claimed", "claim should return the stored signup");
		expect(claim.signup.entrySource).toBe("keep-panel");
		expect(claim.signup.offer).toBe("first-year-49");
	});

	it("deletes every abandoned-checkout row for a user and leaves other users' rows intact", async () => {
		const { storePendingSignup, claimPendingSignup, deleteByUser } = initInMemoryPendingSignup();
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

		expect(await claimFrom(claimPendingSignup, targetSession)).toEqual({ outcome: "not-found" });
		const survivor = await claimFrom(claimPendingSignup, otherSession);
		assert(survivor.outcome === "claimed", "other user's pending signup must survive");
		expect(survivor.signup.userId).toBe(otherUser);
	});

	it("deletes a row whose userId differs but whose email matches, ignoring casing", async () => {
		const { storePendingSignup, claimPendingSignup, deleteByUser } = initInMemoryPendingSignup();
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

		expect(await claimFrom(claimPendingSignup, targetSession)).toEqual({ outcome: "not-found" });
		const survivor = await claimFrom(claimPendingSignup, otherSession);
		assert(survivor.outcome === "claimed", "an unrelated email must survive");
		expect(survivor.signup.email).toBe("someone-else@example.com");
	});
});
