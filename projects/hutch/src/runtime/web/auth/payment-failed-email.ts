import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(
	join(__dirname, "payment-failed-email.template.html"),
	"utf-8",
);

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
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs: PARAGRAPHS,
					ctaUrl: params.ctaUrl,
					signoff: SIGNOFF,
					colors: EMAIL_COLORS,
					fontStack: EMAIL_FONT_STACK,
				});
			}

			return [...PARAGRAPHS, `Update your card: ${params.ctaUrl}`, SIGNOFF].join("\n\n");
		},
	};
}
