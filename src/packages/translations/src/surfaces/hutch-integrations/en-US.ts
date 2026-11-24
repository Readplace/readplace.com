export const enUS = {
	importReviewDailyLimit: {
		one: "Saved {count} link. You've reached today's limit for new saves; the rest stay selected here so you can save them tomorrow.",
		other: "Saved {count} links. You've reached today's limit for new saves; the rest stay selected here so you can save them tomorrow.",
	},
	connectors: {
		api: {
			name: "Readplace API",
			description: "Build your own app or script that saves, lists, reads and files articles for you.",
			action: "Read the docs",
		},
		customEmails: {
			locked: "Custom emails are part of a paid plan.",
			lock: "Set up custom emails",
			upgrade: "Upgrade",
		},
		gmailDisclaimer: {
			title: "Gmail integration is experimental",
			body: "Readplace never sends or deletes your email. It adds one filter to forward the senders you choose, replacing any filter that already forwards to a Gmail forwarding address Readplace gave you. To list your senders, it reads only the sender, labels and date of your emails, including new ones while Gmail stays connected. It downloads past emails when you choose Import unread messages. After Readplace finishes saving content from a sender you chose, it labels the original imported-to-readplace and marks it as read if it is still unread. Readplace passes the subject, sender and links of each newsletter it receives from Gmail to an AI provider, to pick out its articles and file them in your readlists. When you save an issue, its text goes to that provider too, to prepare it for reading, summarize it and suggest what to read next.",
			ok: "OK",
		},
	},
	saveTip: {
		continue: "Continue here",
	},
	upload: {
		heading: "Upload {kinds}",
		unsupportedType: "That file type isn't supported. Upload {formats}.",
		transcriptAllowance: {
			audio:
				"Audio files get a timestamped transcript, up to {minutes} minutes a day.",
			audioAndVideo:
				"Audio and video files get a timestamped transcript, up to {minutes} minutes a day.",
		},
		kinds: {
			book: {
				noun: "a book",
				format: "a DRM-free EPUB",
				description:
					"Book: EPUB, DRM-free, up to {ceiling}. MOBI and AZW3 are not supported.",
			},
			audio: {
				noun: "an audio file",
				format: "an MP3 or M4A file",
				description: "Audio: MP3 or M4A, up to {ceiling}.",
			},
			video: {
				noun: "a video",
				format: "an MP4 file",
				description: "Video: MP4, up to {ceiling}.",
			},
		},
		refusal: {
			bookQuota: {
				before: "You've reached today's limit for book uploads. You can upload another book after",
				after: ".",
			},
		},
	},
	exportLimitReached: {
		title: "Export limit reached",
		limit: "You've reached today's limit for exports.",
		retry: {
			one: "You can request another export in about {count} hour.",
			other: "You can request another export in about {count} hours.",
		},
		linkStillWorks: "The download link in your latest export email stays valid for {ttlDays} days.",
		backToReadlist: "Back to Readlist",
	},
} as const;
