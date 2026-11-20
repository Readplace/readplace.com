import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchAccount } from "@packages/translations/hutch-account";
import { type PageBody, render } from "@packages/web-shell";
import { AUTH_STYLES } from "../../auth/auth.styles";
import { ACCOUNT_DELETE_URL, ACCOUNT_EXPORT_URL } from "../account/account.url";
import { DELETE_ACCOUNT_CONFIRMATION_FIELD, DELETE_ACCOUNT_CONFIRMATION_PHRASE } from "../account/account.view-model";
import { AGE_UNLOCK_PATH } from "./age-lock.url";

const PAUSED_TEMPLATE = readFileSync(join(__dirname, "age-paused.template.html"), "utf-8");
const UNLOCK_TEMPLATE = readFileSync(join(__dirname, "age-unlock.template.html"), "utf-8");
const UNLOCK_DONE_TEMPLATE = readFileSync(join(__dirname, "age-unlock-done.template.html"), "utf-8");
const UNLOCK_INVALID_TEMPLATE = readFileSync(join(__dirname, "age-unlock-invalid.template.html"), "utf-8");

const { t } = translator(hutchAccount, DEFAULT_LOCALE);

function agePage(page: { seo: "paused" | "unlock"; bodyClass: string; html: string; statusCode: number }): PageBody {
	return {
		seo: {
			title: t(`ageLock.${page.seo}.seoTitle`),
			description: t(`ageLock.${page.seo}.seoDescription`),
			canonicalUrl: page.seo === "paused" ? "/queue" : AGE_UNLOCK_PATH,
			robots: "noindex, nofollow",
		},
		styles: AUTH_STYLES,
		bodyClass: page.bodyClass,
		content: { html: page.html },
		statusCode: page.statusCode,
	};
}

export function AgePausedPage(): PageBody {
	return agePage({
		seo: "paused",
		bodyClass: "page-age-paused",
		html: render(PAUSED_TEMPLATE, {
			exportUrl: ACCOUNT_EXPORT_URL,
			deleteUrl: ACCOUNT_DELETE_URL,
			deleteField: DELETE_ACCOUNT_CONFIRMATION_FIELD,
			deletePhrase: DELETE_ACCOUNT_CONFIRMATION_PHRASE,
		}),
		statusCode: 403,
	});
}

export function AgeUnlockPage(token: string): PageBody {
	return agePage({
		seo: "unlock",
		bodyClass: "page-age-unlock",
		html: render(UNLOCK_TEMPLATE, { unlockUrl: AGE_UNLOCK_PATH, token }),
		statusCode: 200,
	});
}

export function AgeUnlockedPage(): PageBody {
	return agePage({ seo: "unlock", bodyClass: "page-age-unlock", html: render(UNLOCK_DONE_TEMPLATE, {}), statusCode: 200 });
}

export function AgeUnlockInvalidPage(): PageBody {
	return agePage({ seo: "unlock", bodyClass: "page-age-unlock", html: render(UNLOCK_INVALID_TEMPLATE, {}), statusCode: 400 });
}
