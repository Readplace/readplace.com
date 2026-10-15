import assert from "node:assert/strict";
import { DisplayNameSchema } from "@packages/domain/user";
import { PaymentMethodIdSchema } from "@packages/provider-contracts/payment-methods";
import type { SavedCard } from "@packages/provider-contracts/payment-methods";
import type { EffectiveAccess } from "@packages/subscription-access";
import {
	ACCOUNT_CANCEL_MAX_POLLS,
	type AccountUrlState,
	buildAppearanceSection,
	buildPaymentSectionViewModel,
	buildProfileSection,
	buildSecuritySection,
	toAccountViewModel,
	parseAccountQuery,
	withoutCommerce,
} from "./account.view-model";

function savedCard(id: string, isPrimary: boolean, overrides?: Partial<SavedCard>): SavedCard {
	return {
		id: PaymentMethodIdSchema.parse(id),
		brand: "visa",
		last4: "4242",
		expMonth: 12,
		expYear: 2030,
		isPrimary,
		...overrides,
	};
}

const ONE_DAY_MS = 86_400_000;

const BASE_QUERY: AccountUrlState = {
	cancelling: false,
	pollCount: 0,
	errorPaymentMethod: false,
	errorSubscribeFailed: false,
	deleteConfirmationError: false,
	passwordChanged: false,
	cardError: undefined,
	manage: undefined,
};

const ACTIVE: EffectiveAccess = { tier: "paid", access: "full", banner: "none" };
const FOUNDING: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
const INACTIVE: EffectiveAccess = {
	tier: "inactive",
	access: "read-only",
	banner: "inactive",
	reason: "trial-expired",
};

function trialEndingIn(days: number, now: Date): EffectiveAccess {
	return {
		tier: "trial",
		access: "full",
		banner: "trial-countdown",
		trialEndsAt: new Date(now.getTime() + days * ONE_DAY_MS).toISOString(),
	};
}

function cancellationScheduledAt(cancellationEffectiveAt: string): EffectiveAccess {
	return { tier: "paid", access: "full", banner: "cancellation-scheduled", cancellationEffectiveAt };
}

function accountVm(
	input: Partial<Parameters<typeof toAccountViewModel>[0]> & { access: EffectiveAccess },
) {
	return toAccountViewModel({
		queryState: BASE_QUERY,
		now: new Date("2026-07-14T12:00:00.000Z"),
		nextCharge: undefined,
		plan: undefined,
		hasCustomer: false,
		payment: { kind: "no-customer" },
		...input,
	});
}

describe("toAccountViewModel — state", () => {
	it("shows singular 'day' when trial ends in less than 24 hours", () => {
		const now = new Date("2026-05-23T12:00:00Z");
		const trialEndsAt = new Date("2026-05-24T00:00:00Z").toISOString();
		const vm = accountVm({
			access: { tier: "trial", access: "full", banner: "trial-countdown", trialEndsAt },
			now,
		});
		assert.equal(vm.statusLine, "Your free trial ends on ");
		assert.deepEqual(vm.statusDate, {
			iso: trialEndsAt,
			label: "May 24, 2026",
			mode: "date",
		});
		assert.equal(vm.statusDateTail, " — 1 day left.");
	});

	it("shows zero-remainder day boundary correctly", () => {
		const now = new Date("2026-05-23T00:00:00.000Z");
		const trialEndsAt = new Date("2026-05-24T00:00:00.000Z").toISOString();
		const vm = accountVm({
			access: { tier: "trial", access: "full", banner: "trial-countdown", trialEndsAt },
			now,
		});
		assert.equal(vm.statusDateTail, " — 1 day left.");
	});
});

describe("toAccountViewModel — next charge", () => {
	const now = new Date("2026-07-14T12:00:00.000Z");
	const chargeSoon = {
		at: new Date(now.getTime() + 10 * ONE_DAY_MS).toISOString(),
		amountMinor: 4900,
		currency: "usd",
	};

	it("shows the next payment on an active subscription", () => {
		const vm = accountVm({ access: ACTIVE, now, nextCharge: chargeSoon });
		assert.equal(vm.nextCharge.state, "visible");
		assert.equal(vm.nextCharge.leadIn, "Next payment on ");
		assert.equal(vm.nextCharge.tail, " — $49.00.");
	});

	it("hides the next payment when no charge is known", () => {
		const vm = accountVm({ access: ACTIVE, now, nextCharge: undefined });
		assert.equal(vm.nextCharge.state, "hidden");
	});

	it("hides the next payment while a cancellation is in flight", () => {
		const vm = accountVm({
			access: ACTIVE,
			queryState: { ...BASE_QUERY, cancelling: true },
			now,
			nextCharge: chargeSoon,
		});
		assert.equal(vm.nextCharge.state, "hidden");
	});

	it("ignores a charge handed to any non-active state — only the active arm renders it", () => {
		const states: EffectiveAccess[] = [
			FOUNDING,
			trialEndingIn(5, now),
			cancellationScheduledAt(new Date(now.getTime() + 5 * ONE_DAY_MS).toISOString()),
			INACTIVE,
		];
		for (const access of states) {
			const vm = accountVm({ access, now, nextCharge: chargeSoon });
			assert.equal(vm.nextCharge.state, "hidden", `${access.banner}/${access.tier} must not render a charge`);
		}
	});

	it("hides the next payment in the payment-method error state", () => {
		const vm = accountVm({
			access: ACTIVE,
			queryState: { ...BASE_QUERY, errorPaymentMethod: true },
			now,
			nextCharge: chargeSoon,
		});
		assert.equal(vm.nextCharge.state, "hidden");
	});
});

