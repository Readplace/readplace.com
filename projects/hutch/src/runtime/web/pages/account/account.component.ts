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

export function AccountPage(vm: AccountViewModel, cardSection: CardSectionViewModel): PageBody {
	return {
		seo: {
			title: "Account — Readplace",
			description: "Manage your Readplace subscription.",
			canonicalUrl: "/account",
			robots: "noindex, nofollow",
		},
		styles: ACCOUNT_STYLES,
		bodyClass: "page-account",
		content: { html: render(ACCOUNT_TEMPLATE, { ...vm, cardSection }) },
		scripts: ACCOUNT_CARDS_SCRIPT,
	};
}
