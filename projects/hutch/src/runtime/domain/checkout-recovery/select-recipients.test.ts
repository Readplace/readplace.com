import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
import type { RetrieveCheckoutSession } from "@packages/test-fixtures/providers/stripe-checkout";
import { selectRecipients } from "./select-recipients";

const NOW = new Date("2026-05-03T12:00:00Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function createRetrieve(
	overrides: Partial<{
		paid: boolean;
		customerEmail: string;
		status: "open" | "complete" | "expired";
		ageSeconds: number;
	}>,
): RetrieveCheckoutSession {
	const ageSeconds = overrides.ageSeconds ?? 60 * 60 * 2;
	return async () => ({
		ok: true,
		paid: overrides.paid ?? false,
		customerEmail: overrides.customerEmail ?? "buyer@example.com",
		status: overrides.status ?? "open",
		created: NOW_SECONDS - ageSeconds,
	});
}

describe("selectRecipients", () => {
	it("includes a row whose session is unpaid, open, and older than one hour", async () => {
		const id = CheckoutSessionIdSchema.parse("cs_test_eligible");
		const result = await selectRecipients({
			now: NOW,
			rows: [{ checkoutSessionId: id, email: "buyer@example.com" }],
			retrieveCheckoutSession: createRetrieve({}),
		});

		expect(result.recipients).toEqual([
			{ checkoutSessionId: id, email: "buyer@example.com" },
		]);
		expect(result.skipped).toEqual([]);
	});

	it("includes a row whose session is expired and older than one hour", async () => {
		const id = CheckoutSessionIdSchema.parse("cs_test_expired");
		const result = await selectRecipients({
			now: NOW,
			rows: [{ checkoutSessionId: id, email: "buyer@example.com" }],
			retrieveCheckoutSession: createRetrieve({ status: "expired", ageSeconds: 60 * 60 * 24 }),
		});

		expect(result.recipients).toHaveLength(1);
		expect(result.skipped).toEqual([]);
	});

	it("skips a row that already has checkoutRecoveryEmailSentAt set", async () => {
		const id = CheckoutSessionIdSchema.parse("cs_test_already");
		const result = await selectRecipients({
			now: NOW,
			rows: [
				{
					checkoutSessionId: id,
					email: "already@example.com",
					checkoutRecoveryEmailSentAt: 1234567890,
				},
			],
			retrieveCheckoutSession: async () => {
				throw new Error("Stripe should not be called for already-sent rows");
			},
		});

		expect(result.recipients).toEqual([]);
		expect(result.skipped).toEqual([
			{ checkoutSessionId: id, email: "already@example.com", reason: "already-sent" },
		]);
	});

	it("skips a row whose Stripe session is missing", async () => {
		const id = CheckoutSessionIdSchema.parse("cs_test_missing");
		const result = await selectRecipients({
			now: NOW,
			rows: [{ checkoutSessionId: id, email: "missing@example.com" }],
			retrieveCheckoutSession: async () => ({ ok: false, reason: "not-found" }),
		});

		expect(result.recipients).toEqual([]);
		expect(result.skipped).toEqual([
			{ checkoutSessionId: id, email: "missing@example.com", reason: "session-not-found" },
		]);
	});

	it("skips a row whose Stripe session has been paid (already a founding member)", async () => {
		const id = CheckoutSessionIdSchema.parse("cs_test_paid");
		const result = await selectRecipients({
			now: NOW,
			rows: [{ checkoutSessionId: id, email: "paid@example.com" }],
			retrieveCheckoutSession: createRetrieve({ paid: true, status: "complete" }),
		});

		expect(result.recipients).toEqual([]);
		expect(result.skipped).toEqual([
			{ checkoutSessionId: id, email: "paid@example.com", reason: "already-founding-member" },
		]);
	});

	it("skips a row whose Stripe session was created less than one hour ago", async () => {
		const id = CheckoutSessionIdSchema.parse("cs_test_recent");
		const result = await selectRecipients({
			now: NOW,
			rows: [{ checkoutSessionId: id, email: "recent@example.com" }],
			retrieveCheckoutSession: createRetrieve({ ageSeconds: 60 * 30 }),
		});

		expect(result.recipients).toEqual([]);
		expect(result.skipped).toEqual([
			{ checkoutSessionId: id, email: "recent@example.com", reason: "session-too-recent" },
		]);
	});

	it("partitions a mixed batch into recipients and skipped rows", async () => {
		const eligibleId = CheckoutSessionIdSchema.parse("cs_test_mixed_ok");
		const recentId = CheckoutSessionIdSchema.parse("cs_test_mixed_recent");
		const sentId = CheckoutSessionIdSchema.parse("cs_test_mixed_sent");
		const sessionStates = new Map<string, { paid: boolean; ageSeconds: number }>([
			[eligibleId, { paid: false, ageSeconds: 60 * 60 * 3 }],
			[recentId, { paid: false, ageSeconds: 60 * 10 }],
		]);
		const retrieveCheckoutSession: RetrieveCheckoutSession = async (id) => {
			const state = sessionStates.get(id);
			if (!state) return { ok: false, reason: "not-found" };
			return {
				ok: true,
				paid: state.paid,
				customerEmail: "x@example.com",
				status: "open",
				created: NOW_SECONDS - state.ageSeconds,
			};
		};

		const result = await selectRecipients({
			now: NOW,
			rows: [
				{ checkoutSessionId: eligibleId, email: "ok@example.com" },
				{ checkoutSessionId: recentId, email: "recent@example.com" },
				{
					checkoutSessionId: sentId,
					email: "sent@example.com",
					checkoutRecoveryEmailSentAt: 1,
				},
			],
			retrieveCheckoutSession,
		});

		expect(result.recipients).toEqual([
			{ checkoutSessionId: eligibleId, email: "ok@example.com" },
		]);
		expect(result.skipped).toEqual([
			{
				checkoutSessionId: recentId,
				email: "recent@example.com",
				reason: "session-too-recent",
			},
			{ checkoutSessionId: sentId, email: "sent@example.com", reason: "already-sent" },
		]);
	});
});
