import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iconSvg } from "@packages/ui-icons";
import {
	CONFIRM_POPOVER_STYLES,
	render,
	renderAlert,
	renderConfirmPopover,
	renderInFlightDots,
	withInternalTracking,
} from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import {
	SUBSCRIBE_PLANS_STYLES,
	renderSubscribePlansPopover,
} from "../../shared/subscribe-plans/subscribe-plans.component";
import { renderAccountProfileEdit, renderAccountProfileFallbackForm } from "./account-profile.component";
import { renderSecuritySection } from "./account-security.component";
import { ACCOUNT_STYLES } from "./account.styles";
import { ACCOUNT_EXPORT_URL } from "./account.url";
import type {
	AccountAction,
	AccountActionKey,
	AccountViewModel,
	AppearanceSectionViewModel,
	BillingHistoryViewModel,
	ManagePanelState,
	PaymentSectionState,
	PriceViewModel,
	ProfileLine,
	ProfileSectionViewModel,
	SecuritySectionViewModel,
} from "./account.view-model";

const ACCOUNT_TEMPLATE = readFileSync(join(__dirname, "account.template.html"), "utf-8");
const ACCOUNT_CARD_TEMPLATE = readFileSync(join(__dirname, "account-card.template.html"), "utf-8");
const ACCOUNT_BILLING_TEMPLATE = readFileSync(join(__dirname, "account-billing.template.html"), "utf-8");
const ACCOUNT_DANGER_FORM_TEMPLATE = readFileSync(join(__dirname, "account-danger-form.template.html"), "utf-8");

/** Same-origin glue bundle (Stripe.js itself loads from js.stripe.com inside it).
 * Loaded on every /account render; it no-ops unless the Elements container is
 * present, so the list/manage views pay nothing for it. */
const ACCOUNT_CARDS_SCRIPT = `<script src="/client-dist/account-cards.client.js" defer></script>`;

/** Export left the header nav; the account page is where it lives now,
 * reachable by read-only users too. */
const EXPORT_HREF = withInternalTracking(ACCOUNT_EXPORT_URL, {
	source: "account",
	content: "export",
});

/** The app-shell rendering of this page: hosted in the iOS web sheet, so the web
 * chrome is gone and the page supplies its own way back — a deep link the sheet's
 * navigation delegate intercepts. Passed as a page option rather than folded into
 * the view model because the view model is a pure function of subscription state. */
export interface AccountSurface {
	backLink: { href: string; label: string };
}

const ACCOUNT_ACTION_FORM_CLASS = "account-card__action-form";

const ACTION_LOADER_HTML = renderInFlightDots("account__action-loader in-flight-dots");

const ACTION_SWAP: Record<AccountActionKey, string> = {
	subscribe: "outerHTML show:none",
	"cancel-form": "outerHTML show:none",
	"reactivate-form": "outerHTML show:none",
	"delete-account": "outerHTML show:none",
	"manage-subscription": "outerHTML show:none",
	"update-payment": "outerHTML show:none",
	"view-invoices": "outerHTML show:none scroll:html:top",
	done: "outerHTML show:none",
};

const PRICE_CLASS: Record<PriceViewModel["state"], string> = {
	visible: "account-billing__price",
	hidden: "account-billing__price account-billing__price--hidden",
};

const PANEL_CLASS: Record<ManagePanelState, string> = {
	open: "account-billing__panel",
	closed: "account-billing__panel account-billing__panel--closed",
};

const PAYMENT_CLASS: Record<PaymentSectionState, string> = {
	card: "account-billing__payment",
	"no-card": "account-billing__payment",
	"provider-error": "account-billing__payment",
	hidden: "account-billing__payment account-billing__payment--hidden",
};

const HISTORY_CLASS: Record<BillingHistoryViewModel["state"], string> = {
	visible: "account-billing__history account-billing__history--visible",
	hidden: "account-billing__history account-billing__history--hidden",
};

const PROFILE_LINE_CLASS: Record<ProfileLine["role"], string> = {
	title: "account-row__title",
	description: "account-row__description",
};

const DELETE_ACCOUNT_POPOVER_ID = "delete-account";

type DangerPresentation = "inline" | "dialog";

const DANGER_CARD_CLASS: Record<DangerPresentation, string> = {
	inline: "account-section__card account-danger account-danger--inline",
	dialog: "account-section__card account-danger account-danger--dialog",
};

