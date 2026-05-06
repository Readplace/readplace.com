import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { render } from "../render";

const TEMPLATE = readFileSync(join(__dirname, "checkout-recovery-email.template.html"), "utf-8");

interface CheckoutRecoveryEmailParams {
	founderAvatarUrl: string;
	resumeUrl: string;
	monthlyPrice: string;
	yearlyDiscount: string;
}

interface CheckoutRecoveryEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

export function CheckoutRecoveryEmail(
	params: CheckoutRecoveryEmailParams,
): CheckoutRecoveryEmailComponent {
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, { ...params, colors: EMAIL_COLORS });
			}

			const { resumeUrl, monthlyPrice, yearlyDiscount } = params;
			return [
				"Hi there,",
				"",
				"I'm Fayner \u2014 I built Readplace alone, and I noticed you signed up but didn't make it through checkout. I wanted to ask, gently: was it the price, the flow, or something else?",
				"",
				"I genuinely want to know. A two-line reply would help me more than any analytics dashboard.",
				"",
				`The reason I'm pushing for a paid plan at all is that the ${monthlyPrice} a month is what pays for the AI summaries on every article you save \u2014 and once it lands, the manual Pocket and Instapaper import I'm running by hand for the first members. It's less than a single cup of coffee a month, and there's no investor money behind this \u2014 every subscription literally keeps Readplace running for one more month.`,
				"",
				`If you want, I can offer you a yearly plan with ${yearlyDiscount} off \u2014 just reply to this email and I'll set it up for you. That's the founder discount, it's not on the website.`,
				"",
				"Either way, your 14-day free trial is still waiting if you want to try it without paying first.",
				"",
				"Resume your trial:",
				resumeUrl,
				"",
				"\u2014 Fayner",
				"readplace.com",
				"",
				"If you'd rather not hear from me, just reply STOP.",
				"",
			].join("\n");
		},
	};
}
