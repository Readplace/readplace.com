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
} as const;
