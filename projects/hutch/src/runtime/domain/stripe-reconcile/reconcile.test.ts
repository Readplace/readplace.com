import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { StripeSubscriptionSummary } from "@packages/provider-contracts/subscription-billing";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { formatReconcileReport, maskEmail, reconcile } from "./reconcile";

const NOW = new Date("2026-07-05T00:00:00.000Z");

function appRow(overrides: Partial<SubscriptionRecord>): SubscriptionRecord {
	return {
		userId: UserIdSchema.parse("usr_default"),
		provider: "stripe",
		status: "active",
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-01T00:00:00.000Z",
		...overrides,
	};
}

function stripeSub(overrides: Partial<StripeSubscriptionSummary>): StripeSubscriptionSummary {
	return {
		subscriptionId: "sub_default",
		customerId: "cus_default",
		status: "active",
		...overrides,
	};
}

describe("maskEmail", () => {
	it("masks a normal email to first-letter-only local and domain", () => {
		assert.equal(maskEmail("jessika@gmail.com"), "j***@g***");
	});

	it("returns *** when there is no @", () => {
		assert.equal(maskEmail("nodomain"), "***");
	});

	it("returns *** when the local part is empty", () => {
		assert.equal(maskEmail("@gmail.com"), "***");
	});

	it("returns *** when the domain part is empty", () => {
		assert.equal(maskEmail("jessika@"), "***");
	});
});

describe("reconcile", () => {
	it("flags a Stripe sub with no app row and masks its customer email", () => {
		const findings = reconcile({
			now: NOW,
			appRows: [],
			stripeSubs: [
				stripeSub({
					subscriptionId: "sub_orphan",
					customerId: "cus_orphan",
					status: "incomplete_expired",
					customerEmail: "jessika@gmail.com",
				}),
			],
		});
		assert.equal(findings.stripeSubsMissingAppRow.length, 1);
		assert.deepEqual(findings.stripeSubsMissingAppRow[0], {
			subscriptionId: "sub_orphan",
			customerId: "cus_orphan",
			stripeStatus: "incomplete_expired",
			maskedCustomerEmail: "j***@g***",
		});
	});

	it("omits maskedCustomerEmail when the Stripe sub has no customer email", () => {
		const findings = reconcile({
			now: NOW,
			appRows: [],
			stripeSubs: [stripeSub({ subscriptionId: "sub_no_email" })],
		});
		assert.equal(findings.stripeSubsMissingAppRow.length, 1);
		assert.equal(findings.stripeSubsMissingAppRow[0].maskedCustomerEmail, undefined);
	});

	it("produces no findings for an active app row matched to a live Stripe sub", () => {
		const findings = reconcile({
			now: NOW,
			appRows: [appRow({ subscriptionId: "sub_ok", customerId: "cus_ok", status: "active" })],
			stripeSubs: [stripeSub({ subscriptionId: "sub_ok", customerId: "cus_ok", status: "active" })],
		});
		assert.equal(findings.stripeSubsMissingAppRow.length, 0);
		assert.equal(findings.liveAppRowsMissingLiveStripeSub.length, 0);
		assert.equal(findings.liveStripeSubsWithCancelledAppRow.length, 0);
		assert.equal(findings.trialingRowsPastTrialEnd.length, 0);
		assert.equal(findings.rowsMissingSubscriptionId.length, 0);
	});

	it("flags an active row with no subscriptionId in both liveAppRowsMissingLiveStripeSub and rowsMissingSubscriptionId", () => {
		const userId = UserIdSchema.parse("usr_no_sub");
		const findings = reconcile({
			now: NOW,
			appRows: [appRow({ userId, status: "active", subscriptionId: undefined })],
			stripeSubs: [],
		});
		assert.equal(findings.liveAppRowsMissingLiveStripeSub.length, 1);
		assert.deepEqual(findings.liveAppRowsMissingLiveStripeSub[0], {
			userId,
			status: "active",
		});
		assert.equal(findings.rowsMissingSubscriptionId.length, 1);
		assert.deepEqual(findings.rowsMissingSubscriptionId[0], { userId, status: "active" });
	});

	it("flags an active row whose Stripe sub is canceled as missing a live Stripe sub", () => {
		const userId = UserIdSchema.parse("usr_dead_sub");
		const findings = reconcile({
			now: NOW,
			appRows: [appRow({ userId, status: "active", subscriptionId: "sub_dead" })],
			stripeSubs: [stripeSub({ subscriptionId: "sub_dead", status: "canceled" })],
		});
		assert.equal(findings.liveAppRowsMissingLiveStripeSub.length, 1);
		assert.deepEqual(findings.liveAppRowsMissingLiveStripeSub[0], {
			userId,
			status: "active",
			subscriptionId: "sub_dead",
		});
	});

	it("flags a live Stripe sub whose app row is cancelled (paying customer without entitlement)", () => {
		const userId = UserIdSchema.parse("usr_unentitled");
		const findings = reconcile({
			now: NOW,
			appRows: [appRow({ userId, status: "cancelled", subscriptionId: "sub_live" })],
			stripeSubs: [stripeSub({ subscriptionId: "sub_live", status: "active" })],
		});
		assert.equal(findings.liveStripeSubsWithCancelledAppRow.length, 1);
		assert.deepEqual(findings.liveStripeSubsWithCancelledAppRow[0], {
			subscriptionId: "sub_live",
			userId,
			appStatus: "cancelled",
			stripeStatus: "active",
		});
	});

	it("flags trialing rows with a past or absent trialEndsAt but not a future one", () => {
		const past = UserIdSchema.parse("usr_past");
		const future = UserIdSchema.parse("usr_future");
		const noEnd = UserIdSchema.parse("usr_no_end");
		const findings = reconcile({
			now: NOW,
			appRows: [
				appRow({ userId: past, status: "trialing", trialEndsAt: "2026-06-01T00:00:00.000Z" }),
				appRow({ userId: future, status: "trialing", trialEndsAt: "2026-08-01T00:00:00.000Z" }),
				appRow({ userId: noEnd, status: "trialing", trialEndsAt: undefined }),
			],
			stripeSubs: [],
		});
		const flagged = findings.trialingRowsPastTrialEnd.map((f) => f.userId);
		assert.deepEqual(flagged.sort(), [past, noEnd].sort());
		const pastEntry = findings.trialingRowsPastTrialEnd.find((f) => f.userId === past);
		assert.equal(pastEntry?.trialEndsAt, "2026-06-01T00:00:00.000Z");
		const noEndEntry = findings.trialingRowsPastTrialEnd.find((f) => f.userId === noEnd);
		assert.equal(noEndEntry?.trialEndsAt, undefined);
	});

	it("puts a trialing row without subscriptionId in rowsMissingSubscriptionId but NOT liveAppRowsMissingLiveStripeSub", () => {
		const userId = UserIdSchema.parse("usr_trial");
		const findings = reconcile({
			now: NOW,
			appRows: [
				appRow({
					userId,
					status: "trialing",
					subscriptionId: undefined,
					trialEndsAt: "2026-08-01T00:00:00.000Z",
				}),
			],
			stripeSubs: [],
		});
		assert.equal(findings.liveAppRowsMissingLiveStripeSub.length, 0);
		assert.equal(findings.rowsMissingSubscriptionId.length, 1);
		assert.deepEqual(findings.rowsMissingSubscriptionId[0], { userId, status: "trialing" });
	});
});

