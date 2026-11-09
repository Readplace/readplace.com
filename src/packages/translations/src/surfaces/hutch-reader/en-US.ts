export const enUS = {
	articleBody: {
		highlightToolbar: {
			beta: "Beta",
		},
		readerFailed: {
			title: {
				linkSaved: "Your link is saved",
				notFound: "Link saved, but the article is unavailable",
				captureUnreadable: "Readplace copied the page, but it isn't an article",
				captureMissing: "The copy from your device didn't arrive",
				processingFailed: "We couldn't prepare this upload",
				audioSaved: "Your audio is saved",
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
	},
} as const;
