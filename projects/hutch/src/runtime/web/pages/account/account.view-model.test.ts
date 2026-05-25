import assert from "node:assert/strict";
import { toAccountViewModel, parseAccountQuery } from "./account.view-model";
import type { EffectiveAccess } from "../../../domain/access/effective-access";
import type { SubscriptionRecord } from "@packages/test-fixtures/providers/subscription-providers";
import { UserIdSchema } from "@packages/domain/user";

const ONE_DAY_MS = 86_400_000;
const USER_ID = UserIdSchema.parse("u".repeat(32));

function rowWithCard(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: USER_ID,
		provider: "stripe",
		status: "active",
		customerId: "cus_x",
		paymentMethodId: "pm_x",
		paymentMethodBrand: "visa",
		paymentMethodLast4: "4242",
		createdAt: "2026-05-01T00:00:00.000Z",
		updatedAt: "2026-05-01T00:00:00.000Z",
		...overrides,
	};
}

describe("toAccountViewModel — state", () => {
	it("shows singular 'day' when trial ends in less than 24 hours", () => {
		const now = new Date("2026-05-23T12:00:00Z");
		const trialEndsAt = new Date("2026-05-24T00:00:00Z").toISOString();
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const vm = toAccountViewModel(
			access,
			{ cancelling: false, errorPaymentMethod: false },
			now,
		);
		assert.equal(vm.trialDaysLeft, 1);
		assert.equal(vm.trialDaysLeftWord, "day");
	});

	it("shows zero-remainder day boundary correctly", () => {
		const now = new Date("2026-05-23T00:00:00.000Z");
		const trialEndsAt = new Date("2026-05-24T00:00:00.000Z").toISOString();
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const vm = toAccountViewModel(
			access,
			{ cancelling: false, errorPaymentMethod: false },
			now,
		);
		assert.equal(vm.trialDaysLeft, 1);
		assert.equal(vm.trialDaysLeftWord, "day");
	});
});

