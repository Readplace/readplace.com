export const enUS = {
	importReviewDailyLimit: {
		one: "Saved {count} link. You've reached today's limit for new saves; the rest stay selected here so you can save them tomorrow.",
		other: "Saved {count} links. You've reached today's limit for new saves; the rest stay selected here so you can save them tomorrow.",
	},
	connectors: {
		api: {
			before: "Building something of your own? The ",
			link: "Readplace API",
			after: " lets your app save, list, read and file articles for you.",
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
		limit: {
			one: "You can request up to {count} export a day.",
			other: "You can request up to {count} exports a day.",
		},
		retry: {
			one: "You can request another export in about {count} hour.",
			other: "You can request another export in about {count} hours.",
		},
		linkStillWorks: "The download link in your latest export email stays valid for {ttlDays} days.",
		backToReadlist: "Back to Readlist",
	},
} as const;
