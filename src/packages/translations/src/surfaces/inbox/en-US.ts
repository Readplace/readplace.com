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
	newsletterLinks: {
		line: {
			offer: "All holds links saved from your newsletters.",
			removeButton: "Remove newsletter links",
			working: {
				remove: "Removing newsletter links from All…",
				restore: "Restoring removed links to All…",
			},
			result: {
				removed: {
					one: "Removed {count} newsletter link from All.",
					other: "Removed {count} newsletter links from All.",
				},
				skipped: {
					one: "Skipped {count} link you read, opened, highlighted or saved again.",
					other: "Skipped {count} links you read, opened, highlighted or saved again.",
				},
				restored: {
					one: "Restored {count} link to All.",
					other: "Restored {count} links to All.",
				},
				unrestorable: {
					one: "{count} link could not be restored.",
					other: "{count} links could not be restored.",
				},
			},
			failed: {
				remove: "Couldn't finish removing newsletter links. Links already removed can be restored for 30 days.",
				restore: "Couldn't finish restoring removed links.",
			},
			laterEmails:
				"Later emails from these newsletters still save their links to All. To stop that, stop forwarding the newsletter, disable its custom email, or for a Gmail newsletter change “What to save”.",
		},
		confirm: {
			title: "Remove newsletter links",
			counting: "Counting the newsletter links in All…",
			countingLink: "Check again",
			none: "Count the newsletter links in All to see what would be removed.",
			failed: "Couldn't count the newsletter links in All.",
			countButton: "Count newsletter links",
			tryAgain: "Try again",
			total: {
				one: "{count} unread newsletter link in All will be removed.",
				other: "{count} unread newsletter links in All will be removed.",
			},
			sendersLegend: "Newsletters with the most links",
			allSenders: "From every newsletter",
			chosenSenders: "Only from the newsletters I tick",
			senderCount: {
				one: "{count} link",
				other: "{count} links",
			},
			skipped: {
				one: "{count} link will be skipped:",
				other: "{count} links will be skipped:",
			},
			skippedReason: {
				read: "{count} you read",
				opened: "{count} you opened",
				highlighted: "{count} you highlighted",
				changed: "{count} saved again or changed",
				unreadable: "{count} that could not be read",
			},
			issues: {
				one: "All holds {count} newsletter issue. It stays.",
				other: "All holds {count} newsletter issues. Every one stays.",
			},
			restoreWindow: "Removed links can be restored for 30 days.",
			restoreNeedsPlan:
				"Restoring them is part of a paid plan: if your plan ends, renew it within those 30 days or the removed links expire.",
			otherReadlists: "Copies in your other readlists stay there.",
			beforeMarker:
				"Links you saved yourself from an issue or its email page before {date}, and links you saved by hand before a newsletter linked them, are in the total.",
			submit: "Remove newsletter links",
			back: "Back to Inbox",
		},
	},
} as const;