describe("toAccountViewModel — plan summary", () => {
	const PLANS = [
		["monthly", "Monthly plan", "$10/month"],
		["yearly", "Yearly plan", "$60/year"],
		["triennial", "3-year plan", "$108 every 3 years"],
	] as const;
	const ACTIVE_CHIP = { label: "Active", className: "chip chip--status chip--success" };

	it.each(PLANS)("titles an active %s subscription by its plan, with the Active chip and its price", (plan, title, price) => {
		const vm = accountVm({ access: ACTIVE, plan });
		assert.equal(vm.title, title);
		assert.deepEqual(vm.chips, [ACTIVE_CHIP]);
		assert.deepEqual(vm.price, { state: "visible", text: price });
		assert.equal(vm.statusLine, "");
	});

	it("falls back to 'Subscription' and hides the price when the row names no plan", () => {
		const vm = accountVm({ access: ACTIVE, plan: undefined });
		assert.equal(vm.title, "Subscription");
		assert.deepEqual(vm.chips, [ACTIVE_CHIP]);
		assert.deepEqual(vm.price, { state: "hidden", text: "" });
	});

	it.each(PLANS)("keeps the %s plan's title, chip and price while a cancellation is in flight", (plan, title, price) => {
		const vm = accountVm({ access: ACTIVE, plan, queryState: { ...BASE_QUERY, cancelling: true } });
		assert.equal(vm.title, title);
		assert.deepEqual(vm.chips, [ACTIVE_CHIP]);
		assert.deepEqual(vm.price, { state: "visible", text: price });
		assert.equal(vm.statusLine, "");
	});

	it.each(PLANS)("titles a scheduled cancellation of a %s plan with the Cancelled chip and no price — no renewal is coming", (plan, title) => {
		const vm = accountVm({ access: cancellationScheduledAt("2026-09-18T00:00:00.000Z"), plan });
		assert.equal(vm.title, title);
		assert.deepEqual(vm.chips, [{ label: "Cancelled", className: "chip chip--status chip--error" }]);
		assert.equal(vm.price.state, "hidden");
		assert.equal(vm.statusLine, "Your subscription ends on ");
	});

	it("titles a scheduled cancellation 'Subscription' when the row names no plan", () => {
		const vm = accountVm({ access: cancellationScheduledAt("2026-09-18T00:00:00.000Z"), plan: undefined });
		assert.equal(vm.title, "Subscription");
	});

	it.each([...PLANS.map(([plan]) => plan), undefined])("calls a trial 'Free trial' with no chip and no price, whatever plan (%s) the row names", (plan) => {
		const now = new Date("2026-07-14T12:00:00.000Z");
		const vm = accountVm({ access: trialEndingIn(5, now), now, plan });
		assert.equal(vm.title, "Free trial");
		assert.deepEqual(vm.chips, []);
		assert.equal(vm.price.state, "hidden");
		assert.equal(vm.statusLine, "Your free trial ends on ");
	});

	it.each([...PLANS.map(([plan]) => plan), undefined])("calls an inactive reader's subscription 'Subscription' with the Inactive chip and no sentence (%s)", (plan) => {
		const vm = accountVm({ access: INACTIVE, plan });
		assert.equal(vm.title, "Subscription");
		assert.deepEqual(vm.chips, [{ label: "Inactive", className: "chip chip--status chip--error" }]);
		assert.equal(vm.price.state, "hidden");
		assert.equal(vm.statusLine, "");
	});

	it("names a founding member's membership and says it is free for life", () => {
		const vm = accountVm({ access: FOUNDING, plan: "yearly" });
		assert.equal(vm.title, "Founding member");
		assert.deepEqual(vm.chips, []);
		assert.equal(vm.price.state, "hidden");
		assert.equal(vm.statusLine, "Free for life.");
	});

	it.each(PLANS)("keeps the %s plan's title in the payment-method error state, with no chip, price or sentence", (plan, title) => {
		const vm = accountVm({ access: ACTIVE, plan, queryState: { ...BASE_QUERY, errorPaymentMethod: true } });
		assert.equal(vm.title, title);
		assert.deepEqual(vm.chips, []);
		assert.equal(vm.price.state, "hidden");
		assert.equal(vm.statusLine, "");
	});

	it("calls the subscribe-failed state 'Subscription', with no chip, price or sentence", () => {
		const vm = accountVm({ access: INACTIVE, plan: "monthly", queryState: { ...BASE_QUERY, errorSubscribeFailed: true } });
		assert.equal(vm.title, "Subscription");
		assert.deepEqual(vm.chips, []);
		assert.equal(vm.price.state, "hidden");
		assert.equal(vm.statusLine, "");
	});
});

describe("toAccountViewModel — manage panel", () => {
	it("keeps the subscription panel closed with no body and no actions by default", () => {
		const vm = accountVm({ access: ACTIVE, plan: "monthly" });
		assert.deepEqual(vm.managePanel, {
			state: "closed",
			body: "",
			actions: [],
			showCancellingNotice: false,
			cancellingNotice: "",
		});
		assert.deepEqual(vm.actions.map((a) => a.key), ["manage-subscription"]);
	});

	it("opens on ?manage=subscription with the cancel form, and the trailing action becomes Done", () => {
		const vm = accountVm({ access: ACTIVE, plan: "monthly", queryState: { ...BASE_QUERY, manage: "subscription" } });
		assert.equal(vm.managePanel.state, "open");
		assert.equal(
			vm.managePanel.body,
			"Cancelling stops your next payment. You keep full access until the end of the period you've paid for.",
		);
		assert.deepEqual(vm.managePanel.actions.map((a) => [a.key, a.method, a.isPending]), [["cancel-form", "POST", false]]);
		assert.equal(vm.managePanel.showCancellingNotice, false);
		assert.deepEqual(vm.actions.map((a) => a.key), ["done"]);
		assert.equal(vm.actions[0].method, "GET");
		assert.equal(vm.actions[0].href, "/account");
		assert.equal(vm.actions[0].buttonClass, "btn btn--neutral btn--m");
		assert.deepEqual(vm.actions[0].hiddenFields, [
			{ name: "utm_source", value: "account" },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: "done" },
		]);
	});

	it("opens while cancelling, holding the disabled pending cancel and the notice, with nothing in the trailing slot", () => {
		const vm = accountVm({
			access: ACTIVE,
			plan: "monthly",
			queryState: { ...BASE_QUERY, cancelling: true, manage: "subscription" },
		});
		assert.equal(vm.managePanel.state, "open");
		assert.deepEqual(vm.managePanel.actions.map((a) => [a.key, a.name, a.isPending]), [
			["cancel-form", "Cancelling…", true],
		]);
		assert.equal(vm.managePanel.showCancellingNotice, true);
		assert.deepEqual(vm.actions, []);
	});

	it.each([
		["trial", trialEndingIn(5, new Date("2026-07-14T12:00:00.000Z")), BASE_QUERY, ["subscribe"]],
		["inactive", INACTIVE, BASE_QUERY, ["subscribe"]],
		["founding", FOUNDING, BASE_QUERY, []],
		["cancellation-scheduled", cancellationScheduledAt("2026-09-18T00:00:00.000Z"), BASE_QUERY, ["reactivate-form"]],
		["error-payment-method", ACTIVE, { ...BASE_QUERY, errorPaymentMethod: true }, []],
		["error-subscribe-failed", INACTIVE, { ...BASE_QUERY, errorSubscribeFailed: true }, ["subscribe"]],
	] as const)("ignores ?manage=subscription in the %s state: the panel stays shut and the state keeps its own action", (_state, access, query, keys) => {
		const vm = accountVm({ access, plan: "monthly", queryState: { ...query, manage: "subscription" } });
		assert.equal(vm.managePanel.state, "closed");
		assert.deepEqual(vm.managePanel.actions, []);
		assert.deepEqual(vm.actions.map((a) => a.key), [...keys]);
	});
});

