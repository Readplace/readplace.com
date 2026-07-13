import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { ACCOUNT_STYLES } from "./account.styles";
import type { AccountViewModel, CardSectionViewModel } from "./account.view-model";

const ACCOUNT_TEMPLATE = readFileSync(join(__dirname, "account.template.html"), "utf-8");

/** Same-origin glue bundle (Stripe.js itself loads from js.stripe.com inside it).
 * Loaded on every /account render; it no-ops unless the Elements container is
 * present, so the list/manage views pay nothing for it. */
const ACCOUNT_CARDS_SCRIPT = `<script src="/client-dist/account-cards.client.js" defer></script>`;

/** The app-shell rendering of this page: hosted in the iOS web sheet, so the web
 * chrome is gone and the page supplies its own way back — a deep link the sheet's
 * navigation delegate intercepts. Passed as a page option rather than folded into
 * the view model because the view model is a pure function of subscription state. */
export interface AccountSurface {
	backLink: { href: string; label: string };
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
		styles: ACCOUNT_STYLES,
		bodyClass: surface ? "page-account page-account--chromeless" : "page-account",
		content: { html: render(ACCOUNT_TEMPLATE, { ...vm, cardSection, backLink: surface?.backLink }) },
		// The app surface renders no Elements container (withoutCommerce hides the
		// whole card section), so the Stripe glue would have nothing to mount.
		scripts: surface ? undefined : ACCOUNT_CARDS_SCRIPT,
	};
}