describe("toAccountViewModel — actions", () => {
	const now = new Date();
	const baseQuery = { cancelling: false, errorPaymentMethod: false };

	it("founding members get no actions", () => {
		const vm = toAccountViewModel(
			{ tier: "founding", access: "full", banner: "none" },
			baseQuery,
			now,
		);
		assert.deepEqual(vm.actions, []);
	});

	it("active paid users without a card get add-payment-method + cancel-form actions", () => {
		const vm = toAccountViewModel(
			{ tier: "paid", access: "full", banner: "none" },
			baseQuery,
			now,
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["add-payment-method", "cancel-form"]);
		const cancel = vm.actions.find((a) => a.key === "cancel-form");
		assert(cancel);
		assert.equal(cancel.variant, "destructive");
		assert.equal(cancel.method, "POST");
		assert.equal(cancel.href, "/account/cancel");
	});

	it("active paid users with a card on file get update-payment-method + cancel-form", () => {
		const vm = toAccountViewModel(
			{ tier: "paid", access: "full", banner: "none" },
			baseQuery,
			now,
			rowWithCard({ status: "active" }),
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["update-payment-method", "cancel-form"]);
		assert(vm.paymentMethod);
		assert.equal(vm.paymentMethod.brand, "visa");
		assert.equal(vm.paymentMethod.last4, "4242");
		assert.match(vm.statusLine, /visa ••••4242/);
	});

	it("active paid users with cancelling=1 get no actions — the Cancel command is already in flight", () => {
		const vm = toAccountViewModel(
			{ tier: "paid", access: "full", banner: "none" },
			{ ...baseQuery, cancelling: true },
			now,
		);
		assert.deepEqual(vm.actions, []);
		assert.equal(vm.showCancellingNotice, true);
	});

	it("trial users without a card get a single add-payment-method action", () => {
		const trialEndsAt = new Date(now.getTime() + 5 * ONE_DAY_MS).toISOString();
		const vm = toAccountViewModel(
			{ tier: "trial", access: "full", banner: "trial-countdown", trialEndsAt },
			baseQuery,
			now,
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["add-payment-method"]);
		assert.equal(vm.actions[0].variant, "primary");
		assert.equal(vm.actions[0].method, "POST");
		assert.equal(vm.actions[0].href, "/account/payment-method");
		assert.match(vm.statusLine, /Add a card/);
	});

	it("trial users with a card get update-payment-method + cancel-form and a 'will be charged' statusLine", () => {
		const trialEndsAt = new Date(now.getTime() + 5 * ONE_DAY_MS).toISOString();
		const vm = toAccountViewModel(
			{ tier: "trial", access: "full", banner: "trial-countdown", trialEndsAt },
			baseQuery,
			now,
			rowWithCard({ status: "trialing", trialEndsAt }),
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["update-payment-method", "cancel-form"]);
		assert.match(vm.statusLine, /Will be charged \$3\.99/);
	});

	it("inactive users without a card get a single add-payment-method action", () => {
		const vm = toAccountViewModel(
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "trial-expired" },
			baseQuery,
			now,
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["add-payment-method"]);
		assert.equal(vm.actions[0].variant, "primary");
	});

	it("inactive users with a card on file get update-payment-method instead", () => {
		const vm = toAccountViewModel(
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "subscription-cancelled" },
			baseQuery,
			now,
			rowWithCard({ status: "cancelled" }),
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["update-payment-method"]);
	});

	it("error-payment-method state exposes no actions (support email lives in the body copy)", () => {
		const vm = toAccountViewModel(
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "subscription-cancelled" },
			{ ...baseQuery, errorPaymentMethod: true },
			now,
		);
		assert.deepEqual(vm.actions, []);
	});

	it("paid cancellation-scheduled state — single Reactivate action (no Cancel — the user already cancelled), status line carries the cutoff date", () => {
		const cancellationEffectiveAt = "2026-06-22T10:00:00.000Z";
		const vm = toAccountViewModel(
			{
				tier: "paid",
				access: "full",
				banner: "cancellation-scheduled",
				cancellationEffectiveAt,
			},
			baseQuery,
			now,
		);

		assert.equal(vm.state, "cancellation-scheduled");
		assert.equal(vm.stateClass, "account-card account-card--cancellation-scheduled");
		assert.equal(vm.statusLine, `Your subscription ends on ${new Date("2026-06-22T10:00:00.000Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}.`);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["reactivate-form"]);
		assert.equal(vm.actions[0].variant, "primary");
		assert.equal(vm.actions[0].method, "POST");
		assert.equal(vm.actions[0].href, "/account/reactivate");
	});

	it("trial cancellation-scheduled state — same shape as paid (reactivate-form, Reactivate label) so the template stays branchless", () => {
		const cancellationEffectiveAt = "2026-06-05T00:00:00.000Z";
		const vm = toAccountViewModel(
			{
				tier: "trial",
				access: "full",
				banner: "cancellation-scheduled",
				cancellationEffectiveAt,
			},
			baseQuery,
			now,
		);

		assert.equal(vm.state, "cancellation-scheduled");
		assert.equal(vm.statusLine, `Your subscription ends on ${new Date("2026-06-05T00:00:00.000Z").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}.`);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["reactivate-form"]);
	});

	it("rows with chargeFailedAt expose a chargeFailed summary for the warning banner", () => {
		const vm = toAccountViewModel(
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "subscription-cancelled" },
			baseQuery,
			now,
			rowWithCard({
				status: "cancelled",
				chargeFailedAt: "2026-05-01T00:00:00.000Z",
				chargeFailedReason: "card_declined",
			}),
		);
		assert(vm.chargeFailed);
		assert.equal(vm.chargeFailed.reason, "card_declined");
	});

	it("rows with chargeFailedAt but missing chargeFailedReason default the reason to card_declined", () => {
		const vm = toAccountViewModel(
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "subscription-cancelled" },
			baseQuery,
			now,
			rowWithCard({
				status: "cancelled",
				chargeFailedAt: "2026-05-01T00:00:00.000Z",
			}),
		);
		assert(vm.chargeFailed);
		assert.equal(vm.chargeFailed.reason, "card_declined");
	});
});

describe("parseAccountQuery", () => {
	it("returns defaults for undefined query", () => {
		const result = parseAccountQuery(undefined);
		assert.deepEqual(result, {
			cancelling: false,
			errorPaymentMethod: false,
		});
	});
});
