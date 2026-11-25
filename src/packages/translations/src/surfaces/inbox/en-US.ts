export const enUS = {
	senderFilter: { label: "Sender", all: "All senders", unavailable: "No received issues from this sender" },
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
			offerHeld: "Newsletter links you removed can be restored to All for 30 days.",
			removeButton: "Newsletter Links Removal",
			restoreButton: "Restore removed links",
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
					one: "Skipped {count} link you used or that couldn't be read.",
					other: "Skipped {count} links you used or that couldn't be read.",
				},
				restored: {
					one: "Restored {count} link to All.",
					other: "Restored {count} links to All.",
				},
				unrestorable: {
					one: "{count} link couldn't be restored, because its article is no longer stored.",
					other: "{count} links couldn't be restored, because their articles are no longer stored.",
				},
			},
			failed: {
				remove: "Couldn't finish removing newsletter links. Links already removed can be restored for 30 days.",
				restore: "Couldn't finish restoring removed links. Restore again to finish the rest.",
			},
			laterEmails:
				"Later emails from these newsletters still save their links to All. To stop that, stop forwarding the newsletter, disable its custom email, or for a Gmail newsletter change “What to save”.",
		},
		confirm: {
			title: "Newsletter Links Removal",
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
			decision: "Remove these links from All?",
			scopeLegend: "Which links to remove:",
			sendersLegend: "Newsletters with the most links",
			allSenders: "From every newsletter",
			chosenSenders: "Only from the newsletters selected below",
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
				unreadable: "{count} that couldn't be read",
			},
			issues: {
				one: "All holds {count} newsletter issue. It stays.",
				other: "All holds {count} newsletter issues. Every one stays.",
			},
			restoreWindow: "Removed links can be restored for 30 days.",
			otherReadlists: "Copies in your other readlists stay there.",
			beforeMarker:
				"Links you saved yourself from an issue or its email page before {date}, and links you saved by hand before a newsletter linked them, are in the total.",
			submit: "Remove newsletter links",
			back: "Inbox",
		},
		restore: {
			title: "Restore removed links",
			counting: "Counting the links you removed…",
			none: "Count the links you removed to see what can be restored.",
			failed: "Couldn't count the links you removed.",
			countButton: "Count removed links",
			total: {
				one: "{count} removed link can be restored to All.",
				other: "{count} removed links can be restored to All.",
			},
			sendersLegend: "Newsletters the links came from",
			unrestorable: {
				one: "{count} removed link can't be restored, because its article is no longer stored. To keep it, save it again:",
				other: "{count} removed links can't be restored, because their articles are no longer stored. To keep one, save it again:",
			},
			submit: "Restore links",
		},
	},
} as const;
