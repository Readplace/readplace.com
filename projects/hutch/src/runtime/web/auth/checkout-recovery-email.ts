import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(join(__dirname, "checkout-recovery-email.template.html"), "utf-8");

const CTA_LABEL = "Resume your trial";
const SIGNOFF = "— Fayner";
const SITE = "readplace.com";

interface CheckoutRecoveryEmailParams {
	founderAvatarUrl: string;
	resumeUrl: string;
	annualPrice: string;
}

interface CheckoutRecoveryEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

function bodyParagraphs({
	annualPrice,
}: {
	annualPrice: string;
}): string[] {
	return [
		"Hi there,",
		"I'm Fayner \u2014 I built Readplace alone, and I noticed you signed up but didn't make it through checkout. I wanted to ask, gently: was it the price, the flow, or something else?",
		"I genuinely want to know. A two-line reply would help me more than any analytics dashboard.",
		`The reason I'm pushing for a paid plan at all is that the ${annualPrice} a year is what pays for the AI summaries on every article you save \u2014 and once it lands, the manual Pocket and Instapaper import I'm running by hand for the first members. It's about the price of a single cup of coffee a month, and there's no investor money behind this \u2014 every subscription literally keeps Readplace running for another year.`,
		"Either way, your 14-day free trial is still waiting if you want to try it without paying first.",
	];
}

export function CheckoutRecoveryEmail(
	params: CheckoutRecoveryEmailParams,
): CheckoutRecoveryEmailComponent {
	const paragraphs = bodyParagraphs(params);
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					resumeUrl: params.resumeUrl,
					paragraphs,
					ctaLabel: CTA_LABEL,
					signoff: SIGNOFF,
					site: SITE,
					colors: EMAIL_COLORS,
				});
			}

			return [
				...paragraphs,
				`${CTA_LABEL}:\n${params.resumeUrl}`,
				`${SIGNOFF}\n${SITE}`,
			].join("\n\n");
		},
	};
}