describe("toAccountViewModel — actions", () => {
	const now = new Date();

	it("founding members get no actions", () => {
		const vm = accountVm({ access: FOUNDING, now });
		assert.deepEqual(vm.actions, []);
	});

	it("exposes the destructive delete-account danger action in every state, separate from the state actions", () => {
		const vm = accountVm({ access: FOUNDING, now });
		assert.equal(vm.dangerAction.key, "delete-account");
		assert.equal(vm.dangerAction.variant, "destructive");
		assert.equal(vm.dangerAction.method, "POST");
		assert.equal(
			vm.dangerAction.href,
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account",
		);
	});

	it("exposes the typed-confirmation gate for the danger action", () => {
		const vm = accountVm({ access: FOUNDING, now });
		assert.equal(vm.dangerConfirmation.phrase, "delete my account permanently");
		assert.equal(vm.dangerConfirmation.pattern, "delete my account permanently");
		assert.equal(
			vm.dangerConfirmation.title,
			"Type the phrase exactly: delete my account permanently",
		);
		assert.equal(vm.dangerConfirmation.field, "confirmation");
		assert.equal(vm.dangerConfirmation.hasNotice, false);
	});

	it("shows the confirmation notice after a rejected delete (error=delete_confirmation)", () => {
		const vm = accountVm({ access: FOUNDING, now, queryState: { ...BASE_QUERY, deleteConfirmationError: true } });
		assert.equal(vm.dangerConfirmation.hasNotice, true);
		assert.equal(
			vm.dangerConfirmation.notice,
			'Your account was not deleted. Type "delete my account permanently" exactly to confirm.',
		);
	});

	it("active paid users get Manage subscription, a GET that carries its UTM and its ?manage= in hidden fields — the cancel form waits in the panel", () => {
		const vm = accountVm({ access: ACTIVE, now });
		assert.equal(vm.actions.length, 1);
		const [manage] = vm.actions;
		assert.equal(manage.key, "manage-subscription");
		assert.equal(manage.name, "Manage subscription");
		assert.equal(manage.variant, "primary");
		assert.equal(manage.buttonClass, "btn btn--primary btn--m");
		assert.equal(manage.method, "GET");
		assert.equal(manage.href, "/account");
		assert.deepEqual(manage.hiddenFields, [
			{ name: "utm_source", value: "account" },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: "manage-subscription" },
			{ name: "manage", value: "subscription" },
		]);
		assert.equal(manage.leadingIcon, undefined);
		assert.equal(manage.trailingIcon, undefined);
		assert.equal(vm.pollState, "idle");
		assert.equal(vm.pollUrl, undefined);

		const managing = accountVm({ access: ACTIVE, now, queryState: { ...BASE_QUERY, manage: "subscription" } });
		const [cancel] = managing.managePanel.actions;
		assert.equal(cancel.key, "cancel-form");
		assert.equal(cancel.variant, "destructive");
		assert.equal(cancel.buttonClass, "btn btn--destructive btn--m");
		assert.equal(cancel.method, "POST");
		assert.equal(cancel.isPending, false);
		assert.deepEqual(cancel.hiddenFields, []);
		assert.equal(cancel.href, "/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form");
	});

	it("active paid users with cancelling=1 keep the cancel control in the panel, disabled — the command is already in flight", () => {
		const vm = accountVm({ access: ACTIVE, now, queryState: { ...BASE_QUERY, cancelling: true } });
		assert.deepEqual(vm.actions, []);
		assert.equal(vm.managePanel.actions.length, 1);
		assert.equal(vm.managePanel.actions[0].key, "cancel-form");
		assert.equal(vm.managePanel.actions[0].name, "Cancelling…");
		assert.equal(vm.managePanel.actions[0].isPending, true);
		assert.equal(vm.managePanel.showCancellingNotice, true);
		assert.equal(vm.managePanel.cancellingNotice, "Cancellation in progress.");
	});

	it("polls itself while cancelling, advancing the budget cursor each tick", () => {
		const vm = accountVm({ access: ACTIVE, now, queryState: { ...BASE_QUERY, cancelling: true, pollCount: 4 } });
		assert.equal(vm.pollState, "polling");
		assert.equal(vm.pollUrl, "/account/status?cancelling=1&poll=5");
	});

	it("stops polling and says so once the budget is spent — a wedged async chain must not leave a disabled button forever", () => {
		const vm = accountVm({
			access: ACTIVE,
			now,
			queryState: { ...BASE_QUERY, cancelling: true, pollCount: ACCOUNT_CANCEL_MAX_POLLS },
		});
		assert.equal(vm.pollState, "idle");
		assert.equal(vm.pollUrl, undefined);
		assert.equal(vm.managePanel.actions[0].isPending, true);
		assert.equal(
			vm.managePanel.cancellingNotice,
			"Cancellation is taking longer than usual. Refresh to check.",
		);
	});

	it("stops polling once the cancellation has landed — the card now offers reactivate instead", () => {
		const vm = accountVm({
			access: cancellationScheduledAt(new Date(now.getTime() + 5 * ONE_DAY_MS).toISOString()),
			now,
			queryState: { ...BASE_QUERY, cancelling: true, pollCount: 3 },
		});
		assert.deepEqual(
			vm.actions.map((a) => a.key),
			["reactivate-form"],
		);
		assert.equal(vm.pollState, "idle");
		assert.equal(vm.pollUrl, undefined);
		assert.equal(vm.managePanel.state, "closed");
		assert.equal(vm.managePanel.showCancellingNotice, false);
	});

	it("trial users get a primary subscribe action only — no cancel button while on trial", () => {
		const vm = accountVm({ access: trialEndingIn(5, now), now });
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["subscribe"]);
		assert.equal(vm.actions[0].variant, "primary");
		assert.equal(vm.actions[0].method, "POST");
		assert.equal(vm.actions[0].href, "/account/subscribe?utm_source=account&utm_medium=internal&utm_content=subscribe");
	});

	it("inactive users get a primary subscribe action only", () => {
		const vm = accountVm({ access: INACTIVE, now });
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["subscribe"]);
		assert.equal(vm.actions[0].variant, "primary");
	});

	it("error-payment-method state exposes no actions (support email lives in the body copy)", () => {
		const vm = accountVm({
			access: { tier: "inactive", access: "read-only", banner: "inactive", reason: "subscription-cancelled", plan: undefined },
			now,
			queryState: { ...BASE_QUERY, errorPaymentMethod: true },
		});
		assert.deepEqual(vm.actions, []);
	});

	it("paid cancellation-scheduled state — single Reactivate action (no Cancel — the user already cancelled), status line carries the cutoff date", () => {
		const vm = accountVm({ access: cancellationScheduledAt("2026-06-22T10:00:00.000Z"), now });

		assert.equal(vm.state, "cancellation-scheduled");
		assert.equal(vm.stateClass, "account-card account-card--cancellation-scheduled");
		assert.equal(vm.statusLine, "Your subscription ends on ");
		assert.deepEqual(vm.statusDate, {
			iso: "2026-06-22T10:00:00.000Z",
			label: "Jun 22, 2026",
			mode: "date",
		});
		assert.equal(vm.statusDateTail, ".");
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["reactivate-form"]);
		assert.equal(vm.actions[0].variant, "primary");
		assert.equal(vm.actions[0].method, "POST");
		assert.equal(vm.actions[0].href, "/account/reactivate?utm_source=account&utm_medium=internal&utm_content=reactivate-form");
	});

	it("trial cancellation-scheduled state — same shape as paid (reactivate-form, Reactivate label) so the template stays branchless", () => {
		const vm = accountVm({
			access: { tier: "trial", access: "full", banner: "cancellation-scheduled", cancellationEffectiveAt: "2026-06-05T00:00:00.000Z" },
			now,
		});

		assert.equal(vm.state, "cancellation-scheduled");
		assert.equal(vm.statusLine, "Your subscription ends on ");
		assert.deepEqual(vm.statusDate, {
			iso: "2026-06-05T00:00:00.000Z",
			label: "Jun 5, 2026",
			mode: "date",
		});
		assert.equal(vm.statusDateTail, ".");
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["reactivate-form"]);
	});

	it("re-offers a returning reader the plan their cancelled subscription carried after a failed checkout, where the plan chooser opens again", () => {
		const vm = accountVm({
			access: { tier: "inactive", access: "read-only", banner: "inactive", reason: "subscription-cancelled", plan: "triennial" },
			now,
			queryState: { ...BASE_QUERY, errorSubscribeFailed: true },
		});

		assert.equal(vm.state, "error-subscribe-failed");
		assert.deepEqual(vm.actions.map((a) => a.popoverTarget), ["subscribe-plans"]);
		assert.equal(vm.checkedPlan, "triennial");
	});
});

