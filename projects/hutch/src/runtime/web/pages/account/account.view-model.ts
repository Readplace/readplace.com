import { decomposeTimeLeft } from "@packages/time-left";
import { escapeRegExp } from "@packages/escape-regexp";
import type { SavedCard } from "@packages/provider-contracts/payment-methods";
import type { SubscriptionNextCharge } from "@packages/provider-contracts/subscription-billing";
import type { EffectiveAccess } from "@packages/subscription-access";
import {
	type LocalTime,
	SUBSCRIBE_CTA_LABEL,
	parsePollParam,
	toAbsoluteDate,
	withInternalTracking,
} from "@packages/web-shell";
import {
	APP_SHELL_QUERY,
	APP_SHELL_VALUE,
	PLATFORM_QUERY,
} from "../../onboarding/native-client";
import type { NativeClientPlatform } from "../../onboarding/native-client";
import { SUBSCRIBE_PLANS_POPOVER_ID } from "../../shared/subscribe-plans/subscribe-plans.component";
import {
	ACCOUNT_CANCEL_URL,
	ACCOUNT_CARDS_NEW_URL,
	ACCOUNT_DELETE_URL,
	ACCOUNT_REACTIVATE_URL,
	ACCOUNT_SUBSCRIBE_URL,
	buildAccountStatusPollUrl,
	buildCardPrimaryUrl,
	buildCardRemoveUrl,
} from "./account.url";
import {
	HIDDEN_NEXT_CHARGE,
	type NextChargeViewModel,
	buildNextChargeViewModel,
} from "./next-charge.view-model";

export const ACCOUNT_CANCEL_MAX_POLLS = 20;

/** Server-authoritative card cap. The web layer never trusts the client: every
 * add/remove/promote re-reads the live card set and re-checks these rules. */
export const MAX_CARDS = 3;

export const DELETE_ACCOUNT_CONFIRMATION_PHRASE = "delete my account permanently";
export const DELETE_ACCOUNT_CONFIRMATION_FIELD = "confirmation";

const DELETE_CONFIRMATION_NOTICE = `Your account was not deleted. Type "${DELETE_ACCOUNT_CONFIRMATION_PHRASE}" exactly to confirm.`;
const DELETE_CONFIRMATION_TITLE = `Type the phrase exactly: ${DELETE_ACCOUNT_CONFIRMATION_PHRASE}`;

const DELETE_CONFIRMATION_PATTERN = escapeRegExp(DELETE_ACCOUNT_CONFIRMATION_PHRASE);

export type AccountCardState =
	| "founding"
	| "active"
	| "trial"
	| "cancellation-scheduled"
	| "inactive"
	| "error-payment-method";

export type AccountActionKey = "subscribe" | "cancel-form" | "reactivate-form" | "delete-account";

export type AccountActionVariant = "primary" | "secondary" | "destructive";

export type AccountPollState = "polling" | "idle";

export interface AccountAction {
	key: AccountActionKey;
	name: string;
	variant: AccountActionVariant;
	buttonClass: string;
	method: "POST";
	href: string;
	isPending: boolean;
	popoverTarget?: string;
}

export interface DangerConfirmationViewModel {
	phrase: string;
	pattern: string;
	title: string;
	field: string;
	hasNotice: boolean;
	notice: string;
}

export interface AccountViewModel {
	state: AccountCardState;
	stateClass: string;
	heading: string;
	/** Leading sentence text. For the trial-countdown and cancellation-scheduled
	 * states this is only the text before the date — `statusDate`/`statusDateTail`
	 * carry the rest so the date renders as a localisable `<time>` element. */
	statusLine: string;
	statusDate?: LocalTime;
	statusDateTail?: string;
	/** Only the active state overrides this; every other state keeps the hidden value
	 * from `baseFor`, so a state cannot start announcing a charge by accident. */
	nextCharge: NextChargeViewModel;
	showCancellingNotice: boolean;
	cancellingNotice: string;
	pollState: AccountPollState;
	pollUrl?: string;
	stateIsErrorPaymentMethod: boolean;
	actions: AccountAction[];
	/** The irreversible "delete account" control. Kept out of the state-dependent
	 * `actions` array so the danger zone renders in every subscription state. */
	dangerAction: AccountAction;
	dangerConfirmation: DangerConfirmationViewModel;
	/** Whether the payment-methods section renders. False on the iOS app surface,
	 * where card management is hidden for App Store review Guideline 3.1.1. */
	showCardSection: boolean;
}

