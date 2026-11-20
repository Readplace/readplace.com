export const enUS = {
	emailDetail: {
		savesHeld: {
			readlist: "No articles were saved to {label}: saving from the Inbox is part of a paid plan.",
			issue: "This issue wasn't saved: saving from the Inbox is part of a paid plan.",
			links: "No links from this email were saved: saving from the Inbox is part of a paid plan.",
		},
		paidPlanLocked: "Saving links from the Inbox is part of a paid plan.",
		readlistLine: {
			failed: "Couldn't choose articles for {label}. Its links were saved to All. Use Keep in {label} on any article you want there.",
		},
	},
	excludedLink: {
		reason: {
			paidPlan: "Not checked: email triage is part of a paid plan.",
		},
		save: {
			label: "Save as article",
			ariaLabel: "Save as article: {url}",
		},
		moved: {
			notice: "Saved as article.",
			link: "View in Articles",
		},
	},
	customEmails: {
		paidPlanLocked: {
			title: "Custom emails are part of a paid plan",
			body: "Emails already sent to your custom emails stay in your Inbox, but their links aren't saved to All on the free plan.",
			link: "See plans",
		},
	},
	liveStatus: {
		savedAsArticle: "Saved as article: {url}",
	},
} as const;
