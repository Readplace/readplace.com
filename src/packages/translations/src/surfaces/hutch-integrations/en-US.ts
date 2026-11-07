export const enUS = {
	upload: {
		heading: "Upload {kinds}",
		unsupportedType: "That file type isn't supported. Upload {formats}.",
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
	},
} as const;
