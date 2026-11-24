export const enUS = {
	billing: {
		freeChip: "Free plan",
		statusNote: {
			trial: "When it ends, your account moves to the free plan: you keep every article you saved and can save up to {limit} new links a day.",
			cancellationScheduled:
				"You keep full access until then. After that, your account moves to the free plan: you keep every article you saved and can save up to {limit} new links a day.",
			free: "You keep every article you saved and can save up to {limit} new links a day.",
		},
	},
	ageLock: {
		paused: {
			seoTitle: "Account paused — Readplace",
			seoDescription: "This Readplace account is paused.",
			title: "This account is paused",
			body: "The Readplace app reported that the person using this account is under 13, and Readplace is for people 13 and over. The account's email address has a link to unlock it. Unless it is unlocked within 30 days of the pause, the account and its data are deleted.",
			export: "Export your data",
			deleteLabel: "To delete the account now, type: {phrase}",
			deleteSubmit: "Delete the account",
			logout: "Sign out",
		},
		unlock: {
			seoTitle: "Unlock your account — Readplace",
			seoDescription: "Confirm that this Readplace account belongs to someone 13 or over.",
			title: "Unlock your account",
			body: "Confirm that this is your account and that you are 13 or over. The account is then unlocked and will not be deleted.",
			confirm: "This is my account and I am 13 or over",
			doneTitle: "Your account is unlocked",
			doneBody: "Sign in again to keep reading.",
			doneLogin: "Sign in",
			invalidTitle: "This link no longer works",
			invalidBody: "It was already used, it has expired, or the account was deleted.",
		},
	},
} as const;
