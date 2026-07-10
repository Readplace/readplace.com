import assert from "node:assert/strict";
import { PaymentMethodIdSchema } from "@packages/provider-contracts/payment-methods";
import type { SavedCard } from "@packages/provider-contracts/payment-methods";
import {
	buildCardSectionViewModel,
	toAccountViewModel,
	parseAccountQuery,
	withoutCommerce,
} from "./account.view-model";
import type { EffectiveAccess } from "../../../domain/access/effective-access";

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
			{ cancelling: false, errorPaymentMethod: false, deleteConfirmationError: false, cardError: undefined },
			now,
		);
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
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const vm = toAccountViewModel(
			access,
			{ cancelling: false, errorPaymentMethod: false, deleteConfirmationError: false, cardError: undefined },
			now,
		);
		assert.equal(vm.statusDateTail, " — 1 day left.");
	});
});

describe("toAccountViewModel — actions", () => {
	const now = new Date();
	const baseQuery = { cancelling: false, errorPaymentMethod: false, deleteConfirmationError: false, cardError: undefined };

	it("founding members get no actions", () => {
		const vm = toAccountViewModel(
			{ tier: "founding", access: "full", banner: "none" },
			baseQuery,
			now,
		);
		assert.deepEqual(vm.actions, []);
	});

	it("exposes the destructive delete-account danger action in every state, separate from the state actions", () => {
		const vm = toAccountViewModel(
			{ tier: "founding", access: "full", banner: "none" },
			baseQuery,
			now,
		);
		assert.equal(vm.dangerAction.key, "delete-account");
		assert.equal(vm.dangerAction.variant, "destructive");
		assert.equal(vm.dangerAction.method, "POST");
		assert.equal(
			vm.dangerAction.href,
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account",
		);
	});

	it("exposes the typed-confirmation gate for the danger action", () => {
		const vm = toAccountViewModel(
			{ tier: "founding", access: "full", banner: "none" },
			baseQuery,
			now,
		);
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
		const vm = toAccountViewModel(
			{ tier: "founding", access: "full", banner: "none" },
			{ ...baseQuery, deleteConfirmationError: true },
			now,
		);
		assert.equal(vm.dangerConfirmation.hasNotice, true);
		assert.equal(
			vm.dangerConfirmation.notice,
			'Your account was not deleted. Type "delete my account permanently" exactly to confirm.',
		);
	});

	it("active paid users get a destructive cancel form (POST) — no GET confirmation step", () => {
		const vm = toAccountViewModel(
			{ tier: "paid", access: "full", banner: "none" },
			baseQuery,
			now,
		);
		assert.equal(vm.actions.length, 1);
		assert.equal(vm.actions[0].key, "cancel-form");
		assert.equal(vm.actions[0].variant, "destructive");
		assert.equal(vm.actions[0].method, "POST");
		assert.equal(vm.actions[0].href, "/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form");
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

	it("trial users get a primary subscribe action only — no cancel button while on trial", () => {
		const trialEndsAt = new Date(now.getTime() + 5 * ONE_DAY_MS).toISOString();
		const vm = toAccountViewModel(
			{ tier: "trial", access: "full", banner: "trial-countdown", trialEndsAt },
			baseQuery,
			now,
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["subscribe"]);
		assert.equal(vm.actions[0].variant, "primary");
		assert.equal(vm.actions[0].method, "POST");
		assert.equal(vm.actions[0].href, "/account/subscribe?utm_source=account&utm_medium=internal&utm_content=subscribe");
	});

	it("inactive users get a primary subscribe action only (export lives in the nav menu)", () => {
		const vm = toAccountViewModel(
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "trial-expired" },
			baseQuery,
			now,
		);
		const keys = vm.actions.map((a) => a.key);
		assert.deepEqual(keys, ["subscribe"]);
		assert.equal(vm.actions[0].variant, "primary");
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
});

describe("withoutCommerce — iOS app surface (Guideline 3.1.1)", () => {
	const now = new Date();
	const baseQuery = { cancelling: false, errorPaymentMethod: false, deleteConfirmationError: false, cardError: undefined };

	it("hides the payment-methods section", () => {
		const web = toAccountViewModel({ tier: "paid", access: "full", banner: "none" }, baseQuery, now);
		assert.equal(web.showCardSection, true);
		assert.equal(withoutCommerce(web).showCardSection, false);
	});

	it("keeps the cancel control but routes it through ?platform=ios so its post-redirect keeps the surface", () => {
		const vm = withoutCommerce(
			toAccountViewModel({ tier: "paid", access: "full", banner: "none" }, baseQuery, now),
		);
		assert.deepEqual(
			vm.actions.map((a) => a.key),
			["cancel-form"],
		);
		assert.equal(
			vm.actions[0].href,
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form&platform=ios",
		);
	});

	it("strips the subscribe CTA on trial — no in-app purchase path", () => {
		const trialEndsAt = new Date(now.getTime() + 5 * ONE_DAY_MS).toISOString();
		const vm = withoutCommerce(
			toAccountViewModel(
				{ tier: "trial", access: "full", banner: "trial-countdown", trialEndsAt },
				baseQuery,
				now,
			),
		);
		assert.deepEqual(vm.actions, []);
	});

	it("strips the reactivate CTA in the cancellation-scheduled state", () => {
		const vm = withoutCommerce(
			toAccountViewModel(
				{
					tier: "paid",
					access: "full",
					banner: "cancellation-scheduled",
					cancellationEffectiveAt: "2026-06-22T10:00:00.000Z",
				},
				baseQuery,
				now,
			),
		);
		assert.deepEqual(vm.actions, []);
	});

	it("keeps the delete-account danger zone and routes it through ?platform=ios so a rejected delete re-renders commerce-free", () => {
		const vm = withoutCommerce(
			toAccountViewModel(
				{ tier: "inactive", access: "read-only", banner: "inactive", reason: "trial-expired" },
				baseQuery,
				now,
			),
		);
		assert.equal(vm.dangerAction.key, "delete-account");
		assert.equal(
			vm.dangerAction.href,
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account&platform=ios",
		);
		assert.deepEqual(vm.actions, []);
	});
});

describe("parseAccountQuery", () => {
	it("returns defaults for undefined query", () => {
		const result = parseAccountQuery(undefined);
		assert.deepEqual(result, {
			cancelling: false,
			errorPaymentMethod: false,
			deleteConfirmationError: false,
			cardError: undefined,
		});
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
});

describe("buildCardSectionViewModel", () => {
	it("no-customer state shows the start-subscription copy and no cards", () => {
		const vm = buildCardSectionViewModel({ kind: "no-customer" });
		assert.equal(vm.state, "no-customer");
		assert.equal(vm.stateClass, "account-cards account-cards--no-customer");
		assert.equal(vm.isLoaded, false);
		assert.match(vm.message, /start your subscription/);
		assert.deepEqual(vm.cards, []);
		assert.equal(vm.showAddButton, false);
	});

	it("provider-error state degrades to a retry message", () => {
		const vm = buildCardSectionViewModel({ kind: "provider-error" });
		assert.equal(vm.state, "provider-error");
		assert.equal(vm.isLoaded, false);
		assert.match(vm.message, /couldn't load your saved cards/);
	});

	it("loaded state badges the primary, gives it no actions, and gives backups promote + remove", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [
				savedCard("pm_primary", true, { brand: "mastercard", last4: "1111", expMonth: 3, expYear: 2027 }),
				savedCard("pm_backup", false),
			],
			publishableKey: "pk_test",
			cardError: undefined,
			adding: undefined,
		});

		assert.equal(vm.isLoaded, true);
		const [primary, backup] = vm.cards;
		assert.equal(primary.primaryTestAttr, "data-test-card-primary");
		assert.equal(primary.brandLabel, "Mastercard");
		assert.equal(primary.expLabel, "03/27");
		assert.deepEqual(primary.badges, [{ label: "Primary" }]);
		assert.deepEqual(primary.actions, []);

		assert.equal(backup.primaryTestAttr, "");
		assert.deepEqual(backup.badges, []);
		assert.deepEqual(
			backup.actions.map((a) => a.key),
			["promote", "remove"],
		);
		assert.equal(backup.actions[0].href, "/account/cards/pm_backup/primary");
		assert.equal(backup.actions[1].href, "/account/cards/pm_backup/remove");
		assert.equal(backup.actions[1].variant, "destructive");
	});

	it("shows the add button when there is room and a publishable key", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true)],
			publishableKey: "pk_test",
			cardError: undefined,
			adding: undefined,
		});
		assert.equal(vm.showAddButton, true);
		assert.equal(vm.showLimitHint, false);
	});

	it("hides the add button and shows the limit hint at the 3-card cap", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true), savedCard("pm_b", false), savedCard("pm_c", false)],
			publishableKey: "pk_test",
			cardError: undefined,
			adding: undefined,
		});
		assert.equal(vm.showAddButton, false);
		assert.equal(vm.showLimitHint, true);
	});

	it("hides the add button when there is no publishable key, even with room", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true)],
			publishableKey: undefined,
			cardError: undefined,
			adding: undefined,
		});
		assert.equal(vm.showAddButton, false);
	});

	it("surfaces the card_limit notice", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true)],
			publishableKey: "pk_test",
			cardError: "card_limit",
			adding: undefined,
		});
		assert.equal(vm.hasNotice, true);
		assert.match(vm.notice, /up to 3 cards/);
	});

	it("surfaces the add_card_failed notice", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true)],
			publishableKey: "pk_test",
			cardError: "add_card_failed",
			adding: undefined,
		});
		assert.equal(vm.hasNotice, true);
		assert.match(vm.notice, /couldn't start adding a card/);
	});

	it("surfaces the card_setup_failed notice", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true)],
			publishableKey: "pk_test",
			cardError: "card_setup_failed",
			adding: undefined,
		});
		assert.equal(vm.hasNotice, true);
		assert.match(vm.notice, /couldn't verify your new card, so it wasn't saved/);
	});

	it("surfaces the card_setup_unverified notice", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true)],
			publishableKey: "pk_test",
			cardError: "card_setup_unverified",
			adding: undefined,
		});
		assert.equal(vm.hasNotice, true);
		assert.match(vm.notice, /couldn't verify your new card just now/);
	});

	it("enters the adding state with the publishable key, client secret, and setup id", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true)],
			publishableKey: "pk_test",
			cardError: undefined,
			adding: { clientSecret: "seti_secret", setupId: "seti_x" },
		});
		assert.equal(vm.isAdding, true);
		assert.deepEqual(vm.adding, {
			publishableKey: "pk_test",
			clientSecret: "seti_secret",
			setupId: "seti_x",
		});
		assert.equal(vm.showAddButton, false);
	});

	it("cannot enter the adding state without a publishable key", () => {
		const vm = buildCardSectionViewModel({
			kind: "loaded",
			cards: [savedCard("pm_a", true)],
			publishableKey: undefined,
			cardError: undefined,
			adding: { clientSecret: "seti_secret", setupId: "seti_x" },
		});
		assert.equal(vm.isAdding, false);
		assert.equal(vm.adding, undefined);
	});
});
