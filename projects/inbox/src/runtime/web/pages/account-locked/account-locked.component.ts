import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, VERIFICATION_CONTACT_EMAIL } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { ACCOUNT_LOCKED_STYLES } from "./account-locked.styles";

const ACCOUNT_LOCKED_TEMPLATE = readFileSync(
	join(__dirname, "account-locked.template.html"),
	"utf-8",
);

export function AccountLockedPage(): PageBody {
	return {
		seo: {
			title: "Account locked — Readplace",
			description: "This Readplace account is locked pending email verification.",
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: ACCOUNT_LOCKED_STYLES,
		bodyClass: "page-account-locked",
		content: {
			html: render(ACCOUNT_LOCKED_TEMPLATE, { contactEmail: VERIFICATION_CONTACT_EMAIL }),
		},
		statusCode: 403,
	};
}