describe("toAccountViewModel — billing history", () => {
	it("shows billing history with View invoices whenever the row has a customer, a former subscriber included", () => {
		const vm = accountVm({ access: INACTIVE, hasCustomer: true });
		assert.equal(vm.billingHistory.state, "visible");
		assert.equal(vm.billingHistory.isVisible, true);
		const [viewInvoices] = vm.billingHistory.actions;
		assert.equal(viewInvoices.key, "view-invoices");
		assert.equal(viewInvoices.name, "View invoices");
		assert.equal(viewInvoices.method, "GET");
		assert.equal(viewInvoices.href, "/account/invoices");
		assert.equal(viewInvoices.buttonClass, "btn btn--neutral btn--m");
		assert.equal(viewInvoices.leadingIcon, undefined);
		assert.equal(viewInvoices.trailingIcon, "chevron-right");
		assert.deepEqual(viewInvoices.hiddenFields, [
			{ name: "utm_source", value: "account" },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: "view-invoices" },
		]);
	});

	it("hides billing history, with no action, when the row has no customer", () => {
		const vm = accountVm({ access: trialEndingIn(5, new Date("2026-07-14T12:00:00.000Z")), hasCustomer: false });
		assert.deepEqual(vm.billingHistory, { state: "hidden", isVisible: false, actions: [] });
	});
});

describe("toAccountViewModel — payment section", () => {
	it("opens the payment panel from the ?manage= query over the route's card read", () => {
		const vm = accountVm({
			access: ACTIVE,
			hasCustomer: true,
			queryState: { ...BASE_QUERY, manage: "payment" },
			payment: {
				kind: "loaded",
				cards: [savedCard("pm_primary", true)],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: undefined,
			},
		});
		assert.equal(vm.payment.state, "card");
		assert.equal(vm.payment.panel.state, "open");
	});
});

