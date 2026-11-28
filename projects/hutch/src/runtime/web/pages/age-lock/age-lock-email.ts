import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";
import { renderEmailCardMessage } from "../../email-card";

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

export function ageLockEmail(params: { unlockUrl: string }): { subject: string; html: string } {
	return {
		subject: t("ageLockEmail.subject"),
		html: renderEmailCardMessage({
			titleHtml: t("ageLockEmail.title"),
			paragraphs: [{ text: t("ageLockEmail.reported") }, { text: t("ageLockEmail.deletion") }],
			cta: { url: params.unlockUrl, label: t("ageLockEmail.cta") },
		}),
	};
}