const DANGER_PAGE_FORM_PLACEMENT: Record<DangerPresentation, "inline" | "fallback"> = {
	inline: "inline",
	dialog: "fallback",
};

interface DangerFormButton {
	type: "submit" | "button";
	buttonClass: string;
	testAction: string;
	popoverTargetAttrs: string;
	labelHtml: string;
}

function submitLabelHtml(label: string): string {
	return render('<span class="account__action-label">{{label}}</span>{{{loader}}}', {
		label,
		loader: ACTION_LOADER_HTML,
	});
}

function buildDangerZone(vm: AccountViewModel) {
	const confirmation = vm.dangerConfirmation;
	const presentation: DangerPresentation = confirmation.hasNotice ? "inline" : "dialog";
	const commitLabelHtml = submitLabelHtml(vm.dangerAction.name);
	const sharedFormFields = {
		method: vm.dangerAction.method,
		href: vm.dangerAction.href,
		phrase: confirmation.phrase,
		pattern: confirmation.pattern,
		title: confirmation.title,
		field: confirmation.field,
		notice: confirmation.notice,
	};
	const pageFormButtons: DangerFormButton[] = [
		{
			type: "submit",
			buttonClass: "btn btn--destructive btn--m",
			testAction: "delete-account-submit",
			popoverTargetAttrs: "",
			labelHtml: commitLabelHtml,
		},
	];
	const dialogFormButtons: DangerFormButton[] = [
		{
			type: "button",
			buttonClass: "btn btn--neutral",
			testAction: "delete-account-cancel",
			popoverTargetAttrs: render(' popovertarget="{{id}}" popovertargetaction="hide"', {
				id: DELETE_ACCOUNT_POPOVER_ID,
			}),
			labelHtml: render("{{label}}", { label: "Cancel" }),
		},
		{
			type: "submit",
			buttonClass: "btn btn--primary",
			testAction: "delete-account-confirm",
			popoverTargetAttrs: "",
			labelHtml: commitLabelHtml,
		},
	];
	return {
		cardClass: DANGER_CARD_CLASS[presentation],
		presentation,
		popoverId: DELETE_ACCOUNT_POPOVER_ID,
		triggerLabel: vm.dangerAction.name,
		inlineFormHtml: render(ACCOUNT_DANGER_FORM_TEMPLATE, {
			...sharedFormFields,
			placement: DANGER_PAGE_FORM_PLACEMENT[presentation],
			formClass: "account-danger__form",
			buttonsClass: "account-danger__buttons",
			inputId: "delete-account-confirmation",
			autofocus: false,
			hasNotice: confirmation.hasNotice,
			buttons: pageFormButtons,
		}),
		dialogHtml: renderConfirmPopover({
			id: DELETE_ACCOUNT_POPOVER_ID,
			key: "delete-account",
			title: "Delete your account?",
			body: "This deletes your account, every saved article, and your reading history. It can't be undone.",
			actionsHtml: render(ACCOUNT_DANGER_FORM_TEMPLATE, {
				...sharedFormFields,
				placement: "dialog",
				formClass: "confirm-popover__actions account-danger__dialog-form",
				buttonsClass: "confirm-popover__buttons",
				inputId: "delete-account-confirmation-dialog",
				autofocus: true,
				hasNotice: false,
				buttons: dialogFormButtons,
			}),
		}),
	};
}

interface AccountCardPopoverTrigger {
	popoverTarget: string;
	buttonClass: string;
	label: string;
	testAction: string;
}

interface AccountCardAction extends AccountAction {
	formClass: string;
	hxSwap: string;
	leadingIconHtml: string;
	trailingIconHtml: string;
	loaderHtml: string;
	popoverTriggers: readonly AccountCardPopoverTrigger[];
}

function toAccountCardAction(action: AccountAction): AccountCardAction {
	const rendered = {
		...action,
		hxSwap: ACTION_SWAP[action.key],
		leadingIconHtml: action.leadingIcon === undefined ? "" : iconSvg(action.leadingIcon),
		trailingIconHtml: action.trailingIcon === undefined ? "" : iconSvg(action.trailingIcon),
		loaderHtml: ACTION_LOADER_HTML,
	};
	const popoverTarget = action.popoverTarget;
	if (popoverTarget === undefined) {
		return {
			...rendered,
			formClass: ACCOUNT_ACTION_FORM_CLASS,
			popoverTriggers: [],
		};
	}
	return {
		...rendered,
		formClass: `${ACCOUNT_ACTION_FORM_CLASS} subscribe-plans__fallback`,
		popoverTriggers: [
			{
				popoverTarget,
				buttonClass: `${action.buttonClass} subscribe-plans__trigger`,
				label: action.name,
				testAction: `${popoverTarget}-open`,
			},
		],
	};
}