describe("withoutCommerce — iOS app surface (Guideline 3.1.1)", () => {
	const now = new Date();
	const chargeSoon = {
		at: new Date(now.getTime() + 10 * ONE_DAY_MS).toISOString(),
		amountMinor: 4900,
		currency: "usd",
	};

	it("hides the price, the payment section and billing history", () => {
		const web = accountVm({
			access: ACTIVE,
			now,
			plan: "monthly",
			hasCustomer: true,
			payment: {
				kind: "loaded",
				cards: [savedCard("pm_primary", true)],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: undefined,
			},
		});
		assert.equal(web.price.state, "visible");
		assert.equal(web.payment.state, "card");
		assert.equal(web.billingHistory.state, "visible");
		assert.equal(web.subscriptionHeading, "Subscription & billing");
		assert.equal(web.lede, "Manage your account, billing and preferences.");
		const app = withoutCommerce(web, { appShell: false, platform: "ios" });
		assert.deepEqual(app.price, { state: "hidden", text: "" });
		assert.equal(app.payment.state, "hidden");
		assert.equal(app.payment.isShown, false);
		assert.deepEqual(app.payment.actions, []);
		assert.deepEqual(app.billingHistory, { state: "hidden", isVisible: false, actions: [] });
		assert.equal(app.title, "Monthly plan");
		assert.equal(app.subscriptionHeading, "Subscription");
		assert.equal(app.lede, "Manage your account and preferences.");
	});

	it("strips a visible next-payment line — naming a price in-app is the part Guideline 3.1.1 objects to", () => {
		const web = accountVm({ access: ACTIVE, now, nextCharge: chargeSoon });
		assert.equal(web.nextCharge.state, "visible");
		assert.equal(withoutCommerce(web, { appShell: false, platform: "ios" }).nextCharge.state, "hidden");
	});

	it("keeps the cancel control but routes it through ?platform=ios so its post-redirect keeps the surface", () => {
		const vm = withoutCommerce(
			accountVm({ access: ACTIVE, now, queryState: { ...BASE_QUERY, manage: "subscription" } }),
			{ appShell: false, platform: "ios" },
		);
		assert.deepEqual(
			vm.managePanel.actions.map((a) => a.key),
			["cancel-form"],
		);
		assert.equal(
			vm.managePanel.actions[0].href,
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form&platform=ios",
		);
		assert.deepEqual(vm.actions.map((a) => a.key), ["done"]);
		assert.deepEqual(vm.actions[0].hiddenFields, [
			{ name: "utm_source", value: "account" },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: "done" },
			{ name: "platform", value: "ios" },
		]);
	});

	it("carries the surface markers on Manage subscription as hidden fields, because a GET form drops its action's query", () => {
		const vm = withoutCommerce(accountVm({ access: ACTIVE, now }), { appShell: true, platform: "ios" });
		assert.equal(vm.actions[0].key, "manage-subscription");
		assert.equal(vm.actions[0].href, "/account");
		assert.deepEqual(vm.actions[0].hiddenFields, [
			{ name: "utm_source", value: "account" },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: "manage-subscription" },
			{ name: "manage", value: "subscription" },
			{ name: "platform", value: "ios" },
			{ name: "shell", value: "app" },
		]);
	});

	it("carries ?platform=ios on the cancelling card's poll URL so the card can't poll its way back onto the web surface", () => {
		const vm = withoutCommerce(
			accountVm({ access: ACTIVE, now, queryState: { ...BASE_QUERY, cancelling: true, pollCount: 1 } }),
			{ appShell: false, platform: "ios" },
		);
		assert.equal(vm.pollState, "polling");
		assert.equal(vm.pollUrl, "/account/status?cancelling=1&poll=2&platform=ios");
	});

	it("stamps the app-shell marker on the poll URL too, so the polled fragment stays chromeless", () => {
		const vm = withoutCommerce(
			accountVm({ access: ACTIVE, now, queryState: { ...BASE_QUERY, cancelling: true, pollCount: 1 } }),
			{ appShell: true, platform: "ios" },
		);
		assert.equal(vm.pollUrl, "/account/status?cancelling=1&poll=2&platform=ios&shell=app");
	});

	it("strips the subscribe CTA on trial — no in-app purchase path", () => {
		const vm = withoutCommerce(accountVm({ access: trialEndingIn(5, now), now }), {
			appShell: false,
			platform: "ios",
		});
		assert.deepEqual(vm.actions, []);
	});

	it("strips the reactivate CTA in the cancellation-scheduled state", () => {
		const vm = withoutCommerce(
			accountVm({ access: cancellationScheduledAt("2026-06-22T10:00:00.000Z"), now }),
			{ appShell: false, platform: "ios" },
		);
		assert.deepEqual(vm.actions, []);
	});

	it("keeps the delete-account danger zone and routes it through ?platform=ios so a rejected delete re-renders commerce-free", () => {
		const vm = withoutCommerce(accountVm({ access: INACTIVE, now }), { appShell: false, platform: "ios" });
		assert.equal(vm.dangerAction.key, "delete-account");
		assert.equal(
			vm.dangerAction.href,
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account&platform=ios",
		);
		assert.deepEqual(vm.actions, []);
	});

	it("stamps the app-shell marker alongside platform=ios on every surviving control, so a boosted request comes back chromeless", () => {
		const vm = withoutCommerce(
			accountVm({ access: ACTIVE, now, queryState: { ...BASE_QUERY, manage: "subscription" } }),
			{ appShell: true, platform: "ios" },
		);
		assert.equal(
			vm.managePanel.actions[0].href,
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form&platform=ios&shell=app",
		);
		assert.deepEqual(vm.actions[0].hiddenFields.slice(-2), [
			{ name: "platform", value: "ios" },
			{ name: "shell", value: "app" },
		]);
		assert.equal(
			vm.dangerAction.href,
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account&platform=ios&shell=app",
		);
	});
});

