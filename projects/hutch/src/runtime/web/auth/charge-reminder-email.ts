import { renderEmailCardMessage } from "../email-card";
import { PRICING_PLANS, formatLocalInstant } from "@packages/web-shell";
import type { BillingPlan } from "@packages/provider-contracts/subscription-providers";
import { translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";
import { DEFAULT_LOCALE } from "@packages/translations/locale";
import type { SubscriptionNextCharge } from "@packages/provider-contracts/subscription-billing";
import { formatChargeAmount } from "../billing-amount";

interface ChargeReminderEmailParams {
	founderAvatarUrl: string;
	chargeAt: string;
	ctaUrl: string;
	plan?: BillingPlan;
	charge?: SubscriptionNextCharge;
}

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

const LIST_PRICE_CURRENCY = "usd";
const US_CENTS_PER_DOLLAR = 100;

interface ChargeReminderEmailComponent {
	subject: string;
	to: (mediaType: "text/html" | "text/plain") => string;
}

function chargeDateLabel(chargeAt: string): string {
	return formatLocalInstant({ iso: chargeAt, style: "date", timeZone: "UTC" });
}

type ChargeInput = { chargeDate: string; plan: BillingPlan | undefined; charge: SubscriptionNextCharge | undefined };

function isListPrice(input: { charge: SubscriptionNextCharge; plan: BillingPlan }): boolean {
	const listPriceMinor = Number(PRICING_PLANS[input.plan].totalAmount) * US_CENTS_PER_DOLLAR;
	return input.charge.currency === LIST_PRICE_CURRENCY && input.charge.amountMinor === listPriceMinor;
}

function chargeSentence(input: ChargeInput): string {
	const { chargeDate, plan, charge } = input;
	if (plan !== undefined && (charge === undefined || isListPrice({ charge, plan }))) {
		return t("chargeReminder.charge.stated", {
			chargeDate,
			amount: PRICING_PLANS[plan].totalDisplay,
			renewal: t(`chargeReminder.renewal.samePrice.${plan}`),
		});
	}
	if (charge === undefined) return t("chargeReminder.charge.unstated", { chargeDate });
	return t("chargeReminder.charge.stated", {
		chargeDate,
		amount: formatChargeAmount(charge),
		renewal:
			plan === undefined
				? t("chargeReminder.renewal.unknownPlan")
				: t(`chargeReminder.renewal.atListPrice.${plan}`, { listPrice: PRICING_PLANS[plan].totalDisplay }),
	});
}

function bodyParagraphs(input: ChargeInput): string[] {
	return [
		chargeSentence(input),
		t("chargeReminder.cancel", { chargeDate: input.chargeDate }),
		t("chargeReminder.questions"),
	];
}

export function ChargeReminderEmail(
	params: ChargeReminderEmailParams,
): ChargeReminderEmailComponent {
	const chargeDate = chargeDateLabel(params.charge?.at ?? params.chargeAt);
	const signoff = t("chargeReminder.signoff");
	const paragraphs = bodyParagraphs({ chargeDate, plan: params.plan, charge: params.charge });
	return {
		subject: t("chargeReminder.subject", { chargeDate }),
		to(mediaType) {
			if (mediaType === "text/html") {
				return renderEmailCardMessage({
					titleHtml: t("chargeReminder.title"),
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs: paragraphs.map((html) => ({ html })),
					cta: { url: params.ctaUrl, label: t("chargeReminder.cta") },
					signoff,
				});
			}

			return [...paragraphs, t("chargeReminder.ctaPlain", { ctaUrl: params.ctaUrl }), signoff].join("\n\n");
		},
	};
}
