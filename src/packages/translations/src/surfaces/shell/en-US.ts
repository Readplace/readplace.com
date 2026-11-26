export const enUS = {
	accountLocked: {
		title: "Your account is locked",
		lede: {
			before: "Your email was never verified within 7 days of signing up, so your account is locked. Email",
			after: "and I'll restore your access.",
		},
		signOut: "Sign out",
		seo: {
			title: "Account locked — Readplace",
			description: "This Readplace account is locked pending email verification.",
		},
	},
	popover: {
		close: "Close",
		cancel: "Cancel",
	},
	pricing: {
		freePlan: "Free to use, with no card: save new links within daily limits and read everything you save.",
		firstDays: "Every new account gets the paid plan for its first {days} days.",
		upgrade:
			"Upgrade for the Inbox, Next read, Past reads, readlist purpose filtering and Gmail, without the free plan's daily limits: {prices}",
	},
} as const;