describe("parseAccountQuery", () => {
	it("returns defaults for undefined query", () => {
		const result = parseAccountQuery(undefined);
		assert.deepEqual(result, {
			cancelling: false,
			pollCount: 0,
			errorPaymentMethod: false,
			errorSubscribeFailed: false,
			deleteConfirmationError: false,
			passwordChanged: false,
			cardError: undefined,
			manage: undefined,
		});
	});

	it("reads a just-changed password from ?password=changed, and ignores a value that names nothing", () => {
		assert.equal(parseAccountQuery({ password: "changed" }).passwordChanged, true);
		assert.equal(parseAccountQuery({ password: "reset" }).passwordChanged, false);
	});

	it("clamps a poll cursor past the budget so a client can't buy itself extra ticks", () => {
		assert.equal(
			parseAccountQuery({ poll: String(ACCOUNT_CANCEL_MAX_POLLS + 50) }).pollCount,
			ACCOUNT_CANCEL_MAX_POLLS,
		);
	});

	it("parses the delete_confirmation error", () => {
		const result = parseAccountQuery({ error: "delete_confirmation" });
		assert.equal(result.deleteConfirmationError, true);
		assert.equal(result.cardError, undefined);
	});

	it("parses the card_limit error", () => {
		assert.equal(parseAccountQuery({ error: "card_limit" }).cardError, "card_limit");
	});

	it("parses the cannot_remove_primary error", () => {
		assert.equal(
			parseAccountQuery({ error: "cannot_remove_primary" }).cardError,
			"cannot_remove_primary",
		);
	});

	it("parses the add_card_failed error", () => {
		assert.equal(
			parseAccountQuery({ error: "add_card_failed" }).cardError,
			"add_card_failed",
		);
	});

	it("parses the card_setup_failed error", () => {
		assert.equal(
			parseAccountQuery({ error: "card_setup_failed" }).cardError,
			"card_setup_failed",
		);
	});

	it("parses the card_setup_unverified error", () => {
		assert.equal(
			parseAccountQuery({ error: "card_setup_unverified" }).cardError,
			"card_setup_unverified",
		);
	});

	it("parses which panel ?manage= opens, and ignores a value that names none", () => {
		assert.equal(parseAccountQuery({ manage: "subscription" }).manage, "subscription");
		assert.equal(parseAccountQuery({ manage: "payment" }).manage, "payment");
		assert.equal(parseAccountQuery({ manage: "billing" }).manage, undefined);
	});
});

