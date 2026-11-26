export const enUS = {
	senderFilter: { label: "Sender", filter: "Filter senders", all: "All senders", unavailable: "No received issues from this sender" },
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
	inboxDelivery: {
		emails: "Newsletters sent to your Readplace inboxes or forwarded from enabled Gmail senders appear here. Readplace checks their article links against your saved readlist preferences. Your Gmail delivery choice controls whether it also saves the issue itself or every article link.",
		addresses: "Subscribe with one of these custom emails or forward an issue to it. The issue stays in Inbox. Readplace saves its article links to All and checks them against your saved readlist preferences.",
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
			offerHeld: "Newsletter links you removed can be restored to All and their readlists for 30 days.",
			removeButton: "Newsletter Links Removal",
			restoreButton: "Restore removed links",
			working: {
				remove: "Removing newsletter links from All and your readlists…",
				restore: "Restoring removed links to All and their readlists…",
			},
			result: {
				removed: {
					one: "Removed {count} newsletter link from All and your readlists.",
					other: "Removed {count} newsletter links from All and your readlists.",
				},
				skipped: {
					one: "{count} link stayed, because you read, highlighted or saved it again, or it couldn't be read.",
					other: "{count} links stayed, because you read, highlighted or saved them again, or they couldn't be read.",
				},
				restored: {
					one: "Restored {count} link to All and its readlists.",
					other: "Restored {count} links to All and their readlists.",
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
				one: "{count} newsletter link will be removed.",
				other: "{count} newsletter links will be removed.",
			},
			decision: "Remove these links from every readlist?",
			scopeLegend: "Which links to remove:",
			sendersLegend: "Newsletters with the most links",
			allSenders: "From every newsletter",
			chosenSenders: "Only from the newsletters selected below",
			senderCount: {
				one: "{count} link",
				other: "{count} links",
			},
			skipped: {
				one: "{count} link will stay:",
				other: "{count} links will stay:",
			},
			skippedReason: {
				read: "{count} you marked as read",
				highlighted: "{count} you highlighted",
				changed: "{count} saved again or changed",
				unreadable: "{count} that couldn't be read",
			},
			issues: {
				one: "All holds {count} newsletter issue. It stays.",
				other: "All holds {count} newsletter issues. Every one stays.",
			},
			everyReadlist: "They are removed from All and from every readlist they were saved to.",
			keptStay: "Links you marked as read or highlighted stay.",
			restoreWindow: "Removed links can be restored for 30 days.",
			restoreReadlists: "Restore puts each one back in All and in the readlists it was in.",
			submit: "Remove newsletter links",
			popover: {
				title: "Remove from every readlist?",
				body: "This removes these newsletter links from All and from every readlist they were saved to. Links you marked as read or highlighted stay. You can restore what was removed for 30 days.",
				cancel: "Cancel",
			},
			back: "Inbox",
		},
		restore: {
			title: "Restore removed links",
			counting: "Counting the links you removed…",
			none: "Count the links you removed to see what can be restored.",
			failed: "Couldn't count the links you removed.",
			countButton: "Count removed links",
			total: {
				one: "{count} removed link can be restored to All and to the readlists it was in.",
				other: "{count} removed links can be restored to All and to the readlists they were in.",
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
