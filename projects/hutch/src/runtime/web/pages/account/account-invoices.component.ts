import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGINATION_STYLES, render, renderAlert } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { ACCOUNT_INVOICES_STYLES } from "./account-invoices.styles";
import type { AccountInvoicesViewModel, InvoicesPagerState } from "./account-invoices.view-model";
import { ACCOUNT_STYLES } from "./account.styles";

const ACCOUNT_INVOICES_TEMPLATE = readFileSync(join(__dirname, "account-invoices.template.html"), "utf-8");

const PAGER_CLASS: Record<InvoicesPagerState, string> = {
	visible: "pagination pagination--visible",
	hidden: "pagination pagination--hidden",
};

const PROVIDER_ERROR_MESSAGE = "Couldn't load your invoices. Refresh the page to try again.";

export function AccountInvoicesPage(vm: AccountInvoicesViewModel): PageBody {
	return {
		seo: {
			title: "Invoices — Readplace",
			description: "Your paid Readplace invoices.",
			canonicalUrl: "/account/invoices",
			robots: "noindex, nofollow",
		},
		styles: `${ACCOUNT_STYLES}\n${PAGINATION_STYLES}\n${ACCOUNT_INVOICES_STYLES}`,
		bodyClass: "page-account-invoices",
		content: {
			html: render(ACCOUNT_INVOICES_TEMPLATE, {
				...vm,
				pagerClass: PAGER_CLASS[vm.pager.state],
				alertHtml:
					vm.state === "provider-error"
						? renderAlert({
								key: "account-invoices",
								content: { variant: "error", message: { text: PROVIDER_ERROR_MESSAGE } },
							})
						: "",
			}),
		},
	};
}
