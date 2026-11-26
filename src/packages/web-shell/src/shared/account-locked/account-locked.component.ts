import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { shell } from "@packages/translations/shell";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { VERIFICATION_CONTACT_EMAIL } from "../verify-banner/verify-banner.component";
import { ACCOUNT_LOCKED_STYLES } from "./account-locked.styles";
import { ACCOUNT_LOCKED_TEMPLATE } from "./account-locked.template";

const { t } = translator(shell, DEFAULT_LOCALE);

export function AccountLockedPage(input: { logoutTrackSource: string }): PageBody {
	return {
		seo: {
			title: t("accountLocked.seo.title"),
			description: t("accountLocked.seo.description"),
			canonicalUrl: "/queue",
			robots: "noindex, nofollow",
		},
		styles: ACCOUNT_LOCKED_STYLES,
		bodyClass: "page-account-locked",
		content: {
			html: render(ACCOUNT_LOCKED_TEMPLATE, {
				contactEmail: VERIFICATION_CONTACT_EMAIL,
				logoutTrackSource: input.logoutTrackSource,
			}),
		},
		statusCode: 403,
	};
}
