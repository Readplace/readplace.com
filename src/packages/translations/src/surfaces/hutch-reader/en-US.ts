export const enUS = {
	readerOffline: {
		banner: {
			unavailable: "Readplace couldn't get this article's content, so it can't be read offline.",
		},
	},
	articleBody: {
		highlightToolbar: {
			beta: "Beta",
		},
		highlightNote: {
			delete: "Delete note",
		},
		highlightPopover: {
			title: "Highlight actions",
			hint: "Opens this highlight's actions",
		},
		highlightsRail: {
			title: "Highlights",
			notFound: "Not found in this version",
			highlightedOn: "Highlighted",
			edited: "Edited in this version. You highlighted: “{quote}”",
			jump: "Jump",
			addNote: "Add note",
			editNote: "Edit note",
			deleteHighlight: "Delete highlight",
			deleteConfirm: {
				title: "Delete this highlight?",
				body: "The passage stays in the article; only your highlight is removed.",
				bodyWithNote: "The passage stays in the article; your highlight and its note are removed.",
			},
		},
		highlightExport: {
			edited: "(edited in the current version; you highlighted “{quote}”)",
			notFound: "(not found in the current version)",
		},
		readerFailed: {
			title: {
				linkSaved: "Your link is saved",
				notFound: "Link saved, but the article is unavailable",
				captureUnreadable: "Readplace copied the page, but it isn't an article",
				captureMissing: "The copy from your device didn't arrive",
				processingFailed: "We couldn't prepare this upload",
				audioSaved: "Your audio is saved",
				ocrPagesHeld: "This PDF is waiting for today's page allowance",
			},
			explanation: {
				unsupported: "This type of page isn't supported in the Readplace reader yet. You can still open it on the original site.",
				failed: "Readplace couldn't load the full article from this site. You can still read it on the original website, or save the full page using {alternatives}.",
				blocked: "This site blocked Readplace from loading the full article. Use {alternatives} to save the complete page instead.",
				slow: "Reader view is taking longer than usual.",
				originDown: "Readplace couldn't reach this site right now. It may be temporarily unavailable, so you can try again later.",
				notFound: "This page no longer appears to exist, so Readplace couldn't retrieve the article content.",
				notAnArticle: "This link isn't an article, so it can't be shown in reader view.",
				captureUnreadable: "The saved copy of this page has no article in it to show in reader view. You can read it on the original site, or capture it again once the article has loaded.",
				captureMissing: "Readplace didn't receive a copy of this page from your device. You can capture it again, or read it on the original site.",
				processingFailed: "Readplace couldn't finish preparing this file. You can upload it again.",
				noSpeech: "No speech was found in this file, so there's no transcript.",
				transcriptFailed: "Readplace couldn't transcribe this file. You can upload it again.",
				ocrPagesHeld: {
					beforeRetryAt: "This file has {pages} pages, more than your free account has left today, so Readplace has not read it yet. Try again after",
					afterRetryAt: ", or upgrade for no daily limit.",
					overDailyLimit: "This file has {pages} pages, more than a free account can read in a day. Upgrade for no daily limit.",
				},
			},
			cta: {
				readOriginal: "Read original article",
				visitOriginal: "Visit original page",
				uploadAgain: "Upload again",
			},
			captureHere: "Capture it here",
			capturePitch: {
				title: "Want the full article in Readplace? Save it with {alternatives}.",
				link: "See ways to save",
			},
		},
		report: {
			trigger: "Report this article",
			title: "Report this article",
			body: "Tell us what's wrong. Every field is optional.",
			reason: {
				legend: "What's the problem?",
				badSummary: "Bad summary",
				wrongInformation: "Wrong information",
				spamAbuse: "Spam or abuse",
				illegalContent: "Illegal content",
				other: "Other",
			},
			details: "Details",
			email: "Your email (optional)",
			send: "Send report",
			cancel: "Cancel",
			close: "Close",
			sent: "Thanks, your report was sent.",
			failed: "Your report couldn't be sent. Try again in a moment.",
		},
	},
	view: {
		crawlLimit: {
			seoTitle: "Create a free account to keep reading — Readplace",
			seoDescription: "You've reached the daily limit for new links.",
			title: "You've reached the daily limit for new links",
			body: "Create a free account to keep reading. We'll save this article to your readlist so it's waiting for you.",
			signup: "Create a free account",
			login: "Log in",
			wait: "Or come back in about {wait}.",
			minutes: { one: "{count} minute", other: "{count} minutes" },
			hours: { one: "{count} hour", other: "{count} hours" },
		},
		highlights: {
			title: "Highlights",
			kept: "Kept in this browser only. Up to {limit}.",
			elsewhere: "On other articles",
			notFound: "Not found in this version",
			jump: "Jump",
			addNote: "Add note",
			editNote: "Edit note",
			noteLabel: "Note",
			saveNote: "Save note",
			popup: {
				title: "Keep your highlights",
				body: "This browser keeps up to {limit} highlights. Create a free account to keep them and add as many as you like.",
				tooLong: "A passage or note longer than {max} characters needs an account.",
			},
			actions: {
				signup: "Create a free account",
				login: "Log in",
				notNow: "Not now",
			},
		},
		highlightsClaim: {
			title: "Keep your highlights",
			body: "Adding the highlights you made in this browser to your account.",
			submit: "Keep my highlights",
		},
		endCta: {
			founderLine:
				"You just read one of my posts in Readplace. I built it so the articles I meant to read would still be there when I had time for them.",
			founderSignOff: "— Fayner Brack, Founder & CEO",
			saveLabel: "Save it to my free account",
		},
	},
	reader: {
		nextRead: {
			lock: "Find your next read",
		},
		dailySaveLimit: {
			title: "You've reached today's limit for new saves",
			body: "Links you already saved still open. You can open new links again after the daily reset.",
			backToReadlist: "Back to Readlist",
		},
		share: {
			lead: "Copy a link to this article or send it to an app.",
			link: {
				readerView: "Reader view",
				original: "Original link",
			},
			copy: {
				readerView: "Copy reader view link",
				original: "Copy original link",
			},
			choice: {
				legend: "Send to an app",
			},
		},
		sharingOff: {
			privateUpload: {
				title: "Sharing is off",
				body: "This is your private upload, so only you can open it. It has no public link to share.",
			},
		},
	},
} as const;
