export const enUS = {
	trialReminderEmail: {
		trialEnds:
			"Your trial of Readplace ends in {days} days. I don't ask for a card up front, so nothing gets charged.",
		freePlan: {
			noSaves: "When the trial ends, your account moves to the free plan, and you can keep saving within daily limits.",
			withSaves: {
				one: "When the trial ends, your account moves to the free plan: the {count} article you've saved stays, and you can keep saving within daily limits.",
				other: "When the trial ends, your account moves to the free plan: the {count} articles you've saved stay, and you can keep saving within daily limits.",
			},
		},
	},
	trialNudgeEmail: {
		withoutCard: "Without a card, your account moves to the free plan when the trial ends and keeps everything you saved.",
	},
	paymentFailedEmail: {
		retriesFail:
			"If every retry fails, the subscription cancels and your account moves to the free plan. If something looks wrong on my end, just reply and I'll sort it out personally.",
	},
	automationSavesHeldEmail: {
		openingAfter:
			" just arrived in your Readplace Inbox, but the articles weren't saved to All — your account is on the free plan, and the Inbox saves automatically only on a paid plan.",
		reassuranceLink: "you upgrade",
	},
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