function formatTrialDaysLeft(trialEndsAt: string, now: Date): { daysLeft: number; daysLeftWord: "day" | "days" } {
	const remaining = new Date(trialEndsAt).getTime() - now.getTime();
	const timeLeft = decomposeTimeLeft(remaining);
	const hasRemainder = timeLeft.hours > 0 || timeLeft.minutes > 0 || timeLeft.seconds > 0;
	const daysLeft = Math.max(1, timeLeft.days + (hasRemainder ? 1 : 0));
	return { daysLeft, daysLeftWord: daysLeft === 1 ? "day" : "days" };
}

export type CardError =
	| "card_limit"
	| "cannot_remove_primary"
	| "add_card_failed"
	| "card_setup_failed"
	| "card_setup_unverified";

export interface AccountUrlState {
	cancelling: boolean;
	pollCount: number;
	errorPaymentMethod: boolean;
	deleteConfirmationError: boolean;
	cardError: CardError | undefined;
}

function parseCardError(error: unknown): CardError | undefined {
	if (error === "card_limit") return "card_limit";
	if (error === "cannot_remove_primary") return "cannot_remove_primary";
	if (error === "add_card_failed") return "add_card_failed";
	if (error === "card_setup_failed") return "card_setup_failed";
	if (error === "card_setup_unverified") return "card_setup_unverified";
	return undefined;
}

export function parseAccountQuery(query: Record<string, unknown> | undefined): AccountUrlState {
	return {
		cancelling: query?.cancelling === "1",
		pollCount: parsePollParam(query?.poll, ACCOUNT_CANCEL_MAX_POLLS),
		errorPaymentMethod: query?.error === "payment_method",
		deleteConfirmationError: query?.error === "delete_confirmation",
		cardError: parseCardError(query?.error),
	};
}

const ACCOUNT_ACTION_BUTTON_CLASS: Record<AccountActionVariant, string> = {
	primary: "btn btn--primary btn--compact account-card__action",
	secondary: "btn btn--secondary btn--compact account-card__action",
	destructive: "account-card__action account-card__action--destructive",
};

function action(input: Omit<AccountAction, "isPending" | "buttonClass">): AccountAction {
	return {
		...input,
		isPending: false,
		buttonClass: ACCOUNT_ACTION_BUTTON_CLASS[input.variant],
		href: withInternalTracking(input.href, { source: "account", content: input.key }),
	};
}

const SUBSCRIBE_ACTION = action({
	key: "subscribe",
	name: SUBSCRIBE_CTA_LABEL,
	variant: "primary",
	method: "POST",
	href: ACCOUNT_SUBSCRIBE_URL,
	popoverTarget: SUBSCRIBE_PLANS_POPOVER_ID,
});

const CANCEL_FORM_ACTION = action({
	key: "cancel-form",
	name: "Cancel subscription",
	variant: "destructive",
	method: "POST",
	href: ACCOUNT_CANCEL_URL,
});

const CANCEL_PENDING_ACTION: AccountAction = {
	...CANCEL_FORM_ACTION,
	name: "Cancelling…",
	isPending: true,
};

const REACTIVATE_FORM_ACTION = action({
	key: "reactivate-form",
	name: "Reactivate subscription",
	variant: "primary",
	method: "POST",
	href: ACCOUNT_REACTIVATE_URL,
});

const DELETE_ACCOUNT_ACTION = action({
	key: "delete-account",
	name: "Delete account",
	variant: "destructive",
	method: "POST",
	href: ACCOUNT_DELETE_URL,
});

export type CardSectionState = "no-customer" | "loaded" | "provider-error";

export type CardActionKey = "promote" | "remove";

export interface CardActionView {
	key: CardActionKey;
	name: string;
	variant: "secondary" | "destructive";
	buttonClass: string;
	href: string;
}

