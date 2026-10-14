import { decomposeTimeLeft } from "@packages/time-left";
import { escapeRegExp } from "@packages/escape-regexp";
import {
	APPEARANCE_PREFERENCES,
	type AppearancePreference,
	DISPLAY_NAME_MAX_LENGTH,
	type DisplayName,
} from "@packages/domain/user";
import type { SavedCard } from "@packages/provider-contracts/payment-methods";
import type { BillingPlan } from "@packages/provider-contracts/subscription-providers";
import type { SubscriptionNextCharge } from "@packages/provider-contracts/subscription-billing";
import type { EffectiveAccess } from "@packages/subscription-access";
import type { IconName } from "@packages/ui-icons";
import {
	type LocalTime,
	PRICING_PLANS,
	SUBSCRIBE_CTA_LABEL,
	initialsFor,
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
import {
	SUBSCRIBE_PLANS_POPOVER_ID,
	planChargedWithoutChoice,
} from "../../shared/subscribe-plans/subscribe-plans.component";
import {
	ACCOUNT_APPEARANCE_URL,
	ACCOUNT_CANCEL_URL,
	ACCOUNT_CARDS_CONFIRM_URL,
	ACCOUNT_CARDS_NEW_URL,
	ACCOUNT_DELETE_URL,
	ACCOUNT_INVOICES_URL,
	ACCOUNT_PROFILE_URL,
	ACCOUNT_REACTIVATE_URL,
	ACCOUNT_SUBSCRIBE_URL,
	buildAccountStatusPollUrl,
	buildAccountUrl,
	buildCardPrimaryUrl,
	buildCardRemoveUrl,
} from "./account.url";
import {
	HIDDEN_NEXT_CHARGE,
	type NextChargeViewModel,
	buildNextChargeViewModel,
} from "./next-charge.view-model";

const ACCOUNT_SOURCE = "account";

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
	| "error-payment-method"
	| "error-subscribe-failed";

export type AccountActionKey =
	| "subscribe"
	| "cancel-form"
	| "reactivate-form"
	| "delete-account"
	| "manage-subscription"
	| "update-payment"
	| "view-invoices"
	| "done";

export type AccountActionVariant = "primary" | "secondary" | "neutral" | "destructive";

export type AccountPollState = "polling" | "idle";

export interface AccountHiddenField {
	name: string;
	value: string;
}

export interface AccountAction {
	key: AccountActionKey;
	name: string;
	variant: AccountActionVariant;
	buttonClass: string;
	method: "GET" | "POST";
	href: string;
	hiddenFields: AccountHiddenField[];
	leadingIcon: IconName | undefined;
	trailingIcon: IconName | undefined;
	isPending: boolean;
	popoverTarget?: string;
}

export interface AccountChip {
	label: string;
	className: string;
}

export interface DangerConfirmationViewModel {
	phrase: string;
	pattern: string;
	title: string;
	field: string;
	hasNotice: boolean;
	notice: string;
}

export type ManagePanelState = "open" | "closed";

export interface PriceViewModel {
	state: "visible" | "hidden";
	text: string;
}

export interface ManagePanelViewModel {
	state: ManagePanelState;
	body: string;
	actions: AccountAction[];
	showCancellingNotice: boolean;
	cancellingNotice: string;
}

export type CardActionKey = "promote" | "remove";

export interface CardActionView {
	key: CardActionKey;
	name: string;
	variant: "toggle" | "destructive";
	buttonClass: string;
	href: string;
}

export interface CardViewItem {
	tileLabel: string;
	title: string;
	expiry: string;
	actions: CardActionView[];
}

export type PaymentSectionState = "card" | "no-card" | "provider-error" | "hidden";

export interface PaymentPanelViewModel {
	state: ManagePanelState;
	hasNotice: boolean;
	notice: string;
	backups: CardViewItem[];
	hint: string;
	showAddButton: boolean;
	showLimitHint: boolean;
	limitHint: string;
	isAdding: boolean;
	adding: { publishableKey: string; clientSecret: string; setupId: string } | undefined;
}

export interface PaymentSectionViewModel {
	state: PaymentSectionState;
	isShown: boolean;
	primary: { tileLabel: string; title: string; expiry: string; chips: AccountChip[] } | undefined;
	noCard: { title: string; line: string } | undefined;
	actions: AccountAction[];
	showRowAddForm: boolean;
	addUrl: string;
	confirmUrl: string;
	cancelAddUrl: string;
	isError: boolean;
	message: string;
	panel: PaymentPanelViewModel;
}

export interface BillingHistoryViewModel {
	state: "visible" | "hidden";
	isVisible: boolean;
	actions: AccountAction[];
}

export interface AccountViewModel {
	state: AccountCardState;
	stateClass: string;
	heading: string;
	lede: string;
	subscriptionHeading: string;
	title: string;
	chips: AccountChip[];
	price: PriceViewModel;
	/** Leading sentence text. For the trial-countdown and cancellation-scheduled
	 * states this is only the text before the date — `statusDate`/`statusDateTail`
	 * carry the rest so the date renders as a localisable `<time>` element. */
	statusLine: string;
	statusDate?: LocalTime;
	statusDateTail?: string;
	/** Only the active state overrides this; every other state keeps the hidden value
	 * from `baseFor`, so a state cannot start announcing a charge by accident. */
	nextCharge: NextChargeViewModel;
	managePanel: ManagePanelViewModel;
	pollState: AccountPollState;
	pollUrl?: string;
	stateIsErrorPaymentMethod: boolean;
	stateIsErrorSubscribeFailed: boolean;
	actions: AccountAction[];
	checkedPlan: BillingPlan;
	/** The irreversible "delete account" control. Kept out of the state-dependent
	 * `actions` array so the danger zone renders in every subscription state. */
	dangerAction: AccountAction;
	dangerConfirmation: DangerConfirmationViewModel;
	payment: PaymentSectionViewModel;
	billingHistory: BillingHistoryViewModel;
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

export type AccountManage = "subscription" | "payment" | undefined;

export interface AccountUrlState {
	cancelling: boolean;
	pollCount: number;
	errorPaymentMethod: boolean;
	errorSubscribeFailed: boolean;
	deleteConfirmationError: boolean;
	cardError: CardError | undefined;
	manage: AccountManage;
}

function parseCardError(error: unknown): CardError | undefined {
	if (error === "card_limit") return "card_limit";
	if (error === "cannot_remove_primary") return "cannot_remove_primary";
	if (error === "add_card_failed") return "add_card_failed";
	if (error === "card_setup_failed") return "card_setup_failed";
	if (error === "card_setup_unverified") return "card_setup_unverified";
	return undefined;
}

function parseManage(manage: unknown): AccountManage {
	if (manage === "subscription") return "subscription";
	if (manage === "payment") return "payment";
	return undefined;
}

export function parseAccountQuery(query: Record<string, unknown> | undefined): AccountUrlState {
	return {
		cancelling: query?.cancelling === "1",
		pollCount: parsePollParam(query?.poll, ACCOUNT_CANCEL_MAX_POLLS),
		errorPaymentMethod: query?.error === "payment_method",
		errorSubscribeFailed: query?.error === "subscribe_failed",
		deleteConfirmationError: query?.error === "delete_confirmation",
		cardError: parseCardError(query?.error),
		manage: parseManage(query?.manage),
	};
}

const ACCOUNT_ACTION_BUTTON_CLASS: Record<AccountActionVariant, string> = {
	primary: "btn btn--primary btn--m",
	secondary: "btn btn--secondary btn--m",
	neutral: "btn btn--neutral btn--m",
	destructive: "btn btn--destructive btn--m",
};

/** Origin for parsing root-relative action hrefs; `.invalid` is reserved by RFC
 * 2606 so it can never resolve, and only `pathname`/`search` are read back. */
const APP_HREF_PARSE_ORIGIN = "https://internal.invalid";

type ActionInput = Omit<AccountAction, "isPending" | "buttonClass" | "method" | "hiddenFields">;

function postAction(input: ActionInput): AccountAction {
	return {
		...input,
		method: "POST",
		isPending: false,
		buttonClass: ACCOUNT_ACTION_BUTTON_CLASS[input.variant],
		href: withInternalTracking(input.href, { source: ACCOUNT_SOURCE, content: input.key }),
		hiddenFields: [],
	};
}

function getAction(input: ActionInput & { fields: AccountHiddenField[] }): AccountAction {
	const { fields, ...rest } = input;
	const tracked = new URL(
		withInternalTracking(input.href, { source: ACCOUNT_SOURCE, content: input.key }),
		APP_HREF_PARSE_ORIGIN,
	);
	return {
		...rest,
		method: "GET",
		isPending: false,
		buttonClass: ACCOUNT_ACTION_BUTTON_CLASS[input.variant],
		href: tracked.pathname,
		hiddenFields: [...Array.from(tracked.searchParams, ([name, value]) => ({ name, value })), ...fields],
	};
}

const SUBSCRIBE_ACTION = postAction({
	key: "subscribe",
	name: SUBSCRIBE_CTA_LABEL,
	variant: "primary",
	href: ACCOUNT_SUBSCRIBE_URL,
	leadingIcon: undefined,
	trailingIcon: undefined,
	popoverTarget: SUBSCRIBE_PLANS_POPOVER_ID,
});

const CANCEL_FORM_ACTION = postAction({
	key: "cancel-form",
	name: "Cancel subscription",
	variant: "destructive",
	href: ACCOUNT_CANCEL_URL,
	leadingIcon: undefined,
	trailingIcon: undefined,
});

const CANCEL_PENDING_ACTION: AccountAction = {
	...CANCEL_FORM_ACTION,
	name: "Cancelling…",
	isPending: true,
};

const REACTIVATE_FORM_ACTION = postAction({
	key: "reactivate-form",
	name: "Reactivate subscription",
	variant: "primary",
	href: ACCOUNT_REACTIVATE_URL,
	leadingIcon: undefined,
	trailingIcon: undefined,
});

const DELETE_ACCOUNT_ACTION = postAction({
	key: "delete-account",
	name: "Delete account",
	variant: "destructive",
	href: ACCOUNT_DELETE_URL,
	leadingIcon: undefined,
	trailingIcon: undefined,
});

const MANAGE_SUBSCRIPTION_ACTION = getAction({
	key: "manage-subscription",
	name: "Manage subscription",
	variant: "primary",
	href: buildAccountUrl(),
	fields: [{ name: "manage", value: "subscription" }],
	leadingIcon: undefined,
	trailingIcon: undefined,
});

const UPDATE_PAYMENT_ACTION = getAction({
	key: "update-payment",
	name: "Update payment method",
	variant: "neutral",
	href: buildAccountUrl(),
	fields: [{ name: "manage", value: "payment" }],
	leadingIcon: "pencil",
	trailingIcon: undefined,
});

const VIEW_INVOICES_ACTION = getAction({
	key: "view-invoices",
	name: "View invoices",
	variant: "neutral",
	href: ACCOUNT_INVOICES_URL,
	fields: [],
	leadingIcon: undefined,
	trailingIcon: "chevron-right",
});

const DONE_ACTION = getAction({
	key: "done",
	name: "Done",
	variant: "neutral",
	href: buildAccountUrl(),
	fields: [],
	leadingIcon: undefined,
	trailingIcon: undefined,
});

const ACTIVE_CHIP: AccountChip = { label: "Active", className: "chip chip--status chip--success" };
const CANCELLED_CHIP: AccountChip = { label: "Cancelled", className: "chip chip--status chip--error" };
const INACTIVE_CHIP: AccountChip = { label: "Inactive", className: "chip chip--status chip--error" };
const PRIMARY_CARD_CHIP: AccountChip = { label: "Primary", className: "chip chip--badge chip--accent" };

const HIDDEN_PRICE: PriceViewModel = { state: "hidden", text: "" };

const MANAGE_SUBSCRIPTION_BODY =
	"Cancelling stops your next payment. You keep full access until the end of the period you've paid for.";

const CLOSED_MANAGE_PANEL: ManagePanelViewModel = {
	state: "closed",
	body: "",
	actions: [],
	showCancellingNotice: false,
	cancellingNotice: "",
};

const OPEN_MANAGE_PANEL: ManagePanelViewModel = {
	state: "open",
	body: MANAGE_SUBSCRIPTION_BODY,
	actions: [CANCEL_FORM_ACTION],
	showCancellingNotice: false,
	cancellingNotice: "",
};

export type PaymentSectionInput =
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

const PROVIDER_ERROR_MESSAGE =
	"We couldn't load your saved cards just now. Refresh the page to try again.";
const LIMIT_HINT = "You've reached the 3-card limit. Remove a backup to add a different card.";
const BACKUP_CARD_HINT =
	"A new card is added as a backup. Make it primary to pay with it from your next payment.";

const NO_CARD_ROW = { title: "No card on file", line: "Add a card to keep your plan running." };
const NO_PRIMARY_CARD_ROW = {
	title: "No primary card",
	line: "Make one of your saved cards primary to keep your plan running.",
};

const CARD_BRAND_LABELS: Record<string, { tile: string; name: string }> = {
	visa: { tile: "VISA", name: "Visa" },
	mastercard: { tile: "MASTERCARD", name: "Mastercard" },
	amex: { tile: "AMEX", name: "American Express" },
	discover: { tile: "DISCOVER", name: "Discover" },
	diners: { tile: "DINERS", name: "Diners Club" },
	jcb: { tile: "JCB", name: "JCB" },
	unionpay: { tile: "UNIONPAY", name: "UnionPay" },
	eftpos_au: { tile: "EFTPOS", name: "eftpos" },
};

const UNKNOWN_CARD_BRAND = { tile: "CARD", name: "Card" };

function cardBrandLabel(brand: string): { tile: string; name: string } {
	return Object.hasOwn(CARD_BRAND_LABELS, brand) ? CARD_BRAND_LABELS[brand] : UNKNOWN_CARD_BRAND;
}

function formatExpiry(card: SavedCard): string {
	const month = String(card.expMonth).padStart(2, "0");
	const year = String(card.expYear % 100).padStart(2, "0");
	return `${month}/${year}`;
}

const CARD_ACTION_BUTTON_CLASS: Record<CardActionView["variant"], string> = {
	toggle: "btn btn--secondary btn--s",
	destructive: "btn btn--destructive btn--s",
};

function cardAction(input: Omit<CardActionView, "buttonClass">): CardActionView {
	return {
		...input,
		buttonClass: CARD_ACTION_BUTTON_CLASS[input.variant],
		href: withInternalTracking(input.href, { source: ACCOUNT_SOURCE, content: `${input.key}-card` }),
	};
}

function cardActions(card: SavedCard): CardActionView[] {
	if (card.isPrimary) return [];
	return [
		cardAction({ key: "promote", name: "Make primary", variant: "toggle", href: buildCardPrimaryUrl(card.id) }),
		cardAction({ key: "remove", name: "Remove", variant: "destructive", href: buildCardRemoveUrl(card.id) }),
	];
}

const ADD_CARD_URL = withInternalTracking(ACCOUNT_CARDS_NEW_URL, {
	source: ACCOUNT_SOURCE,
	content: "add-card",
});

const CONFIRM_CARD_URL = withInternalTracking(ACCOUNT_CARDS_CONFIRM_URL, {
	source: ACCOUNT_SOURCE,
	content: "save-card",
});

const CANCEL_ADD_CARD_URL = withInternalTracking(buildAccountUrl({ manage: "payment" }), {
	source: ACCOUNT_SOURCE,
	content: "cancel-add-card",
});

function toCardViewItem(card: SavedCard): CardViewItem {
	const brand = cardBrandLabel(card.brand);
	return {
		tileLabel: brand.tile,
		title: `${brand.name} •••• ${card.last4}`,
		expiry: `Expires ${formatExpiry(card)}`,
		actions: cardActions(card),
	};
}

const CLOSED_PAYMENT_PANEL: PaymentPanelViewModel = {
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

function unavailableSection(state: "hidden" | "provider-error"): PaymentSectionViewModel {
	return {
		state,
		isShown: state !== "hidden",
		primary: undefined,
		noCard: undefined,
		actions: [],
		showRowAddForm: false,
		addUrl: ADD_CARD_URL,
		confirmUrl: CONFIRM_CARD_URL,
		cancelAddUrl: CANCEL_ADD_CARD_URL,
		isError: state === "provider-error",
		message: state === "provider-error" ? PROVIDER_ERROR_MESSAGE : "",
		panel: CLOSED_PAYMENT_PANEL,
	};
}

export function buildPaymentSectionViewModel(
	input: PaymentSectionInput,
	manage: AccountManage,
): PaymentSectionViewModel {
	if (input.kind === "no-customer") {
		return unavailableSection("hidden");
	}
	if (input.kind === "provider-error") {
		return unavailableSection("provider-error");
	}

	const primaryCard = input.cards.find((card) => card.isPrimary);
	const canAddCard = input.cards.length < MAX_CARDS;
	const hasKey = input.publishableKey !== undefined && input.publishableKey.length > 0;
	const isAdding = input.adding !== undefined && hasKey;
	const notice = input.cardError ? CARD_NOTICES[input.cardError] : "";
	const isOpen = manage === "payment" || input.cardError !== undefined || isAdding;

	const panel: PaymentPanelViewModel = isOpen
		? {
				state: "open",
				hasNotice: notice.length > 0,
				notice,
				backups: input.cards.filter((card) => !card.isPrimary).map(toCardViewItem),
				hint: BACKUP_CARD_HINT,
				// The add button only appears when there's room AND a publishable key to
				// drive Elements; without a key (local dev) the list/manage actions still render.
				showAddButton: canAddCard && hasKey && !isAdding,
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
			}
		: CLOSED_PAYMENT_PANEL;

	const primaryView = primaryCard === undefined ? undefined : toCardViewItem(primaryCard);
	const hasSavedCards = input.cards.length > 0;
	const closedRowActions = hasSavedCards ? [UPDATE_PAYMENT_ACTION] : [];

	return {
		state: primaryView === undefined ? "no-card" : "card",
		isShown: true,
		primary:
			primaryView === undefined
				? undefined
				: {
						tileLabel: primaryView.tileLabel,
						title: primaryView.title,
						expiry: primaryView.expiry,
						chips: [PRIMARY_CARD_CHIP],
					},
		noCard: primaryView !== undefined ? undefined : hasSavedCards ? NO_PRIMARY_CARD_ROW : NO_CARD_ROW,
		actions: isOpen ? [DONE_ACTION] : closedRowActions,
		showRowAddForm: !hasSavedCards && !isOpen && hasKey,
		addUrl: ADD_CARD_URL,
		confirmUrl: CONFIRM_CARD_URL,
		cancelAddUrl: CANCEL_ADD_CARD_URL,
		isError: false,
		message: "",
		panel,
	};
}

const HIDDEN_BILLING_HISTORY: BillingHistoryViewModel = {
	state: "hidden",
	isVisible: false,
	actions: [],
};

const VISIBLE_BILLING_HISTORY: BillingHistoryViewModel = {
	state: "visible",
	isVisible: true,
	actions: [VIEW_INVOICES_ACTION],
};

function planTitle(plan: BillingPlan | undefined): string {
	return plan === undefined ? "Subscription" : PRICING_PLANS[plan].summaryName;
}

function planPrice(plan: BillingPlan | undefined): PriceViewModel {
	return plan === undefined
		? HIDDEN_PRICE
		: { state: "visible", text: PRICING_PLANS[plan].cadenceDisplay };
}

type AccountCardBase = Omit<
	AccountViewModel,
	| "dangerConfirmation"
	| "checkedPlan"
	| "statusLine"
	| "statusDate"
	| "statusDateTail"
	| "payment"
	| "billingHistory"
>;

function baseFor(input: {
	state: AccountCardState;
	title: string;
	chips: AccountChip[];
	actions: AccountAction[];
}): AccountCardBase {
	return {
		state: input.state,
		stateClass: `account-card account-card--${input.state}`,
		heading: "Account",
		lede: "Manage your account, billing and preferences.",
		subscriptionHeading: "Subscription & billing",
		title: input.title,
		chips: input.chips,
		price: HIDDEN_PRICE,
		nextCharge: HIDDEN_NEXT_CHARGE,
		managePanel: CLOSED_MANAGE_PANEL,
		pollState: "idle",
		stateIsErrorPaymentMethod: false,
		stateIsErrorSubscribeFailed: false,
		actions: input.actions,
		dangerAction: DELETE_ACCOUNT_ACTION,
	};
}

export function toAccountViewModel(input: {
	access: EffectiveAccess;
	queryState: AccountUrlState;
	now: Date;
	nextCharge: SubscriptionNextCharge | undefined;
	plan: BillingPlan | undefined;
	hasCustomer: boolean;
	payment: PaymentSectionInput;
}): AccountViewModel {
	return {
		...stateViewModel(input),
		checkedPlan: planChargedWithoutChoice(input.access),
		dangerConfirmation: {
			phrase: DELETE_ACCOUNT_CONFIRMATION_PHRASE,
			pattern: DELETE_CONFIRMATION_PATTERN,
			title: DELETE_CONFIRMATION_TITLE,
			field: DELETE_ACCOUNT_CONFIRMATION_FIELD,
			hasNotice: input.queryState.deleteConfirmationError,
			notice: DELETE_CONFIRMATION_NOTICE,
		},
		payment: buildPaymentSectionViewModel(input.payment, input.queryState.manage),
		billingHistory: input.hasCustomer ? VISIBLE_BILLING_HISTORY : HIDDEN_BILLING_HISTORY,
	};
}

const CANCELLING_NOTICE = "Cancellation in progress.";
const CANCELLING_STALLED_NOTICE = "Cancellation is taking longer than usual. Refresh to check.";

function cancellingViewModel(
	queryState: AccountUrlState,
	plan: BillingPlan | undefined,
): AccountCardBase & { statusLine: string } {
	const canPoll = queryState.pollCount < ACCOUNT_CANCEL_MAX_POLLS;
	return {
		...baseFor({ state: "active", title: planTitle(plan), chips: [ACTIVE_CHIP], actions: [] }),
		price: planPrice(plan),
		statusLine: "",
		managePanel: {
			state: "open",
			body: MANAGE_SUBSCRIPTION_BODY,
			actions: [CANCEL_PENDING_ACTION],
			showCancellingNotice: true,
			cancellingNotice: canPoll ? CANCELLING_NOTICE : CANCELLING_STALLED_NOTICE,
		},
		pollState: canPoll ? "polling" : "idle",
		pollUrl: canPoll ? buildAccountStatusPollUrl(queryState.pollCount + 1) : undefined,
	};
}

function stateViewModel(input: {
	access: EffectiveAccess;
	queryState: AccountUrlState;
	now: Date;
	nextCharge: SubscriptionNextCharge | undefined;
	plan: BillingPlan | undefined;
}): Omit<AccountViewModel, "dangerConfirmation" | "checkedPlan" | "payment" | "billingHistory"> {
	const { access, queryState, now, nextCharge, plan } = input;
	// Payment-method error takes priority over every underlying state — the user
	// just bounced off Stripe's create-subscription endpoint.
	if (queryState.errorPaymentMethod) {
		return {
			...baseFor({ state: "error-payment-method", title: planTitle(plan), chips: [], actions: [] }),
			statusLine: "",
			stateIsErrorPaymentMethod: true,
		};
	}

	if (queryState.errorSubscribeFailed) {
		return {
			...baseFor({
				state: "error-subscribe-failed",
				title: "Subscription",
				chips: [],
				actions: [SUBSCRIBE_ACTION],
			}),
			statusLine: "",
			stateIsErrorSubscribeFailed: true,
		};
	}

	switch (access.banner) {
		case "none": {
			if (access.tier === "founding") {
				return {
					...baseFor({ state: "founding", title: "Founding member", chips: [], actions: [] }),
					statusLine: "Free for life.",
				};
			}
			if (queryState.cancelling) return cancellingViewModel(queryState, plan);
			const managing = queryState.manage === "subscription";
			return {
				...baseFor({
					state: "active",
					title: planTitle(plan),
					chips: [ACTIVE_CHIP],
					actions: [managing ? DONE_ACTION : MANAGE_SUBSCRIPTION_ACTION],
				}),
				price: planPrice(plan),
				statusLine: "",
				nextCharge: buildNextChargeViewModel({ nextCharge, now }),
				managePanel: managing ? OPEN_MANAGE_PANEL : CLOSED_MANAGE_PANEL,
			};
		}
		case "trial-countdown": {
			const trialEndsAt = access.trialEndsAt;
			const { daysLeft, daysLeftWord } = formatTrialDaysLeft(trialEndsAt, now);
			return {
				...baseFor({ state: "trial", title: "Free trial", chips: [], actions: [SUBSCRIBE_ACTION] }),
				statusLine: "Your free trial ends on ",
				statusDate: toAbsoluteDate({ iso: trialEndsAt }),
				statusDateTail: ` — ${daysLeft} ${daysLeftWord} left.`,
			};
		}
		case "cancellation-scheduled":
			return {
				...baseFor({
					state: "cancellation-scheduled",
					title: planTitle(plan),
					chips: [CANCELLED_CHIP],
					actions: [REACTIVATE_FORM_ACTION],
				}),
				statusLine: "Your subscription ends on ",
				statusDate: toAbsoluteDate({ iso: access.cancellationEffectiveAt }),
				statusDateTail: ".",
			};
		case "inactive":
			return {
				...baseFor({
					state: "inactive",
					title: "Subscription",
					chips: [INACTIVE_CHIP],
					actions: [SUBSCRIBE_ACTION],
				}),
				statusLine: "",
			};
	}
}

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

function appSurfaceFields(options: AppSurfaceOptions): AccountHiddenField[] {
	const url = new URL(carryAppSurfaceHref("/", options), APP_HREF_PARSE_ORIGIN);
	return Array.from(url.searchParams, ([name, value]) => ({ name, value }));
}

const CARRY_APP_SURFACE: Record<
	AccountAction["method"],
	(action: AccountAction, options: AppSurfaceOptions) => AccountAction
> = {
	POST: (action, options) => ({ ...action, href: carryAppSurfaceHref(action.href, options) }),
	GET: (action, options) => ({
		...action,
		hiddenFields: [...action.hiddenFields, ...appSurfaceFields(options)],
	}),
};

function carryAppSurface(action: AccountAction, options: AppSurfaceOptions): AccountAction {
	return CARRY_APP_SURFACE[action.method](action, options);
}

function withoutPurchaseActions(actions: AccountAction[], options: AppSurfaceOptions): AccountAction[] {
	return actions
		.filter((a) => a.key !== "subscribe" && a.key !== "reactivate-form")
		.map((a) => carryAppSurface(a, options));
}

export interface AppearanceOptionView {
	value: AppearancePreference;
	label: string;
	active: boolean;
	ariaPressed: "true" | "false";
}

export interface AppearanceSectionViewModel {
	formAction: string;
	options: AppearanceOptionView[];
}

const APPEARANCE_LABELS: Record<AppearancePreference, string> = {
	system: "Auto",
	light: "Light",
	dark: "Dark",
};

const APPEARANCE_OPTION_POSITION: Record<AppearancePreference, number> = {
	light: 0,
	dark: 1,
	system: 2,
};

export function buildAppearanceSection(input: {
	current: AppearancePreference;
	appShell: boolean;
	platform: NativeClientPlatform | undefined;
}): AppearanceSectionViewModel {
	return {
		formAction: withInternalTracking(
			carryAppSurfaceHref(ACCOUNT_APPEARANCE_URL, {
				appShell: input.appShell,
				platform: input.platform,
			}),
			{ source: ACCOUNT_SOURCE, content: "appearance" },
		),
		options: [...APPEARANCE_PREFERENCES]
			.sort((a, b) => APPEARANCE_OPTION_POSITION[a] - APPEARANCE_OPTION_POSITION[b])
			.map((value) => {
				const active = value === input.current;
				return {
					value,
					label: APPEARANCE_LABELS[value],
					active,
					ariaPressed: active ? "true" : "false",
				};
			}),
	};
}

export interface ProfileLine {
	text: string;
	kind: "name" | "email";
	role: "title" | "description";
}

export interface ProfileEdit {
	popoverId: string;
	formAction: string;
	value: string;
	maxLength: number;
}

export interface ProfileSectionViewModel {
	initials: string;
	lines: ProfileLine[];
	edits: ProfileEdit[];
}

function profileLines(input: { email: string; displayName: DisplayName | undefined }): ProfileLine[] {
	if (input.displayName === undefined) return [{ text: input.email, kind: "email", role: "title" }];
	return [
		{ text: input.displayName, kind: "name", role: "title" },
		{ text: input.email, kind: "email", role: "description" },
	];
}

export function buildProfileSection(input: {
	email: string;
	displayName: DisplayName | undefined;
	nativeSurface: boolean;
}): ProfileSectionViewModel {
	return {
		initials: initialsFor({ email: input.email, displayName: input.displayName }),
		lines: profileLines(input),
		edits: input.nativeSurface
			? []
			: [
					{
						popoverId: "account-profile-edit",
						formAction: withInternalTracking(ACCOUNT_PROFILE_URL, {
							source: ACCOUNT_SOURCE,
							content: "edit-profile",
						}),
						value: input.displayName ?? "",
						maxLength: DISPLAY_NAME_MAX_LENGTH,
					},
				],
	};
}

/** Rewrites the account view model for the iOS app's in-app web surface: strips
 * every in-app purchase path — the subscribe and reactivate CTAs and the whole
 * payment-methods section — so the build satisfies App Store review Guideline
 * 3.1.1. Kept: the subscription status line, the cancel control, and the
 * delete-account danger zone (Apple requires in-app account deletion; cancelling
 * buys nothing). Commerce-stripping itself is
 * keyed on the iOS surface, not the app shell: a store build predating the shell
 * marker must keep satisfying Guideline 3.1.1. */
export function withoutCommerce(
	vm: AccountViewModel,
	options: AppSurfaceOptions,
): AccountViewModel {
	return {
		...vm,
		actions: withoutPurchaseActions(vm.actions, options),
		managePanel: {
			...vm.managePanel,
			actions: withoutPurchaseActions(vm.managePanel.actions, options),
		},
		dangerAction: carryAppSurface(vm.dangerAction, options),
		pollUrl: vm.pollUrl === undefined ? undefined : carryAppSurfaceHref(vm.pollUrl, options),
		/** Naming a price is the part of this page Guideline 3.1.1 objects to, so the
		 * renewal line is stripped here rather than relying on the route happening not
		 * to load one. */
		nextCharge: HIDDEN_NEXT_CHARGE,
		price: HIDDEN_PRICE,
		payment: buildPaymentSectionViewModel({ kind: "no-customer" }, undefined),
		billingHistory: HIDDEN_BILLING_HISTORY,
		lede: "Manage your account and preferences.",
		subscriptionHeading: "Subscription",
	};
}
