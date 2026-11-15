import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";
import { render } from "@packages/web-shell";
import { TRIAL_REMINDER_LEAD_DAYS } from "../../domain/stripe/stripe-trial-config";

const TEMPLATE = readFileSync(
	join(__dirname, "trial-reminder-email.template.html"),
	"utf-8",
);

export const TRIAL_REMINDER_EMAIL_SUBJECT = `your Readplace trial ends in ${TRIAL_REMINDER_LEAD_DAYS} days`;

const { t, tPlural } = translator(hutchEmails, DEFAULT_LOCALE);

const SIGNOFF = "— Fayner Brack, Founder & CEO";

interface TrialReminderEmailParams {
	founderAvatarUrl: string;
	savedArticlesCount: number;
	ctaUrl: string;
}

interface TrialReminderEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

function freePlanSentence(count: number): string {
	if (count === 0) return t("trialReminderEmail.freePlan.noSaves");
	return tPlural("trialReminderEmail.freePlan.withSaves", { count });
}

function bodyParagraphs(freePlan: string): string[] {
	return [
		`${t("trialReminderEmail.trialEnds", { days: TRIAL_REMINDER_LEAD_DAYS })} ${freePlan}`,
		"Readplace has no venture capital and runs no ads. A subscription covers the running expenses.",
		"If Readplace has earned a place in how you read, you can upgrade from your account page — it takes about a minute.",
		"If it hasn't, no action needed. Either way, I'd genuinely like to know what would make it worth keeping: just reply. I respond to all replies personally.",
	];
}

export function TrialReminderEmail(
	params: TrialReminderEmailParams,
): TrialReminderEmailComponent {
	const paragraphs = bodyParagraphs(freePlanSentence(params.savedArticlesCount));
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs,
					ctaUrl: params.ctaUrl,
					signoff: SIGNOFF,
					colors: EMAIL_COLORS,
					fontStack: EMAIL_FONT_STACK,
				});
			}

			return [...paragraphs, `Upgrade: ${params.ctaUrl}`, SIGNOFF].join("\n\n");
		},
	};
}
