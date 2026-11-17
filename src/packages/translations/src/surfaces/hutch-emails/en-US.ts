export const enUS = {
	chargeReminder: {
		subject: "your Readplace membership starts on {chargeDate}",
		title: "Your Readplace membership starts soon",
		charge: {
			stated:
				"Your free trial ends on {chargeDate}. You added a card when you upgraded, so your membership starts on its own — {amount} charged to the card on file on {chargeDate}, {renewal}.",
			unstated:
				"Your free trial ends on {chargeDate}. You added a card when you upgraded, so your membership starts on its own — the plan you are on is charged to the card on file on {chargeDate}, then renews automatically at the end of each billing period.",
		},
		renewal: {
			unknownPlan: "then renews automatically at the end of each billing period",
			samePrice: {
				monthly: "then once a month after that",
				yearly: "then once a year after that",
				triennial: "then once every 3 years after that",
			},
			atListPrice: {
				monthly: "then {listPrice} once a month after that",
				yearly: "then {listPrice} once a year after that",
				triennial: "then {listPrice} once every 3 years after that",
			},
		},
		cancel:
			"Changed your mind? Cancel any time before {chargeDate} from your account page — the button below takes you there — and nothing is charged.",
		questions: "Questions about the charge or the timing — just reply. I answer everything personally.",
		cta: "Manage your subscription",
		ctaPlain: "Manage your subscription: {ctaUrl}",
		signoff: "— Fayner Brack, Founder & CEO",
	},
} as const;
