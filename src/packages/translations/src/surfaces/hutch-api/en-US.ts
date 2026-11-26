export const enUS = {
	saveLimit: {
		daily: "You've reached today's limit for new saves. Links you already saved still open.",
		ocrPages: "You've used today's PDF page allowance. Try again tomorrow, or upgrade for no daily limit.",
	},
	paidFeature: {
		refused: "This feature isn't on the free plan.",
	},
	ageAccess: {
		refusedUnder13: "Readplace is for people 13 and over.",
		refusedParentalApproval: "A parent or guardian needs to approve Readplace in the app store before you can use it.",
		accountPaused: "This account is paused. Check its email for how to unlock it.",
	},
	ocrPagesHeld: {
		warning: "This PDF has {pages} pages, more than are left in today's allowance.",
	},
	homeReadlist: {
		setAction: "Set {label} as home",
	},
	readlistDestination: {
		preferences: "Preferences",
		integrations: "Connectors",
	},
	handPickedHint: {
		text: "Older saves stay in the default readlist. To add one to Hand Picked, use “Add to readlist” on the web.",
		link: "Open the default readlist on the web",
	},
	findArticles: {
		search: "Search articles or sources",
		readingTime: "Reading time",
		savedDate: "Saved date",
		time: {
			under5: "Under 5 min",
			from5To10: "5–10 min",
			from10To20: "10–20 min",
			over20: "20+ min",
		},
		saved: {
			today: "Today",
			week: "This week",
			month: "This month",
			older: "Older",
		},
		noMatches: "No matching articles",
		clearSearch: "Clear search",
		clearFilters: "Clear filters",
		clearAll: "Clear search and filters",
	},
} as const;
