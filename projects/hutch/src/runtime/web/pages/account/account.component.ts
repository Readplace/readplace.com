import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { ACCOUNT_STYLES } from "./account.styles";
import { ACCOUNT_EXPORT_URL } from "./account.url";
import type { AccountViewModel, CardSectionViewModel } from "./account.view-model";
import { addPageStylesheet } from "../../page-stylesheets";

const ACCOUNT_TEMPLATE = readFileSync(join(__dirname, "account.template.html"), "utf-8");
const ACCOUNT_CARD_TEMPLATE = readFileSync(join(__dirname, "account-card.template.html"), "utf-8");

const ACCOUNT_STYLESHEET = addPageStylesheet({ name: "account", css: ACCOUNT_STYLES });

/** Same-origin glue bundle (Stripe.js itself loads from js.stripe.com inside it).
 * Loaded on every /account render; it no-ops unless the Elements container is
 * present, so the list/manage views pay nothing for it. */
const ACCOUNT_CARDS_SCRIPT = `<script src="/client-dist/account-cards.client.js" defer></script>`;

/** Export left the header nav so the trial countdown keeps its room; the account
 * page is where it lives now, reachable by read-only users too — they lose the
 * Account nav entry but still reach /account from the countdown chip. */
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

export function renderAccountCard(vm: AccountViewModel): string {
	return render(ACCOUNT_CARD_TEMPLATE, vm);
}

export function AccountPage(
	vm: AccountViewModel,
	cardSection: CardSectionViewModel,
	surface?: AccountSurface,
): PageBody {
	return {
		seo: {
			title: "Account — Readplace",
			description: "Manage your Readplace subscription.",
			canonicalUrl: "/account",
			robots: "noindex, nofollow",
		},
		styles: { href: ACCOUNT_STYLESHEET.href },
		bodyClass: surface ? "page-account page-account--chromeless" : "page-account",
		content: {
			html: render(ACCOUNT_TEMPLATE, {
				...vm,
				cardSection,
				cardHtml: renderAccountCard(vm),
				exportHref: EXPORT_HREF,
				backLink: surface?.backLink,
			}),
		},
		// The app surface renders no Elements container (withoutCommerce hides the
		// whole card section), so the Stripe glue would have nothing to mount.
		scripts: surface ? undefined : ACCOUNT_CARDS_SCRIPT,
	};
}