export interface CardViewItem {
	itemClass: string;
	/** Either "data-test-card-primary" or "" — interpolated raw into the row tag
	 * so the primary row is addressable without a per-item {{#if}} in the template. */
	primaryTestAttr: string;
	brandLabel: string;
	last4: string;
	expLabel: string;
	badges: { label: string }[];
	actions: CardActionView[];
}

export interface CardSectionViewModel {
	state: CardSectionState;
	stateClass: string;
	heading: string;
	isLoaded: boolean;
	message: string;
	hasNotice: boolean;
	notice: string;
	cards: CardViewItem[];
	showAddButton: boolean;
	addUrl: string;
	showLimitHint: boolean;
	limitHint: string;
	isAdding: boolean;
	adding: { publishableKey: string; clientSecret: string; setupId: string } | undefined;
}

export type CardSectionInput =
	| { kind: "no-customer" }
	| { kind: "provider-error" }
	| {
			kind: "loaded";
			cards: SavedCard[];
			publishableKey: string | undefined;
			cardError: CardError | undefined;
			adding: { clientSecret: string; setupId: string } | undefined;
		};

const CARD_NOTICES: Record<CardError, string> = {
	card_limit: "You can save up to 3 cards. Remove a backup before adding another.",
	cannot_remove_primary:
		"Your primary card can't be removed. Promote a backup to primary first, then remove it.",
	add_card_failed: "We couldn't start adding a card just now. Please try again.",
	card_setup_failed:
		"We couldn't verify your new card, so it wasn't saved. Please try adding it again.",
	card_setup_unverified:
		"We couldn't verify your new card just now. Refresh to check your saved cards, then try again.",
};

const NO_CUSTOMER_MESSAGE = "Add a payment method once you start your subscription.";
const PROVIDER_ERROR_MESSAGE =
	"We couldn't load your saved cards just now. Refresh the page to try again.";
const LIMIT_HINT = "You've reached the 3-card limit. Remove a backup to add a different card.";

