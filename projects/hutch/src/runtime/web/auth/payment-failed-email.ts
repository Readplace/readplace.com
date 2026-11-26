import { renderEmailCardMessage } from "../email-card";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";

export const PAYMENT_FAILED_EMAIL_SUBJECT = "your Readplace payment didn't go through";

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

const SIGNOFF = "— Fayner Brack, Founder & CEO";

interface PaymentFailedEmailParams {
	founderAvatarUrl: string;
	ctaUrl: string;
}

interface PaymentFailedEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

const PARAGRAPHS = [
	"Your Readplace payment didn't go through — usually that means the card on file expired or was replaced.",
	"Add a new card on your account page, then choose “Make primary” on it — only the primary card is charged, so adding one without promoting it leaves the failing card in place. Once it is primary, the next automatic retry uses it.",
	t("paymentFailedEmail.retriesFail"),
];

export function PaymentFailedEmail(
	params: PaymentFailedEmailParams,
): PaymentFailedEmailComponent {
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return renderEmailCardMessage({
					titleHtml: t("paymentFailedEmail.title"),
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs: PARAGRAPHS.map((html) => ({ html })),
					cta: { url: params.ctaUrl, label: t("paymentFailedEmail.cta") },
					signoff: SIGNOFF,
				});
			}

			return [...PARAGRAPHS, `${t("paymentFailedEmail.cta")}: ${params.ctaUrl}`, SIGNOFF].join("\n\n");
		},
	};
}