export function renderAccountCard(vm: AccountViewModel): string {
	const errorAlertHtml = vm.stateIsErrorPaymentMethod
		? renderAlert({
			key: "account-subscription",
			content: {
				variant: "error",
				title: { text: "We couldn't restart your subscription", element: "p" },
				message: { html: render('The card we have on file is no longer valid. Email <a href="mailto:support@readplace.com" data-test-account-support-link>support@readplace.com</a> and we\'ll get you back up and running.', {}) },
			},
		})
		: vm.stateIsErrorSubscribeFailed
			? renderAlert({
				key: "account-subscription",
				content: {
					variant: "error",
					title: { text: "We couldn't start your subscription", element: "p" },
					message: { html: render('Something went wrong on the way to the checkout and nothing was charged. Try again, and if it keeps happening email <a href="mailto:support@readplace.com" data-test-account-support-link>support@readplace.com</a>.', {}) },
				},
			})
			: "";
	return render(ACCOUNT_CARD_TEMPLATE, {
		...vm,
		errorAlertHtml,
		priceClass: PRICE_CLASS[vm.price.state],
		panelClass: PANEL_CLASS[vm.managePanel.state],
		actions: vm.actions.map(toAccountCardAction),
		panelActions: vm.managePanel.actions.map(toAccountCardAction),
	});
}

function renderBillingSections(vm: AccountViewModel): string {
	const payment = vm.payment;
	return render(ACCOUNT_BILLING_TEMPLATE, {
		payment,
		billingHistory: vm.billingHistory,
		paymentClass: PAYMENT_CLASS[payment.state],
		paymentPanelClass: PANEL_CLASS[payment.panel.state],
		historyClass: HISTORY_CLASS[vm.billingHistory.state],
		paymentActions: payment.actions.map(toAccountCardAction),
		historyActions: vm.billingHistory.actions.map(toAccountCardAction),
		actionLoaderHtml: ACTION_LOADER_HTML,
		alertHtml: payment.isError
			? renderAlert({ key: "payment-methods", content: { variant: "error", message: { text: payment.message } } })
			: "",
		noticeAlertHtml: payment.panel.hasNotice
			? renderAlert({ key: "card-notice", content: { variant: "error", message: { text: payment.panel.notice } } })
			: "",
	});
}

export function AccountPage(
	vm: AccountViewModel,
	page: {
		profile: ProfileSectionViewModel;
		security: SecuritySectionViewModel;
		appearance: AppearanceSectionViewModel;
		surface?: AccountSurface;
	},
): PageBody {
	const surface = page.surface;
	return {
		seo: {
			title: "Account — Readplace",
			description: "Manage your account, billing and preferences.",
			canonicalUrl: "/account",
			robots: "noindex, nofollow",
		},
		styles: `${ACCOUNT_STYLES}\n${CONFIRM_POPOVER_STYLES}\n${SUBSCRIBE_PLANS_STYLES}`,
		bodyClass: surface ? "page-account page-account--chromeless" : "page-account",
		content: {
			html: render(ACCOUNT_TEMPLATE, {
				...vm,
				cardHtml: renderAccountCard(vm),
				billingHtml: renderBillingSections(vm),
				subscribePlansHtml: vm.actions.some((action) => action.popoverTarget !== undefined)
					? renderSubscribePlansPopover({ source: "account", checkedPlan: vm.checkedPlan })
					: "",
				profile: {
					...page.profile,
					lines: page.profile.lines.map((line) => ({ ...line, className: PROFILE_LINE_CLASS[line.role] })),
				},
				profileEditHtml: page.profile.edits.map(renderAccountProfileEdit).join(""),
				profileFallbackFormHtml: page.profile.edits.map(renderAccountProfileFallbackForm).join(""),
				securitySectionHtml: renderSecuritySection(page.security),
				appearance: page.appearance,
				exportHref: EXPORT_HREF,
				danger: buildDangerZone(vm),
				backLink: surface?.backLink,
			}),
		},
		// The app surface renders no Elements container (withoutCommerce hides the
		// whole card section), so the Stripe glue would have nothing to mount.
		scripts: surface ? undefined : ACCOUNT_CARDS_SCRIPT,
	};
}
