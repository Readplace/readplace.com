export const enUS = {
	smartReadlist: {
		title: "Create a Smart Readlist",
		create: "Create a readlist",
		name: "Readlist name",
		preferences: "Set preferences",
		open: "Open Smart Readlist",
		all: "Open All",
		start: "Create a readlist, then open Preferences and set its purpose.",
		configure: "Set a custom readlist’s purpose in Preferences to make it a Smart Readlist.",
		file: "Open the “All” readlist, choose an article, and use Add to file it in your Smart Readlist. If your library is empty, save a link there first.",
		progress: "{count}/10 articles saved to Smart Readlists",
		unavailable: "Progress unavailable",
	},
	readlistPicker: {
		filter: {
			label: "Filter readlists",
			noMatch: "No readlists match",
		},
		addSelected: "Add",
		added: {
			one: "Added to {count} readlist",
			other: "Added to {count} readlists",
		},
	},
	readlistAddArticle: {
		trigger: "Upload",
		body: {
			link: "Paste a link.",
			file: "Drop a file: a bookmarks export to review, or a book, audio file, or video to read.",
		},
		fallback: {
			upload: "Upload a file",
		},
	},
	readlistEmpty: {
		nothingSaved: {
			invite: {
				extension: "Save your first article with the {button} button, or use the Readplace browser extension to save it in one click.",
				iphone: "Save your first article with the {button} button, or use the Readplace iPhone app to save it from the share sheet.",
				android: "Save your first article with the {button} button, or use the Readplace Android app to save it from the share sheet.",
				other: "Save your first article with the {button} button, or set up one-tap saving from {surfaces}.",
			},
		},
	},
	readlistOffline: {
		banner: {
			processing: "Some of these articles weren't downloaded with their content. Open them when you're back online to read them.",
			unavailable: "Readplace couldn't get the content of some of these articles, so they can't be read offline.",
		},
	},
	readlistInboxes: {
		locked: {
			note: "Readlist inbox emails are part of a paid plan.",
		},
		create: {
			label: "Name a new custom email",
			placeholder: "e.g. my-newsletter",
			submit: "Create custom email",
			created: "Created the custom email \"{name}\" for this readlist",
			errors: {
				invalidName: "Give the custom email a name using letters, numbers, and hyphens — for example, my-newsletter.",
				nameTaken: "You already have an active custom email with that name. Pick a different one.",
			},
			alerts: {
				limit: {
					title: "Custom email limit reached",
					body: "You've reached the maximum of {max} custom emails. Disable any you no longer need before enabling or creating more.",
				},
				failed: {
					title: "Couldn't create a custom email",
					body: "Try again in a moment.",
				},
			},
		},
	},
	readlistNav: {
		title: "Readlists",
		currentLabel: "Current readlist:",
		more: {
			label: "More readlists",
			count: "({count})",
			close: "Close",
			create: "Create a readlist",
			createSubmit: "Create readlist",
		},
		pin: {
			pin: "Pin",
			unpin: "Unpin",
			alerts: {
				limit: {
					title: "Pin limit reached",
					body: "You can pin up to {max} readlists. Unpin one before pinning another.",
				},
			},
		},
	},
	readlistSaveLimit: {
		formError: "You've reached today's limit for new saves.",
	},
	readlistSubscription: {
		free: {
			chip: "Free plan",
			title: "You're on the free plan",
			body: "Your saved articles are all here, and you can keep saving new links within a daily limit. Upgrade for the Inbox, Next read, Past reads, Gmail and no daily limits.",
			dismiss: "Dismiss the free plan banner",
		},
	},
	readlistChoices: {
		info: {
			button: "What are your choices?",
			title: "About your choices",
			body: "When a newsletter issue reaches this readlist, the AI decides which of its links fit the purpose. Each time you tap Keep or Doesn't fit on an email, Readplace saves your call here. The next time it sorts an issue, the AI reads your 20 newest choices as examples of what you keep and skip. Remove a choice to stop it counting.",
		},
	},
	readlistKeepOffer: {
		withoutCard: "Without a card, your account moves to the free plan when the trial ends and keeps everything you saved.",
	},
} as const;
