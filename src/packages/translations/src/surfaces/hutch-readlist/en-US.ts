export const enUS = {
	readlistPicker: {
		filter: {
			label: "Filter readlists",
			noMatch: "No readlists match",
		},
	},
	readlistAddArticle: {
		trigger: "Upload",
		body: {
			link: "Paste a link.",
			file: "Drop a file: a bookmarks export to review, or a DRM-free EPUB to read.",
		},
	},
	readlistOffline: {
		banner: {
			processing: "Some of these articles weren't downloaded with their content. Open them when you're back online to read them.",
			unavailable: "Readplace couldn't get the content of some of these articles, so they can't be read offline.",
		},
	},
	readlistInboxes: {
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
} as const;