describe("buildPaymentSectionViewModel", () => {
	const CLOSED_PANEL = {
		state: "closed",
		hasNotice: false,
		notice: "",
		backups: [],
		hint: "",
		showAddButton: false,
		showLimitHint: false,
		limitHint: "",
		isAdding: false,
		adding: undefined,
	};

	it("hides the whole section for a reader with no Stripe customer, with no row, panel or action", () => {
		const vm = buildPaymentSectionViewModel({ kind: "no-customer" }, "payment");
		assert.equal(vm.state, "hidden");
		assert.equal(vm.isShown, false);
		assert.equal(vm.primary, undefined);
		assert.equal(vm.noCard, undefined);
		assert.deepEqual(vm.actions, []);
		assert.equal(vm.showRowAddForm, false);
		assert.equal(vm.isError, false);
		assert.equal(vm.message, "");
		assert.deepEqual(vm.panel, CLOSED_PANEL);
	});

	it("degrades a failed card read to a retry message, with no action and the panel shut whatever the query asks", () => {
		const vm = buildPaymentSectionViewModel({ kind: "provider-error" }, "payment");
		assert.equal(vm.state, "provider-error");
		assert.equal(vm.isShown, true);
		assert.equal(vm.isError, true);
		assert.equal(vm.message, "Couldn't load your saved cards. Refresh the page to try again.");
		assert.deepEqual(vm.actions, []);
		assert.deepEqual(vm.panel, CLOSED_PANEL);
	});

	it("shows the primary card as the row — brand tile, title, Primary badge and expiry — with Update payment method trailing and the panel shut", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [
					savedCard("pm_primary", true, { brand: "mastercard", last4: "1111", expMonth: 3, expYear: 2027 }),
					savedCard("pm_backup", false),
				],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: undefined,
			},
			undefined,
		);

		assert.equal(vm.state, "card");
		assert.equal(vm.isShown, true);
		assert.deepEqual(vm.primary, {
			tileLabel: "MASTERCARD",
			title: "Mastercard •••• 1111",
			expiry: "Expires 03/27",
			chips: [{ label: "Primary", className: "chip chip--badge chip--accent" }],
		});
		assert.equal(vm.noCard, undefined);
		assert.deepEqual(vm.actions.map((a) => a.key), ["update-payment"]);
		const [update] = vm.actions;
		assert.equal(update.name, "Update payment method");
		assert.equal(update.method, "GET");
		assert.equal(update.href, "/account");
		assert.equal(update.buttonClass, "btn btn--neutral btn--m");
		assert.equal(update.leadingIcon, "pencil");
		assert.deepEqual(update.hiddenFields, [
			{ name: "utm_source", value: "account" },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: "update-payment" },
			{ name: "manage", value: "payment" },
		]);
		assert.equal(vm.showRowAddForm, false);
		assert.deepEqual(vm.panel, CLOSED_PANEL);
	});

	it("opens the panel on ?manage=payment with the backups, their actions and the hint, and the row's action becomes Done", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_primary", true), savedCard("pm_backup", false, { last4: "5555", expMonth: 8, expYear: 2029 })],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: undefined,
			},
			"payment",
		);

		assert.equal(vm.panel.state, "open");
		assert.deepEqual(vm.actions.map((a) => a.key), ["done"]);
		assert.equal(vm.panel.backups.length, 1);
		const [backup] = vm.panel.backups;
		assert.equal(backup.tileLabel, "VISA");
		assert.equal(backup.title, "Visa •••• 5555");
		assert.equal(backup.expiry, "Expires 08/29");
		assert.deepEqual(
			backup.actions.map((a) => [a.key, a.name, a.buttonClass]),
			[
				["promote", "Make primary", "btn btn--secondary btn--s"],
				["remove", "Remove", "btn btn--destructive btn--s"],
			],
		);
		assert.equal(
			backup.actions[0].href,
			"/account/cards/pm_backup/primary?utm_source=account&utm_medium=internal&utm_content=promote-card",
		);
		assert.equal(
			backup.actions[1].href,
			"/account/cards/pm_backup/remove?utm_source=account&utm_medium=internal&utm_content=remove-card",
		);
		assert.equal(
			vm.panel.hint,
			"A new card is added as a backup. Make it primary to pay with it from your next payment.",
		);
		assert.equal(vm.panel.hasNotice, false);
	});

	it.each([
		["visa", "VISA", "Visa"],
		["mastercard", "MASTERCARD", "Mastercard"],
		["amex", "AMEX", "American Express"],
		["discover", "DISCOVER", "Discover"],
		["diners", "DINERS", "Diners Club"],
		["jcb", "JCB", "JCB"],
		["unionpay", "UNIONPAY", "UnionPay"],
		["eftpos_au", "EFTPOS", "eftpos"],
		["link", "CARD", "Card"],
		["constructor", "CARD", "Card"],
	])("labels a %s card's tile %s and names it %s", (brand, tileLabel, name) => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_primary", true, { brand, last4: "0005" })],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: undefined,
			},
			undefined,
		);
		assert.equal(vm.primary?.tileLabel, tileLabel);
		assert.equal(vm.primary?.title, `${name} •••• 0005`);
	});

	it("shows the add button in the open panel when there is room and a publishable key", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_a", true)],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: undefined,
			},
			"payment",
		);
		assert.equal(vm.panel.showAddButton, true);
		assert.equal(vm.panel.showLimitHint, false);
		assert.equal(vm.addUrl, "/account/cards/new?utm_source=account&utm_medium=internal&utm_content=add-card");
		assert.equal(
			vm.confirmUrl,
			"/account/cards/confirm?utm_source=account&utm_medium=internal&utm_content=save-card",
		);
	});

	it("hides the add button and shows the limit hint at the 3-card cap", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_a", true), savedCard("pm_b", false), savedCard("pm_c", false)],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: undefined,
			},
			"payment",
		);
		assert.equal(vm.panel.showAddButton, false);
		assert.equal(vm.panel.showLimitHint, true);
		assert.equal(vm.panel.limitHint, "You've reached the 3-card limit. Remove a backup to add a different card.");
	});

	it("hides the add button when there is no publishable key, even with room", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_a", true)],
				publishableKey: undefined,
				cardError: undefined,
				adding: undefined,
			},
			"payment",
		);
		assert.equal(vm.panel.showAddButton, false);
	});

	it.each([
		["card_limit", /up to 3 cards/],
		["cannot_remove_primary", /primary card can't be removed/],
		["add_card_failed", /couldn't start adding a card/],
		["card_setup_failed", /couldn't verify your new card, so it wasn't saved/],
		["card_setup_unverified", /couldn't verify your new card just now/],
	] as const)("opens the panel on the %s notice", (cardError, notice) => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_a", true)],
				publishableKey: "pk_test",
				cardError,
				adding: undefined,
			},
			undefined,
		);
		assert.equal(vm.panel.state, "open");
		assert.equal(vm.panel.hasNotice, true);
		assert.match(vm.panel.notice, notice);
	});

	it("opens the panel in the adding state with the publishable key, client secret, and setup id", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_a", true)],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: { clientSecret: "seti_secret", setupId: "seti_x" },
			},
			undefined,
		);
		assert.equal(vm.panel.state, "open");
		assert.equal(vm.panel.isAdding, true);
		assert.deepEqual(vm.panel.adding, {
			publishableKey: "pk_test",
			clientSecret: "seti_secret",
			setupId: "seti_x",
		});
		assert.equal(vm.panel.showAddButton, false);
		assert.deepEqual(vm.actions.map((a) => a.key), ["done"]);
	});

	it("points the add-card Cancel back at the open payment panel, where every other card flow returns", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_a", true)],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: { clientSecret: "seti_secret", setupId: "seti_x" },
			},
			undefined,
		);
		assert.equal(
			vm.cancelAddUrl,
			"/account?manage=payment&utm_source=account&utm_medium=internal&utm_content=cancel-add-card",
		);
	});

	it("cannot enter the adding state without a publishable key", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_a", true)],
				publishableKey: undefined,
				cardError: undefined,
				adding: { clientSecret: "seti_secret", setupId: "seti_x" },
			},
			undefined,
		);
		assert.equal(vm.panel.state, "closed");
		assert.equal(vm.panel.isAdding, false);
		assert.equal(vm.panel.adding, undefined);
	});

	it("offers Add a card in the row when no card is on file and the panel is shut", () => {
		const vm = buildPaymentSectionViewModel(
			{ kind: "loaded", cards: [], publishableKey: "pk_test", cardError: undefined, adding: undefined },
			undefined,
		);
		assert.equal(vm.state, "no-card");
		assert.deepEqual(vm.noCard, {
			title: "No card on file",
			line: "Add a card to keep your plan running.",
		});
		assert.equal(vm.primary, undefined);
		assert.deepEqual(vm.actions, []);
		assert.equal(vm.showRowAddForm, true);
		assert.deepEqual(vm.panel, CLOSED_PANEL);
	});

	it("leaves the no-card row without an add form when there is no publishable key to add one with", () => {
		const vm = buildPaymentSectionViewModel(
			{ kind: "loaded", cards: [], publishableKey: undefined, cardError: undefined, adding: undefined },
			undefined,
		);
		assert.equal(vm.state, "no-card");
		assert.equal(vm.showRowAddForm, false);
	});

	it("moves Add a card from the row into the open panel", () => {
		const vm = buildPaymentSectionViewModel(
			{ kind: "loaded", cards: [], publishableKey: "pk_test", cardError: undefined, adding: undefined },
			"payment",
		);
		assert.equal(vm.state, "no-card");
		assert.equal(vm.showRowAddForm, false);
		assert.equal(vm.panel.showAddButton, true);
		assert.deepEqual(vm.actions.map((a) => a.key), ["done"]);
	});

	it("treats saved cards with no primary as no primary card, listing every card as a backup the reader can promote", () => {
		const vm = buildPaymentSectionViewModel(
			{
				kind: "loaded",
				cards: [savedCard("pm_a", false), savedCard("pm_b", false), savedCard("pm_c", false)],
				publishableKey: "pk_test",
				cardError: undefined,
				adding: undefined,
			},
			"payment",
		);
		assert.equal(vm.state, "no-card");
		assert.equal(vm.primary, undefined);
		assert.deepEqual(vm.noCard, {
			title: "No primary card",
			line: "Make one of your saved cards primary to keep your plan running.",
		});
		assert.deepEqual(
			vm.panel.backups.map((backup) => backup.actions.map((a) => a.key)),
			[["promote", "remove"], ["promote", "remove"], ["promote", "remove"]],
		);
		assert.equal(vm.panel.showLimitHint, true);
	});

	it.each<[string, SavedCard[]]>([
		["one saved card", [savedCard("pm_a", false)]],
		["the 3-card cap", [savedCard("pm_a", false), savedCard("pm_b", false), savedCard("pm_c", false)]],
	])("offers Update payment method, not Add a card, on the shut row when no card is primary, at %s", (_label, cards) => {
		const vm = buildPaymentSectionViewModel(
			{ kind: "loaded", cards, publishableKey: "pk_test", cardError: undefined, adding: undefined },
			undefined,
		);
		assert.equal(vm.state, "no-card");
		assert.deepEqual(vm.noCard, {
			title: "No primary card",
			line: "Make one of your saved cards primary to keep your plan running.",
		});
		assert.deepEqual(vm.actions.map((a) => a.key), ["update-payment"]);
		assert.equal(vm.showRowAddForm, false);
		assert.deepEqual(vm.panel, CLOSED_PANEL);
	});
});

