import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { PRICING_PLANS, formatLocalInstant, render } from "@packages/web-shell";
import type { BillingPlan } from "@packages/provider-contracts/subscription-providers";
import { translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";
import { DEFAULT_LOCALE } from "@packages/translations/locale";
import { formatChargeAmount } from "../billing-amount";

const TEMPLATE = readFileSync(
	join(__dirname, "charge-reminder-email.template.html"),
	"utf-8",
);

const SIGNOFF = "— Fayner Brack, Founder & CEO";

interface ChargeReminderEmailParams {
	founderAvatarUrl: string;
	chargeAt: string;
	ctaUrl: string;
	plan?: BillingPlan;
	charge?: Charge;
}

interface Charge {
	amountMinor: number;
	currency: string;
}

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

const RENEWAL_AT_SAME_PRICE: Record<BillingPlan, () => string> = {
	monthly: () => t("chargeReminder.renewal.samePrice.monthly"),
	yearly: () => t("chargeReminder.renewal.samePrice.yearly"),
	triennial: () => t("chargeReminder.renewal.samePrice.triennial"),
};

const RENEWAL_AT_LIST_PRICE: Record<BillingPlan, (listPrice: string) => string> = {
	monthly: (listPrice) => t("chargeReminder.renewal.atListPrice.monthly", { listPrice }),
	yearly: (listPrice) => t("chargeReminder.renewal.atListPrice.yearly", { listPrice }),
	triennial: (listPrice) => t("chargeReminder.renewal.atListPrice.triennial", { listPrice }),
};

const LIST_PRICE_CURRENCY = "usd";
const US_CENTS_PER_DOLLAR = 100;

interface ChargeReminderEmailComponent {
	subject: string;
	to: (mediaType: "text/html" | "text/plain") => string;
}

function chargeDateLabel(chargeAt: string): string {
	return formatLocalInstant({ iso: chargeAt, style: "date", timeZone: "UTC" });
}

type ChargeInput = { chargeDate: string; plan: BillingPlan | undefined; charge: Charge | undefined };

function isListPrice(input: { charge: Charge; plan: BillingPlan }): boolean {
	const listPriceMinor = Number(PRICING_PLANS[input.plan].totalAmount) * US_CENTS_PER_DOLLAR;
	return input.charge.currency === LIST_PRICE_CURRENCY && input.charge.amountMinor === listPriceMinor;
}

function renewalAfter(input: { charge: Charge; plan: BillingPlan | undefined }): string {
	const { charge, plan } = input;
	if (plan === undefined) return t("chargeReminder.renewal.unknownPlan");
	if (isListPrice({ charge, plan })) return RENEWAL_AT_SAME_PRICE[plan]();
	return RENEWAL_AT_LIST_PRICE[plan](PRICING_PLANS[plan].totalDisplay);
}

function chargeSentence(input: ChargeInput): string {
	const { chargeDate, plan, charge } = input;
	if (charge !== undefined) {
		return t("chargeReminder.charge.stated", {
			chargeDate,
			amount: formatChargeAmount(charge),
			renewal: renewalAfter({ charge, plan }),
		});
	}
	if (plan === undefined) return t("chargeReminder.charge.unstated", { chargeDate });
	return t("chargeReminder.charge.stated", {
		chargeDate,
		amount: PRICING_PLANS[plan].totalDisplay,
		renewal: RENEWAL_AT_SAME_PRICE[plan](),
	});
}

function bodyParagraphs(input: ChargeInput): string[] {
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
	const paragraphs = bodyParagraphs({ chargeDate, plan: params.plan, charge: params.charge });
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
					fontStack: EMAIL_FONT_STACK,
				});
			}

			return [...paragraphs, `Manage your subscription: ${params.ctaUrl}`, SIGNOFF].join("\n\n");
		},
	};
}