function titleCaseBrand(brand: string): string {
	if (brand.length === 0) return brand;
	return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function formatExpiry(card: SavedCard): string {
	const month = String(card.expMonth).padStart(2, "0");
	const year = String(card.expYear % 100).padStart(2, "0");
	return `${month}/${year}`;
}

const CARD_ACTION_BUTTON_CLASS: Record<CardActionView["variant"], string> = {
	secondary: "btn btn--secondary btn--compact",
	destructive: "account-cards__action account-cards__action--destructive",
};

function cardAction(input: Omit<CardActionView, "buttonClass">): CardActionView {
	return { ...input, buttonClass: CARD_ACTION_BUTTON_CLASS[input.variant] };
}

function cardActions(card: SavedCard): CardActionView[] {
	if (card.isPrimary) return [];
	return [
		cardAction({ key: "promote", name: "Make primary", variant: "secondary", href: buildCardPrimaryUrl(card.id) }),
		cardAction({ key: "remove", name: "Remove", variant: "destructive", href: buildCardRemoveUrl(card.id) }),
	];
}

function toCardViewItem(card: SavedCard): CardViewItem {
	return {
		itemClass: `account-cards__item account-cards__item--${card.isPrimary ? "primary" : "backup"}`,
		primaryTestAttr: card.isPrimary ? "data-test-card-primary" : "",
		brandLabel: titleCaseBrand(card.brand),
		last4: card.last4,
		expLabel: formatExpiry(card),
		badges: card.isPrimary ? [{ label: "Primary" }] : [],
		actions: cardActions(card),
	};
}

function unavailableSection(
	state: "no-customer" | "provider-error",
	message: string,
): CardSectionViewModel {
	return {
		state,
		stateClass: `account-cards account-cards--${state}`,
		heading: "Payment methods",
		isLoaded: false,
		message,
		hasNotice: false,
		notice: "",
		cards: [],
		showAddButton: false,
		addUrl: ACCOUNT_CARDS_NEW_URL,
		showLimitHint: false,
		limitHint: "",
		isAdding: false,
		adding: undefined,
	};
}

export function buildCardSectionViewModel(input: CardSectionInput): CardSectionViewModel {
	if (input.kind === "no-customer") {
		return unavailableSection("no-customer", NO_CUSTOMER_MESSAGE);
	}
	if (input.kind === "provider-error") {
		return unavailableSection("provider-error", PROVIDER_ERROR_MESSAGE);
	}

	const canAddCard = input.cards.length < MAX_CARDS;
	const hasKey = input.publishableKey !== undefined && input.publishableKey.length > 0;
	const isAdding = input.adding !== undefined && hasKey;
	const notice = input.cardError ? CARD_NOTICES[input.cardError] : "";

	return {
		state: "loaded",
		stateClass: "account-cards account-cards--loaded",
		heading: "Payment methods",
		isLoaded: true,
		message: "",
		hasNotice: notice.length > 0,
		notice,
		cards: input.cards.map(toCardViewItem),
		// The add button only appears when there's room AND a publishable key to
		// drive Elements; without a key (local dev) the list/manage actions still render.
		showAddButton: canAddCard && hasKey && !isAdding,
		addUrl: ACCOUNT_CARDS_NEW_URL,
		showLimitHint: !canAddCard,
		limitHint: LIMIT_HINT,
		isAdding,
		adding:
			isAdding && input.adding !== undefined && input.publishableKey !== undefined
				? {
						publishableKey: input.publishableKey,
						clientSecret: input.adding.clientSecret,
						setupId: input.adding.setupId,
					}
				: undefined,
	};
}

type AccountCardBase = Omit<
	AccountViewModel,
	"dangerConfirmation" | "statusLine" | "statusDate" | "statusDateTail"
>;

function baseFor(state: AccountCardState, actions: AccountAction[]): AccountCardBase {
	return {
		state,
		stateClass: `account-card account-card--${state}`,
		heading: "Account",
		nextCharge: HIDDEN_NEXT_CHARGE,
		showCancellingNotice: false,
		cancellingNotice: "",
		pollState: "idle",
		stateIsErrorPaymentMethod: false,
		actions,
		dangerAction: DELETE_ACCOUNT_ACTION,
		showCardSection: true,
	};
}

export function toAccountViewModel(
	access: EffectiveAccess,
	queryState: AccountUrlState,
	now: Date,
	nextCharge?: SubscriptionNextCharge,
): AccountViewModel {
	return {
		...stateViewModel(access, queryState, now, nextCharge),
		dangerConfirmation: {
			phrase: DELETE_ACCOUNT_CONFIRMATION_PHRASE,
			pattern: DELETE_CONFIRMATION_PATTERN,
			title: DELETE_CONFIRMATION_TITLE,
			field: DELETE_ACCOUNT_CONFIRMATION_FIELD,
			hasNotice: queryState.deleteConfirmationError,
			notice: DELETE_CONFIRMATION_NOTICE,
		},
	};
}

const CANCELLING_NOTICE = "Cancellation in progress.";
const CANCELLING_STALLED_NOTICE = "Cancellation is taking longer than usual. Refresh to check.";

function cancellingViewModel(queryState: AccountUrlState): AccountCardBase & { statusLine: string } {
	const canPoll = queryState.pollCount < ACCOUNT_CANCEL_MAX_POLLS;
	return {
		...baseFor("active", [CANCEL_PENDING_ACTION]),
		statusLine: "Subscription: Active.",
		showCancellingNotice: true,
		cancellingNotice: canPoll ? CANCELLING_NOTICE : CANCELLING_STALLED_NOTICE,
		pollState: canPoll ? "polling" : "idle",
		pollUrl: canPoll ? buildAccountStatusPollUrl(queryState.pollCount + 1) : undefined,
	};
}

function stateViewModel(
	access: EffectiveAccess,
	queryState: AccountUrlState,
	now: Date,
	nextCharge: SubscriptionNextCharge | undefined,
): Omit<AccountViewModel, "dangerConfirmation"> {
	// Payment-method error takes priority over every underlying state — the user
	// just bounced off Stripe's create-subscription endpoint.
	if (queryState.errorPaymentMethod) {
		return {
			...baseFor("error-payment-method", []),
			statusLine: "We couldn't restart your subscription.",
			stateIsErrorPaymentMethod: true,
		};
	}

	switch (access.banner) {
		case "none":
			if (access.tier === "founding") {
				return {
					...baseFor("founding", []),
					statusLine: "You're a founding member — free for life.",
				};
			}
			if (queryState.cancelling) return cancellingViewModel(queryState);
			return {
				...baseFor("active", [CANCEL_FORM_ACTION]),
				statusLine: "Subscription: Active.",
				nextCharge: buildNextChargeViewModel({ nextCharge, now }),
			};
		case "trial-countdown": {
			const trialEndsAt = access.trialEndsAt;
			const { daysLeft, daysLeftWord } = formatTrialDaysLeft(trialEndsAt, now);
			return {
				...baseFor("trial", [SUBSCRIBE_ACTION]),
				statusLine: "Your free trial ends on ",
				statusDate: toAbsoluteDate({ iso: trialEndsAt }),
				statusDateTail: ` — ${daysLeft} ${daysLeftWord} left.`,
			};
		}
		case "cancellation-scheduled":
			return {
				...baseFor("cancellation-scheduled", [REACTIVATE_FORM_ACTION]),
				statusLine: "Your subscription ends on ",
				statusDate: toAbsoluteDate({ iso: access.cancellationEffectiveAt }),
				statusDateTail: ".",
			};
		case "inactive":
			return {
				...baseFor("inactive", [SUBSCRIBE_ACTION]),
				statusLine: "Subscription not active.",
			};
	}
}

/** Origin for parsing root-relative action hrefs; `.invalid` is reserved by RFC
 * 2606 so it can never resolve, and only `pathname`/`search` are read back. */
const APP_HREF_PARSE_ORIGIN = "https://internal.invalid";

interface AppSurfaceOptions {
	appShell: boolean;
	/** Absent when the request named no platform — a shell-only build. Stamping a
	 * guessed one would send its POSTs to another app's surface, so the href
	 * carries only what the request actually declared. */
	platform: NativeClientPlatform | undefined;
}

function carryAppSurfaceHref(href: string, options: AppSurfaceOptions): string {
	const url = new URL(href, APP_HREF_PARSE_ORIGIN);
	if (options.platform) url.searchParams.set(PLATFORM_QUERY, options.platform);
	if (options.appShell) url.searchParams.set(APP_SHELL_QUERY, APP_SHELL_VALUE);
	return `${url.pathname}${url.search}`;
}

function carryAppSurface(action: AccountAction, options: AppSurfaceOptions): AccountAction {
	return { ...action, href: carryAppSurfaceHref(action.href, options) };
}

/** Rewrites the account view model for the iOS app's in-app web surface: strips
 * every in-app purchase path — the subscribe and reactivate CTAs and the whole
 * payment-methods section — so the build satisfies App Store review Guideline
 * 3.1.1. Kept: the subscription status line, the cancel control, and the
 * delete-account danger zone (Apple requires in-app account deletion; cancelling
 * buys nothing). Every surviving control — the cancel control and the
 * delete-account danger action — carries the request's own surface markers on its
 * href so a POST lands on e.g. /account/cancel?platform=ios (or
 * /account/delete?platform=ios&shell=app) and its post-redirect GET re-renders this
 * same surface — the WKWebView form post sends no client header, so a
 * server-rejected delete confirmation stays commerce-free (and, in the app shell,
 * chromeless) instead of bouncing to the web surface. Commerce-stripping itself is
 * keyed on the iOS surface, not the app shell: a store build predating the shell
 * marker must keep satisfying Guideline 3.1.1. */
export function withoutCommerce(
	vm: AccountViewModel,
	options: AppSurfaceOptions,
): AccountViewModel {
	return {
		...vm,
		actions: vm.actions
			.filter((a) => a.key !== "subscribe" && a.key !== "reactivate-form")
			.map((a) => carryAppSurface(a, options)),
		dangerAction: carryAppSurface(vm.dangerAction, options),
		pollUrl: vm.pollUrl === undefined ? undefined : carryAppSurfaceHref(vm.pollUrl, options),
		/** Naming a price is the part of this page Guideline 3.1.1 objects to, so the
		 * renewal line is stripped here rather than relying on the route happening not
		 * to load one. */
		nextCharge: HIDDEN_NEXT_CHARGE,
		showCardSection: false,
	};
}
