import type { OsFamily } from "@packages/web-analytics";

export const EPUB_GUIDE_CONTENT = "epub-guide-kindle-kobo";

export const KINDLE_GUIDE_PATH = "/blog/read-your-saved-articles-on-a-kindle-or-kobo";

export type EpubGuidePlatform = "windows" | "linux" | "chromeos";

interface EpubGuideCopy {
	title: string;
	body: string;
	readerApp: { sentence: string; label: string; href: string };
}

export interface EpubDownloadGuide extends EpubGuideCopy {
	platform: EpubGuidePlatform;
	downloadHref: string;
	learnMoreHref: string;
}

const GUIDED_OS: Partial<Record<OsFamily, EpubGuidePlatform>> = {
	windows: "windows",
	linux: "linux",
	chromeos: "chromeos",
};

const GUIDE_COPY: Record<EpubGuidePlatform, EpubGuideCopy> = {
	windows: {
		title: "Reading an EPUB on Windows",
		body: "Windows doesn't include an app that opens EPUB files, so the download needs a reader app to open.",
		readerApp: {
			sentence: "Thorium Reader is free on the Microsoft Store and opens EPUB files on Windows.",
			label: "Get Thorium Reader",
			href: "https://apps.microsoft.com/detail/9NFZP1G7M2SC",
		},
	},
	linux: {
		title: "Reading an EPUB on Linux",
		body: "Most Linux desktops don't include an app that opens EPUB files, so the download needs a reader app to open.",
		readerApp: {
			sentence: "Foliate is free on Flathub and opens EPUB files on Linux.",
			label: "Get Foliate",
			href: "https://flathub.org/apps/com.github.johnfactotum.Foliate",
		},
	},
	chromeos: {
		title: "Reading an EPUB on a Chromebook",
		body: "ChromeOS doesn't include an app that opens EPUB files, so the download needs a reader app to open.",
		readerApp: {
			sentence: "Google Play Books is free and reads an EPUB uploaded under Your books.",
			label: "Open Google Play Books",
			href: "https://play.google.com/books",
		},
	},
};

export function epubDownloadGuideFor(input: {
	osFamily: OsFamily;
	downloadHref: string;
	learnMoreHref: string;
}): EpubDownloadGuide | undefined {
	const platform = GUIDED_OS[input.osFamily];
	if (platform === undefined) return undefined;
	return {
		platform,
		...GUIDE_COPY[platform],
		downloadHref: input.downloadHref,
		learnMoreHref: input.learnMoreHref,
	};
}
