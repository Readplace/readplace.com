import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { ACCOUNT_STYLES } from "./account.styles";
import type { AccountViewModel } from "./account.view-model";

const ACCOUNT_TEMPLATE = readFileSync(join(__dirname, "account.template.html"), "utf-8");

export function AccountPage(vm: AccountViewModel): PageBody {
	return {
		seo: {
			title: "Account — Readplace",
			description: "Manage your Readplace subscription.",
			canonicalUrl: "/account",
			robots: "noindex, nofollow",
		},
		styles: ACCOUNT_STYLES,
		bodyClass: "page-account",
		content: { html: render(ACCOUNT_TEMPLATE, vm) },
	};
}
