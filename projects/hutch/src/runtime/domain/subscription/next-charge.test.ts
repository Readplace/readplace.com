import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { SubscriptionNextCharge } from "@packages/provider-contracts/subscription-billing";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { initLoadNextCharge } from "./next-charge";

const USER_ID = UserIdSchema.parse("usr_test_abc123");
const NOW = new Date("2026-07-14T12:00:00.000Z");

const IN_A_WEEK: SubscriptionNextCharge = {
	at: "2026-07-21T12:00:00.000Z",
	amountMinor: 4900,
	currency: "usd",
};

function activeRow(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: USER_ID,
		provider: "stripe",
		status: "active",
		subscriptionId: "sub_live",
		customerId: "cus_live",
		createdAt: "2025-07-14T12:00:00.000Z",
		updatedAt: "2025-07-14T12:00:00.000Z",
		...overrides,
	};
}

function harness(input: {
	found?: SubscriptionNextCharge | undefined;
	lookupThrows?: boolean;
	lookupThrowsNonError?: boolean;
	persistThrows?: boolean;
}) {
	const lookups: string[] = [];
	const persisted: { userId: string; subscriptionId: string; nextCharge: SubscriptionNextCharge }[] =
		[];
	const errors: string[] = [];

	const loadNextCharge = initLoadNextCharge({
		findSubscriptionNextCharge: async ({ subscriptionId }) => {
			lookups.push(subscriptionId);
			if (input.lookupThrowsNonError) throw "stripe is down";
			if (input.lookupThrows) throw new Error("stripe is down");
			return input.found;
		},
		setSubscriptionNextCharge: async (write) => {
			if (input.persistThrows) throw new Error("conditional check failed");
			persisted.push(write);
		},
		logger: HutchLogger.from({
			...noopLogger,
			error: (message) => errors.push(String(message)),
		}),
		now: () => NOW,
	});

	return { loadNextCharge, lookups, persisted, errors };
}

describe("initLoadNextCharge", () => {
	it("serves a charge that is still in the future without asking the provider", async () => {
		const { loadNextCharge, lookups } = harness({});

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow({ nextCharge: IN_A_WEEK }),
			suppressed: false,
		});

		assert.deepEqual(charge, IN_A_WEEK);
		assert.deepEqual(lookups, []);
	});

	it("fetches and stores the charge the first time it is asked for", async () => {
		const { loadNextCharge, lookups, persisted } = harness({ found: IN_A_WEEK });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow(),
			suppressed: false,
		});

		assert.deepEqual(charge, IN_A_WEEK);
		assert.deepEqual(lookups, ["sub_live"]);
		assert.deepEqual(persisted, [
			{ userId: USER_ID, subscriptionId: "sub_live", nextCharge: IN_A_WEEK },
		]);
	});

	it("refetches once the stored charge has passed — the renewal already happened", async () => {
		const { loadNextCharge, lookups } = harness({ found: IN_A_WEEK });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow({
				nextCharge: { at: "2026-07-13T12:00:00.000Z", amountMinor: 4900, currency: "usd" },
			}),
			suppressed: false,
		});

		assert.deepEqual(charge, IN_A_WEEK);
		assert.deepEqual(lookups, ["sub_live"]);
	});

	it("treats a charge due exactly now as spent, not as still to come", async () => {
		const { loadNextCharge, lookups } = harness({ found: IN_A_WEEK });

		await loadNextCharge({
			userId: USER_ID,
			row: activeRow({
				nextCharge: { at: NOW.toISOString(), amountMinor: 4900, currency: "usd" },
			}),
			suppressed: false,
		});

		assert.deepEqual(lookups, ["sub_live"]);
	});

	it("refetches when the stored charge date is unreadable", async () => {
		const { loadNextCharge, lookups } = harness({ found: IN_A_WEEK });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow({
				nextCharge: { at: "not-a-date", amountMinor: 4900, currency: "usd" },
			}),
			suppressed: false,
		});

		assert.deepEqual(charge, IN_A_WEEK);
		assert.deepEqual(lookups, ["sub_live"]);
	});

	it("says nothing when the provider has no charge to report", async () => {
		const { loadNextCharge, persisted } = harness({ found: undefined });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow(),
			suppressed: false,
		});

		assert.equal(charge, undefined);
		assert.deepEqual(persisted, []);
	});

	it("swallows a provider outage and logs it — a renewal date must never cost the reader the page", async () => {
		const { loadNextCharge, persisted, errors } = harness({ lookupThrows: true });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow(),
			suppressed: false,
		});

		assert.equal(charge, undefined);
		assert.deepEqual(persisted, []);
		assert.deepEqual(errors, ["[account/next-charge] live read failed"]);
	});

	it("swallows a non-Error thrown by the provider", async () => {
		const { loadNextCharge, errors } = harness({ lookupThrowsNonError: true });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow(),
			suppressed: false,
		});

		assert.equal(charge, undefined);
		assert.deepEqual(errors, ["[account/next-charge] live read failed"]);
	});

	it("swallows a rejected write — the row moved on while we were asking", async () => {
		const { loadNextCharge, errors } = harness({ found: IN_A_WEEK, persistThrows: true });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow(),
			suppressed: false,
		});

		assert.equal(charge, undefined);
		assert.deepEqual(errors, ["[account/next-charge] live read failed"]);
	});

	it("asks nothing of a reader with no subscription row", async () => {
		const { loadNextCharge, lookups } = harness({ found: IN_A_WEEK });

		const charge = await loadNextCharge({ userId: USER_ID, row: undefined, suppressed: false });

		assert.equal(charge, undefined);
		assert.deepEqual(lookups, []);
	});

	it("asks nothing while the reader is on trial, cancelling, or gone", async () => {
		for (const status of ["trialing", "pending_cancellation", "cancelled"] as const) {
			const { loadNextCharge, lookups } = harness({ found: IN_A_WEEK });

			const charge = await loadNextCharge({
				userId: USER_ID,
				row: activeRow({ status }),
				suppressed: false,
			});

			assert.equal(charge, undefined, `${status} must not report a renewal`);
			assert.deepEqual(lookups, [], `${status} must not reach the provider`);
		}
	});

	it("asks nothing of an active row that carries no subscription id", async () => {
		const { loadNextCharge, lookups } = harness({ found: IN_A_WEEK });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow({ subscriptionId: undefined }),
			suppressed: false,
		});

		assert.equal(charge, undefined);
		assert.deepEqual(lookups, []);
	});

	it("asks nothing when the caller suppresses the lookup", async () => {
		const { loadNextCharge, lookups } = harness({ found: IN_A_WEEK });

		const charge = await loadNextCharge({
			userId: USER_ID,
			row: activeRow({ nextCharge: IN_A_WEEK }),
			suppressed: true,
		});

		assert.equal(charge, undefined);
		assert.deepEqual(lookups, []);
	});
});
