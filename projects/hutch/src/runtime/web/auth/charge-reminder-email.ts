import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { ANNUAL_PRICE_DISPLAY, formatLocalInstant, render } from "@packages/web-shell";
import { TRIAL_REMINDER_LEAD_DAYS } from "../../domain/stripe/stripe-trial-config";

const TEMPLATE = readFileSync(
	join(__dirname, "charge-reminder-email.template.html"),
	"utf-8",
);

const SIGNOFF = "— Fayner";

interface ChargeReminderEmailParams {
	founderAvatarUrl: string;
	chargeAt: string;
	ctaUrl: string;
}

interface ChargeReminderEmailComponent {
	subject: string;
	to: (mediaType: "text/html" | "text/plain") => string;
}

function chargeDateLabel(chargeAt: string): string {
	return formatLocalInstant({ iso: chargeAt, style: "date", timeZone: "UTC" });
}

function bodyParagraphs(chargeDate: string): string[] {
	return [
		`Your free trial ends in ${TRIAL_REMINDER_LEAD_DAYS} days. You added a card when you subscribed, so your membership starts on its own — ${ANNUAL_PRICE_DISPLAY} for the year, charged to the card on file on ${chargeDate}.`,
		"Changed your mind? Cancel from your account page before then and nothing is charged.",
		"Questions about the charge or the timing — just reply. I answer everything personally.",
	];
}

export function ChargeReminderEmail(
	params: ChargeReminderEmailParams,
): ChargeReminderEmailComponent {
	const chargeDate = chargeDateLabel(params.chargeAt);
	const paragraphs = bodyParagraphs(chargeDate);
	return {
		subject: `your Readplace membership starts on ${chargeDate}`,
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs,
					ctaUrl: params.ctaUrl,
					signoff: SIGNOFF,
					colors: EMAIL_COLORS,
				});
			}

			return [...paragraphs, `Manage your subscription: ${params.ctaUrl}`, SIGNOFF].join("\n\n");
		},
	};
}