describe("formatReconcileReport", () => {
	it("emits a header, per-entry lines with masked emails, and a summary — never a raw email", () => {
		const findings = reconcile({
			now: NOW,
			appRows: [
				appRow({
					userId: UserIdSchema.parse("usr_active_nosub"),
					status: "active",
					subscriptionId: undefined,
				}),
				appRow({
					userId: UserIdSchema.parse("usr_active_dead"),
					status: "active",
					subscriptionId: "sub_dead",
				}),
				appRow({
					userId: UserIdSchema.parse("usr_cancelled"),
					status: "cancelled",
					subscriptionId: "sub_live",
				}),
				appRow({
					userId: UserIdSchema.parse("usr_trial_stuck"),
					status: "trialing",
					subscriptionId: undefined,
					trialEndsAt: "2026-06-01T00:00:00.000Z",
				}),
			],
			stripeSubs: [
				stripeSub({
					subscriptionId: "sub_orphan",
					status: "incomplete_expired",
					customerEmail: "jessika@gmail.com",
				}),
				stripeSub({ subscriptionId: "sub_orphan2", status: "canceled" }),
				stripeSub({ subscriptionId: "sub_dead", status: "canceled" }),
				stripeSub({ subscriptionId: "sub_live", status: "active" }),
			],
		});

		const lines = formatReconcileReport(findings);

		assert.equal(lines[0], "[stripe-reconcile] report (read-only, no writes)");
		for (const line of lines) {
			assert.ok(!line.includes("jessika@"), `raw email leaked in: ${line}`);
		}
		assert.ok(lines.some((l) => l.includes("email=j***@g***")));
		assert.ok(lines.some((l) => l.includes("email=(none)")));
		assert.ok(lines.some((l) => l.includes("subscriptionId=(none)")));
		assert.ok(lines.some((l) => l.includes("subscriptionId=sub_dead")));
		assert.ok(lines.some((l) => l.includes("trialEndsAt=2026-06-01T00:00:00.000Z")));
		const summary = lines[lines.length - 1];
		assert.ok(summary.includes("stripeSubsMissingAppRow=2"));
		assert.ok(summary.includes("liveAppRowsMissingLiveStripeSub=2"));
		assert.ok(summary.includes("liveStripeSubsWithCancelledAppRow=1"));
		assert.ok(summary.includes("trialingRowsPastTrialEnd=1"));
		assert.ok(summary.includes("rowsMissingSubscriptionId=2"));
	});

	it("renders (none) for an absent trialEndsAt in the report", () => {
		const findings = reconcile({
			now: NOW,
			appRows: [
				appRow({
					userId: UserIdSchema.parse("usr_no_end"),
					status: "trialing",
					subscriptionId: undefined,
					trialEndsAt: undefined,
				}),
			],
			stripeSubs: [],
		});
		const lines = formatReconcileReport(findings);
		assert.ok(lines.some((l) => l.includes("trialEndsAt=(none)")));
	});
});
