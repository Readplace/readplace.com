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

	it("deleteSubscription removes the row so the user has no subscription", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await subs.upsertActive({ userId, subscriptionId: "sub_del", customerId: "cus_del" });

		await subs.deleteSubscription({ userId });

		expect(await subs.findByUserId(userId)).toBeUndefined();
		expect(await subs.findBySubscriptionId("sub_del")).toBeUndefined();
	});

	it("deleteSubscription is a no-op for an unknown user", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });

		await subs.deleteSubscription({ userId });

		expect(await subs.findByUserId(userId)).toBeUndefined();
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

	const nextCharge = { at: "2026-08-12T10:00:00.000Z", amountMinor: 4900, currency: "usd" };

	it("setNextCharge stores the renewal on the active row it was read from", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await subs.upsertActive({ userId, subscriptionId: "sub_1", customerId: "cus_1" });

		await subs.setNextCharge({ userId, subscriptionId: "sub_1", nextCharge });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.nextCharge).toEqual(nextCharge);
	});

	it("setNextCharge refuses a subscription id that no longer matches the row — a resubscribe raced it", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await subs.upsertActive({ userId, subscriptionId: "sub_new", customerId: "cus_1" });

		await assert.rejects(
			() => subs.setNextCharge({ userId, subscriptionId: "sub_old", nextCharge }),
			/No active subscription sub_old/,
		);
	});

	it("setNextCharge refuses a row that is no longer active", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });

		await assert.rejects(
			() => subs.setNextCharge({ userId, subscriptionId: "sub_1", nextCharge }),
			/No active subscription sub_1/,
		);
	});

	it("clears a stored renewal when the subscription is cancelled", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await subs.upsertActive({ userId, subscriptionId: "sub_1", customerId: "cus_1" });
		await subs.setNextCharge({ userId, subscriptionId: "sub_1", nextCharge });

		await subs.markCancelledByUserId({ userId });

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.nextCharge).toBeUndefined();
	});

	it("clears a stored renewal when a cancellation is scheduled", async () => {
		const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
		await subs.upsertActive({ userId, subscriptionId: "sub_1", customerId: "cus_1" });
		await subs.setNextCharge({ userId, subscriptionId: "sub_1", nextCharge });

		await subs.markPendingCancellation({
			userId,
			cancellationEffectiveAt: "2026-08-12T10:00:00.000Z",
		});

		const row = await subs.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.nextCharge).toBeUndefined();
	});

	describe("pay-digest claim", () => {
		const trialEndsAt = "2026-06-05T00:00:00.000Z";
		const sendInstant = new Date("2026-06-01T06:00:00.000Z");
		const urls = ["https://example.com/newest", "https://example.com/older"];

		it("claimPayDigest stamps the marker with the send instant, the message and the urls it listed on this trial's row", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt });

			const claim = await subs.claimPayDigest({
				userId,
				trialEndsAt,
				messageId: "msg-pay-1",
				now: sendInstant,
				urls,
			});

			assert.deepEqual(claim, { claimed: true, redelivery: false });
			const row = await subs.findByUserId(userId);
			assert(row, "row must exist");
			assert.equal(row.payDigestEmailSentAt, "2026-06-01T06:00:00.000Z");
			assert.equal(row.payDigestMessageId, "msg-pay-1");
			assert.deepEqual(row.payDigestUrls, urls);
			assert.equal(row.updatedAt, "2026-06-01T06:00:00.000Z");
		});

		it("claimPayDigest reports a redelivery with the original instant when the same message claims again", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt });
			await subs.claimPayDigest({ userId, trialEndsAt, messageId: "msg-pay-1", now: sendInstant, urls });

			const claim = await subs.claimPayDigest({
				userId,
				trialEndsAt,
				messageId: "msg-pay-1",
				now: new Date("2026-06-01T12:00:00.000Z"),
				urls: ["https://example.com/re-selected"],
			});

			assert.deepEqual(claim, { claimed: true, redelivery: true, claimedAt: sendInstant, urls });
			const row = await subs.findByUserId(userId);
			assert(row, "row must exist");
			assert.equal(row.payDigestEmailSentAt, "2026-06-01T06:00:00.000Z");
		});

		it("claimPayDigest refuses a second message once the marker is set", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt });
			await subs.claimPayDigest({ userId, trialEndsAt, messageId: "msg-pay-1", now: sendInstant, urls });

			const claim = await subs.claimPayDigest({
				userId,
				trialEndsAt,
				messageId: "msg-pay-2",
				now: new Date("2026-06-01T12:00:00.000Z"),
				urls,
			});

			assert.deepEqual(claim, { claimed: false });
			const row = await subs.findByUserId(userId);
			assert(row, "row must exist");
			assert.equal(row.payDigestMessageId, "msg-pay-1");
		});

		it("claimPayDigest refuses a trial end the row no longer carries", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-12T00:00:00.000Z" });

			const claim = await subs.claimPayDigest({
				userId,
				trialEndsAt,
				messageId: "msg-pay-1",
				now: sendInstant,
				urls,
			});

			assert.deepEqual(claim, { claimed: false });
			const row = await subs.findByUserId(userId);
			assert(row, "row must exist");
			assert.equal(row.payDigestEmailSentAt, undefined);
		});

		it("claimPayDigest refuses a row that is no longer trialing", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			subs.seedRow({
				userId,
				provider: "stripe",
				status: "pending_cancellation",
				trialEndsAt,
				cancellationEffectiveAt: trialEndsAt,
				createdAt: "2026-05-22T00:00:00.000Z",
				updatedAt: "2026-05-22T00:00:00.000Z",
			});

			const claim = await subs.claimPayDigest({
				userId,
				trialEndsAt,
				messageId: "msg-pay-1",
				now: sendInstant,
				urls,
			});

			assert.deepEqual(claim, { claimed: false });
		});

		it("claimPayDigest refuses a user with no subscription row", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });

			const claim = await subs.claimPayDigest({
				userId,
				trialEndsAt,
				messageId: "msg-pay-1",
				now: sendInstant,
				urls,
			});

			assert.deepEqual(claim, { claimed: false });
			assert.equal(await subs.findByUserId(userId), undefined);
		});

		it("releasePayDigest clears the marker this message holds, so the redrive claims afresh", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt });
			await subs.claimPayDigest({ userId, trialEndsAt, messageId: "msg-pay-1", now: sendInstant, urls });

			await subs.releasePayDigest({ userId, claimedAt: sendInstant, messageId: "msg-pay-1" });

			const row = await subs.findByUserId(userId);
			assert(row, "row must exist");
			assert.equal("payDigestEmailSentAt" in row, false);
			assert.equal("payDigestMessageId" in row, false);
			assert.equal("payDigestUrls" in row, false);
			const reclaim = await subs.claimPayDigest({
				userId,
				trialEndsAt,
				messageId: "msg-pay-1",
				now: new Date("2026-06-01T06:05:00.000Z"),
				urls,
			});
			assert.deepEqual(reclaim, { claimed: true, redelivery: false });
		});

		it("releasePayDigest leaves a marker that another message holds", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt });
			await subs.claimPayDigest({ userId, trialEndsAt, messageId: "msg-pay-2", now: sendInstant, urls });

			await subs.releasePayDigest({ userId, claimedAt: sendInstant, messageId: "msg-pay-1" });

			const row = await subs.findByUserId(userId);
			assert(row, "row must exist");
			assert.equal(row.payDigestMessageId, "msg-pay-2");
		});

		it("releasePayDigest leaves a marker claimed at another instant", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt });
			await subs.claimPayDigest({ userId, trialEndsAt, messageId: "msg-pay-1", now: sendInstant, urls });

			await subs.releasePayDigest({
				userId,
				claimedAt: new Date("2026-06-01T00:00:00.000Z"),
				messageId: "msg-pay-1",
			});

			const row = await subs.findByUserId(userId);
			assert(row, "row must exist");
			assert.equal(row.payDigestEmailSentAt, "2026-06-01T06:00:00.000Z");
		});

		it("releasePayDigest is a no-op for a user with no subscription row", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });

			await subs.releasePayDigest({ userId, claimedAt: sendInstant, messageId: "msg-pay-1" });

			assert.equal(await subs.findByUserId(userId), undefined);
		});

		it("upsertTrialing clears the marker, so a re-opened trial gets its own pay digest", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			await subs.upsertTrialing({ userId, trialEndsAt });
			await subs.claimPayDigest({ userId, trialEndsAt, messageId: "msg-pay-1", now: sendInstant, urls });

			await subs.upsertTrialing({ userId, trialEndsAt: "2026-07-05T00:00:00.000Z" });

			const row = await subs.findByUserId(userId);
			assert(row, "row must exist");
			assert.equal("payDigestEmailSentAt" in row, false);
			assert.equal("payDigestMessageId" in row, false);
			assert.equal("payDigestUrls" in row, false);
		});
	});

	describe("listUserIdsByStatus", () => {
		it("lists only the users whose row holds the status", async () => {
			const subs = initInMemorySubscriptionProviders({ now: fixedNow("2026-05-22T00:00:00.000Z") });
			const secondTrialist = UserIdSchema.parse("u-2");
			const payer = UserIdSchema.parse("u-3");
			await subs.upsertTrialing({ userId, trialEndsAt: "2026-06-05T00:00:00.000Z" });
			await subs.upsertTrialing({ userId: secondTrialist, trialEndsAt: "2026-06-06T00:00:00.000Z" });
			await subs.upsertActive({ userId: payer, subscriptionId: "sub_3", customerId: "cus_3" });

			assert.deepEqual(await subs.listUserIdsByStatus("trialing"), [userId, secondTrialist]);
			assert.deepEqual(await subs.listUserIdsByStatus("active"), [payer]);
			assert.deepEqual(await subs.listUserIdsByStatus("cancelled"), []);
		});
	});
});
