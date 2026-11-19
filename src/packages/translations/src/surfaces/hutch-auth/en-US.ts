export const enUS = {
	forgotPassword: {
		sent: {
			limit: "A reset link can be sent to the same address up to {count} times a day. If none arrives, check your spam folder or try again later.",
		},
		ipPausedUnderAnHour: "Reset links from this network are paused. Try again in less than an hour.",
		ipPaused: {
			one: "Reset links from this network are paused. Try again in about {count} hour.",
			other: "Reset links from this network are paused. Try again in about {count} hours.",
		},
	},
	signup: {
		allowanceSpent: {
			one: "This network has reached today's limit of {count} new Readplace account. Sign in to an account you already have, or try again tomorrow.",
			other: "This network has reached today's limit of {count} new Readplace accounts. Sign in to an account you already have, or try again tomorrow.",
		},
	},
} as const;
