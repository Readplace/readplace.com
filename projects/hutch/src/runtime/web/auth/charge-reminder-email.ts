import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { PRICING_PLANS, formatLocalInstant, render } from "@packages/web-shell";
import type { BillingPlan } from "@packages/provider-contracts/subscription-providers";

const TEMPLATE = readFileSync(
	join(__dirname, "charge-reminder-email.template.html"),
	"utf-8",
);

const SIGNOFF = "— Fayner";

interface ChargeReminderEmailParams {
	founderAvatarUrl: string;
	chargeAt: string;
	ctaUrl: string;
	plan?: BillingPlan;
}

const RENEWAL_CADENCE: Record<BillingPlan, string> = {
	monthly: "then once a month after that",
	yearly: "then once a year after that",
	triennial: "then once every 3 years after that",
};

interface ChargeReminderEmailComponent {
	subject: string;
	to: (mediaType: "text/html" | "text/plain") => string;
}

function chargeDateLabel(chargeAt: string): string {
	return formatLocalInstant({ iso: chargeAt, style: "date", timeZone: "UTC" });
}

function chargeSentence(input: { chargeDate: string; plan: BillingPlan | undefined }): string {
	const opening = `Your free trial ends on ${input.chargeDate}. You added a card when you subscribed, so your membership starts on its own`;
	const plan = input.plan;
	if (plan === undefined) {
		return `${opening} — the plan you are on is charged to the card on file on ${input.chargeDate}, then renews automatically at the end of each billing period.`;
	}
	return `${opening} — ${PRICING_PLANS[plan].totalDisplay} charged to the card on file on ${input.chargeDate}, ${RENEWAL_CADENCE[plan]}.`;
}

function bodyParagraphs(input: { chargeDate: string; plan: BillingPlan | undefined }): string[] {
	return [
		chargeSentence(input),
		`Changed your mind? Cancel any time before ${input.chargeDate} from your account page — the button below takes you there — and nothing is charged.`,
		"Questions about the charge or the timing — just reply. I answer everything personally.",
	];
}

export function ChargeReminderEmail(
	params: ChargeReminderEmailParams,
): ChargeReminderEmailComponent {
	const chargeDate = chargeDateLabel(params.chargeAt);
	const paragraphs = bodyParagraphs({ chargeDate, plan: params.plan });
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
