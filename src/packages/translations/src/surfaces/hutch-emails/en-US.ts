export const enUS = {
	chargeReminder: {
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
	},
} as const;