describe("buildAppearanceSection", () => {
	it("marks the current preference active and posts to the appearance route", () => {
		const section = buildAppearanceSection({ current: "dark", appShell: false, platform: undefined });
		assert.equal(section.formAction, "/account/appearance?utm_source=account&utm_medium=internal&utm_content=appearance");
		assert.deepEqual(
			section.options.map((o) => [o.value, o.label, o.active, o.ariaPressed]),
			[
				["light", "Light", false, "false"],
				["dark", "Dark", true, "true"],
				["system", "Auto", false, "false"],
			],
		);
	});

	it("carries the app-surface markers onto the form action for an in-app web sheet", () => {
		const section = buildAppearanceSection({ current: "system", appShell: true, platform: "ios" });
		const url = new URL(section.formAction, "https://internal.invalid");
		assert.equal(url.pathname, "/account/appearance");
		assert.equal(url.searchParams.get("utm_source"), "account");
		assert.equal(url.searchParams.get("utm_content"), "appearance");
		assert.equal(url.searchParams.get("shell"), "app");
		assert.equal(url.searchParams.get("platform"), "ios");
	});
});

describe("buildProfileSection", () => {
	it("titles the row with the display name over the email, takes the initials from the name and posts the edit to the profile route", () => {
		const section = buildProfileSection({
			email: "reader@example.com",
			displayName: DisplayNameSchema.parse("Reader Name"),
			nativeSurface: false,
		});
		assert.equal(section.initials, "RN");
		assert.deepEqual(section.lines, [
			{ text: "Reader Name", kind: "name", role: "title" },
			{ text: "reader@example.com", kind: "email", role: "description" },
		]);
		assert.deepEqual(section.edits, [
			{
				popoverId: "account-profile-edit",
				formAction: "/account/profile?utm_source=account&utm_medium=internal&utm_content=edit-profile",
				value: "Reader Name",
				maxLength: 64,
			},
		]);
	});

	it("titles the row with the email alone and takes the initials from it when no name is set, leaving the field empty", () => {
		const section = buildProfileSection({
			email: "reader@example.com",
			displayName: undefined,
			nativeSurface: false,
		});
		assert.equal(section.initials, "RE");
		assert.deepEqual(section.lines, [{ text: "reader@example.com", kind: "email", role: "title" }]);
		assert.deepEqual(
			section.edits.map((edit) => edit.value),
			[""],
		);
	});

	it("shows a native app surface the same row with no edit", () => {
		const section = buildProfileSection({
			email: "reader@example.com",
			displayName: DisplayNameSchema.parse("Reader Name"),
			nativeSurface: true,
		});
		assert.equal(section.initials, "RN");
		assert.deepEqual(
			section.lines.map((line) => line.text),
			["Reader Name", "reader@example.com"],
		);
		assert.deepEqual(section.edits, []);
	});
});

describe("buildSecuritySection", () => {
	const NOW = new Date("2026-10-15T12:00:00.000Z");

	it("hides the section for an account that has no password to change", () => {
		const section = buildSecuritySection({
			status: { kind: "not-set" },
			now: NOW,
			changed: false,
			appShell: false,
			platform: undefined,
		});
		assert.deepEqual(section, { state: "hidden" });
	});

	it("reads when the password last changed as a relative phrase and links to the change page", () => {
		const updatedAt = new Date(NOW.getTime() - 180 * ONE_DAY_MS).toISOString();
		const section = buildSecuritySection({
			status: { kind: "set", updatedAt },
			now: NOW,
			changed: false,
			appShell: false,
			platform: undefined,
		});
		assert.deepEqual(section, {
			state: "visible",
			changeHref: "/account/password?utm_source=account&utm_medium=internal&utm_content=change-password",
			updated: { iso: updatedAt, label: "6 months ago", mode: "relative" },
			changed: false,
		});
	});

	it("leaves the change time out when the password predates the record of it", () => {
		const section = buildSecuritySection({
			status: { kind: "set", updatedAt: undefined },
			now: NOW,
			changed: false,
			appShell: false,
			platform: undefined,
		});
		assert(section.state === "visible", "a password account shows the security section");
		assert.equal(section.updated, undefined);
	});

	it("carries a just-changed password through to the section", () => {
		const section = buildSecuritySection({
			status: { kind: "set", updatedAt: NOW.toISOString() },
			now: NOW,
			changed: true,
			appShell: false,
			platform: undefined,
		});
		assert(section.state === "visible", "a password account shows the security section");
		assert.equal(section.changed, true);
		assert.deepEqual(section.updated, { iso: NOW.toISOString(), label: "just now", mode: "relative" });
	});

	it.each(["ios", "android"] as const)(
		"carries the %s app sheet's markers onto the change link so the page opens inside the sheet",
		(platform) => {
			const section = buildSecuritySection({
				status: { kind: "set", updatedAt: NOW.toISOString() },
				now: NOW,
				changed: false,
				appShell: true,
				platform,
			});
			assert(section.state === "visible", "a password account shows the security section");
			const url = new URL(section.changeHref, "https://internal.invalid");
			assert.equal(url.pathname, "/account/password");
			assert.equal(url.searchParams.get("utm_source"), "account");
			assert.equal(url.searchParams.get("utm_content"), "change-password");
			assert.equal(url.searchParams.get("platform"), platform);
			assert.equal(url.searchParams.get("shell"), "app");
		},
	);
});
