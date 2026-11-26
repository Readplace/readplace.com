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
			offerHeld: "Newsletter links and issues you removed can be restored for 30 days.",
			removeButton: "Newsletter Links Removal",
			restoreButton: "Restore removed links",
			working: {
				remove: "Removing newsletter links and issues from All, your readlists and the Inbox…",
				restore: "Restoring removed links and issues…",
			},
			result: {
				removed: {
					one: "Removed {count} newsletter link from All and your readlists.",
					other: "Removed {count} newsletter links from All and your readlists.",
				},
				removedIssues: {
					one: "Removed {count} newsletter issue from the Inbox, All and your readlists.",
					other: "Removed {count} newsletter issues from the Inbox, All and your readlists.",
				},
				skipped: {
					one: "{count} link stayed, because you read, highlighted or saved it again, or it couldn't be read.",
					other: "{count} links stayed, because you read, highlighted or saved them again, or they couldn't be read.",
				},
				restored: {
					one: "Restored {count} link to All and its readlists.",
					other: "Restored {count} links to All and their readlists.",
				},
				restoredIssues: {
					one: "Restored {count} issue to the Inbox, All and its readlists.",
					other: "Restored {count} issues to the Inbox, All and their readlists.",
				},
				unrestorable: {
					one: "{count} link couldn't be restored, because its article is no longer stored.",
					other: "{count} links couldn't be restored, because their articles are no longer stored.",
				},
			},
			failed: {
				remove: "Couldn't finish removing newsletter links and issues. What was already removed can be restored for 30 days.",
				restore: "Couldn't finish restoring removed links. Restore again to finish the rest.",
			},
			laterEmails:
				"Later emails from these newsletters still save their links to All. To stop that, stop forwarding the newsletter, disable its custom email, or for a Gmail newsletter change “What to save”.",
		},
		confirm: {
			title: "Newsletter Links Removal",
			counting: "Counting the newsletter links in All…",
			countingLink: "Check again",
			none: "Count the newsletter links and issues to see what would be removed.",
			failed: "Couldn't count the newsletter links in All.",
			countButton: "Count newsletter links",
			tryAgain: "Try again",
			total: {
				one: "{count} newsletter link will be removed.",
				other: "{count} newsletter links will be removed.",
			},
			decision: "Remove these links and issues from every readlist?",
			scopeLegend: "Which links and issues to remove:",
			sendersLegend: "Newsletters with the most links and issues",
			allSenders: "From every newsletter",
			chosenSenders: "Only from the newsletters selected below",
			senderCount: {
				one: "{count} link",
				other: "{count} links",
			},
			senderIssueCount: {
				one: "{count} issue",
				other: "{count} issues",
			},
			senderLinksAndIssues: "{links}, {issues}",
			skipped: "These stay:",
			skippedIssueReason: {
				read: {
					one: "{count} issue you marked as read",
					other: "{count} issues you marked as read",
				},
				highlighted: {
					one: "{count} issue you highlighted",
					other: "{count} issues you highlighted",
				},
			},
			skippedReason: {
				read: {
					one: "{count} link you marked as read",
					other: "{count} links you marked as read",
				},
				highlighted: {
					one: "{count} link you highlighted",
					other: "{count} links you highlighted",
				},
				changed: {
					one: "{count} link saved again or changed",
					other: "{count} links saved again or changed",
				},
				unreadable: {
					one: "{count} link that couldn't be read",
					other: "{count} links that couldn't be read",
				},
			},
			issues: {
				one: "{count} newsletter issue will be removed from the Inbox, All and every readlist.",
				other: "{count} newsletter issues will be removed from the Inbox, All and every readlist.",
			},
			everyReadlist: "They are removed from All and from every readlist they were saved to.",
			keptStay: "Links and issues you marked as read or highlighted stay.",
			restoreWindow: "Removed links can be restored for 30 days.",
			restoreReadlists: "Restore puts each one back in All and in the readlists it was in.",
			submit: "Remove newsletter links",
			popover: {
				title: "Remove from every readlist?",
				body: "This removes these newsletter links and issues from All and from every readlist they were saved to. Links and issues you marked as read or highlighted stay. You can restore what was removed for 30 days.",
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
			sendersLegend: "Newsletters the links and issues came from",
			issues: {
				one: "{count} removed issue can be restored to the Inbox, All and the readlists it was in.",
				other: "{count} removed issues can be restored to the Inbox, All and the readlists they were in.",
			},
			unrestorable: {
				one: "{count} removed link can't be restored, because its article is no longer stored. To keep it, save it again:",
				other: "{count} removed links can't be restored, because their articles are no longer stored. To keep one, save it again:",
			},
			submit: "Restore links",
		},
	},
} as const;
