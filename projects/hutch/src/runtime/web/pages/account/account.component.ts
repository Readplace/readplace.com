import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIRM_POPOVER_STYLES,
	render,
	renderAlert,
	renderInFlightDots,
	withInternalTracking,
} from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import {
	SUBSCRIBE_PLANS_STYLES,
	renderSubscribePlansPopover,
} from "../../shared/subscribe-plans/subscribe-plans.component";
import { ACCOUNT_STYLES } from "./account.styles";
import { ACCOUNT_EXPORT_URL } from "./account.url";
import type {
	AccountAction,
	AccountViewModel,
	AppearanceSectionViewModel,
	CardSectionViewModel,
} from "./account.view-model";

const ACCOUNT_TEMPLATE = readFileSync(join(__dirname, "account.template.html"), "utf-8");
const ACCOUNT_CARD_TEMPLATE = readFileSync(join(__dirname, "account-card.template.html"), "utf-8");

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

interface AccountCardPopoverTrigger {
	popoverTarget: string;
	buttonClass: string;
	label: string;
	testAction: string;
}

interface AccountCardAction extends AccountAction {
	formClass: string;
	loaderHtml: string;
	popoverTriggers: readonly AccountCardPopoverTrigger[];
}

function toAccountCardAction(action: AccountAction): AccountCardAction {
	const popoverTarget = action.popoverTarget;
	if (popoverTarget === undefined) {
		return {
			...action,
			formClass: ACCOUNT_ACTION_FORM_CLASS,
			loaderHtml: ACTION_LOADER_HTML,
			popoverTriggers: [],
		};
	}
	return {
		...action,
		formClass: `${ACCOUNT_ACTION_FORM_CLASS} subscribe-plans__fallback`,
		loaderHtml: ACTION_LOADER_HTML,
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
				title: { text: "We couldn't restart your subscription", element: "h2" },
				message: { html: render('The card we have on file is no longer valid. Email <a href="mailto:support@readplace.com" data-test-account-support-link>support@readplace.com</a> and we\'ll get you back up and running.', {}) },
			},
		})
		: vm.stateIsErrorSubscribeFailed
			? renderAlert({
				key: "account-subscription",
				content: {
					variant: "error",
					title: { text: "We couldn't start your subscription", element: "h2" },
					message: { html: render('Something went wrong on the way to the checkout and nothing was charged. Try again, and if it keeps happening email <a href="mailto:support@readplace.com" data-test-account-support-link>support@readplace.com</a>.', {}) },
				},
			})
			: "";
	return render(ACCOUNT_CARD_TEMPLATE, { ...vm, errorAlertHtml, actions: vm.actions.map(toAccountCardAction) });
}

export function AccountPage(
	vm: AccountViewModel,
	cardSection: CardSectionViewModel,
	page: { email: string; appearance: AppearanceSectionViewModel; surface?: AccountSurface },
): PageBody {
	const surface = page.surface;
	return {
		seo: {
			title: "Account — Readplace",
			description: "Manage your Readplace subscription.",
			canonicalUrl: "/account",
			robots: "noindex, nofollow",
		},
		styles: `${ACCOUNT_STYLES}\n${CONFIRM_POPOVER_STYLES}\n${SUBSCRIBE_PLANS_STYLES}`,
		bodyClass: surface ? "page-account page-account--chromeless" : "page-account",
		content: {
			html: render(ACCOUNT_TEMPLATE, {
				...vm,
				cardSection: {
					...cardSection,
					alertHtml: cardSection.isError
						? renderAlert({ key: "payment-methods", content: { variant: "error", message: { text: cardSection.message } } })
						: "",
					noticeAlertHtml: cardSection.hasNotice
						? renderAlert({ key: "card-notice", content: { variant: "error", message: { text: cardSection.notice } } })
						: "",
				},
				cardHtml: renderAccountCard(vm),
				subscribePlansHtml: vm.actions.some((action) => action.popoverTarget !== undefined)
					? renderSubscribePlansPopover({ source: "account" })
					: "",
				email: page.email,
				appearance: page.appearance,
				exportHref: EXPORT_HREF,
				actionLoaderHtml: ACTION_LOADER_HTML,
				backLink: surface?.backLink,
			}),
		},
		// The app surface renders no Elements container (withoutCommerce hides the
		// whole card section), so the Stripe glue would have nothing to mount.
		scripts: surface ? undefined : ACCOUNT_CARDS_SCRIPT,
	};
}
