import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS } from "../../../domain/stripe/stripe-trial-config";
import { type PlansPageViewModel, toPlansPageOutcome } from "./plans-page.view-model";

const TRIAL_ENDS_AT = "2026-10-05T03:00:00.000Z";
const CUTOFF = "2026-10-03T02:55:00.000Z";

function row(overrides: Partial<SubscriptionRecord> & Pick<SubscriptionRecord, "status">): SubscriptionRecord {
	return {
		userId: UserIdSchema.parse("plans-reader"),
		provider: "stripe",
		createdAt: "2026-09-21T03:00:00.000Z",
		updatedAt: "2026-09-21T03:00:00.000Z",
		...overrides,
	};
}

function rendered(outcome: ReturnType<typeof toPlansPageOutcome>): PlansPageViewModel {
	assert(outcome.kind === "render", "the plans page must render for this row");
	return outcome.viewModel;
}

function termsText(viewModel: PlansPageViewModel): string {
	return `${viewModel.termsNote.parts.map((part) => `${part.lead}${part.time.label}`).join("")}${viewModel.termsNote.tail}`;
}

describe("toPlansPageOutcome", () => {
	describe("a trialing reader with at least the checkout lead left", () => {
		const trialing = row({ status: "trialing", trialEndsAt: TRIAL_ENDS_AT });

		it("promises no charge until the trial ends, as long as a plan is chosen before the cutoff", () => {
			const viewModel = rendered(
				toPlansPageOutcome({ branch: "trialing", row: trialing, now: new Date("2026-10-01T09:00:00.000Z") }),
			);

			assert.equal(viewModel.terms, "trial_preserved");
			assert.equal(viewModel.tier, "trial");
			assert.equal(
				termsText(viewModel),
				"Choose before Oct 3, 2026, 02:55 UTC and nothing is charged until Oct 5, 2026, 03:00 UTC. Cancel any time before then.",
			);
		});

		it("hands the page the cutoff instant and the trial end as local times the browser can re-render in its own zone", () => {
			const viewModel = rendered(
				toPlansPageOutcome({ branch: "trialing", row: trialing, now: new Date("2026-10-01T09:00:00.000Z") }),
			);

			assert.deepEqual(
				viewModel.termsNote.parts.map((part) => ({ iso: part.time.iso, mode: part.time.mode })),
				[
					{ iso: CUTOFF, mode: "datetime" },
					{ iso: TRIAL_ENDS_AT, mode: "datetime" },
				],
			);
		});

		it("still keeps the trial at exactly the lead, because the checkout does too", () => {
			const atTheLead = new Date(Date.parse(TRIAL_ENDS_AT) - STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS);

			const viewModel = rendered(toPlansPageOutcome({ branch: "trialing", row: trialing, now: atTheLead }));

			assert.equal(viewModel.terms, "trial_preserved");
		});
	});

	describe("a trialing reader inside the checkout lead", () => {
		it("says the first charge is today, since the checkout can no longer keep the trial", () => {
			const insideTheLead = new Date(Date.parse(TRIAL_ENDS_AT) - STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS + 1);

			const viewModel = rendered(
				toPlansPageOutcome({
					branch: "trialing",
					row: row({ status: "trialing", trialEndsAt: TRIAL_ENDS_AT }),
					now: insideTheLead,
				}),
			);

			assert.equal(viewModel.terms, "charge_today");
			assert.equal(viewModel.tier, "trial");
			assert.equal(termsText(viewModel), "Your first charge is today.");
		});
	});

	describe("a trialing reader whose trial has already ended", () => {
		it("says the first charge is today and reports the reader as inactive", () => {
			const viewModel = rendered(
				toPlansPageOutcome({
					branch: "trialing",
					row: row({ status: "trialing", trialEndsAt: TRIAL_ENDS_AT }),
					now: new Date("2026-10-06T00:00:00.000Z"),
				}),
			);

			assert.equal(viewModel.terms, "charge_today");
			assert.equal(viewModel.tier, "inactive");
			assert.equal(termsText(viewModel), "Your first charge is today.");
		});
	});

	describe("a cancelled reader", () => {
		it("warns that the card on file is charged today when Readplace still holds one", () => {
			const viewModel = rendered(
				toPlansPageOutcome({
					branch: "cancelled",
					row: row({ status: "cancelled", customerId: "cus_on_file" }),
					now: new Date("2026-10-01T09:00:00.000Z"),
				}),
			);

			assert.equal(viewModel.terms, "charge_today");
			assert.equal(viewModel.tier, "inactive");
			assert.equal(termsText(viewModel), "Choosing a plan charges your card on file today.");
		});

		it("says the first charge is today when there is no card on file, since the plan goes through checkout", () => {
			const viewModel = rendered(
				toPlansPageOutcome({
					branch: "cancelled",
					row: row({ status: "cancelled" }),
					now: new Date("2026-10-01T09:00:00.000Z"),
				}),
			);

			assert.equal(viewModel.terms, "charge_today");
			assert.equal(termsText(viewModel), "Your first charge is today.");
		});
	});

	describe("a reader with nothing to choose", () => {
		it("sends an active or cancel-pending subscriber to the account page", () => {
			const outcome = toPlansPageOutcome({
				branch: "noop",
				row: row({ status: "active" }),
				now: new Date("2026-10-01T09:00:00.000Z"),
			});

			assert.deepEqual(outcome, { kind: "redirect-to-account" });
		});

		it("sends a founding member, who has no subscription row, to the account page", () => {
			const outcome = toPlansPageOutcome({
				branch: "forbidden",
				row: undefined,
				now: new Date("2026-10-01T09:00:00.000Z"),
			});

			assert.deepEqual(outcome, { kind: "redirect-to-account" });
		});
	});
});
