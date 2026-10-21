import type { OsFamily } from "@packages/web-analytics";
import { epubDownloadGuideFor } from "./epub-download-guide";

const HREFS = {
	downloadHref: "/view/example.com/post?format=epub&utm_source=reader",
	learnMoreHref: "/blog/read-your-saved-articles-on-a-kindle-or-kobo?utm_source=reader",
};

describe("epubDownloadGuideFor", () => {
	it("guides a Windows reader to Thorium Reader on the Microsoft Store", () => {
		expect(epubDownloadGuideFor({ osFamily: "windows", ...HREFS })).toEqual({
			title: "Reading an EPUB on Windows",
			body: "Windows doesn't include an app that opens EPUB files, so the download needs a reader app to open.",
			readerApp: {
				sentence: "Thorium Reader is free on the Microsoft Store and opens EPUB files on Windows.",
				label: "Get Thorium Reader",
				href: "https://apps.microsoft.com/detail/9NFZP1G7M2SC",
			},
			...HREFS,
		});
	});

	it("guides a Linux reader to Foliate on Flathub", () => {
		expect(epubDownloadGuideFor({ osFamily: "linux", ...HREFS })).toEqual({
			title: "Reading an EPUB on Linux",
			body: "Most Linux desktops don't include an app that opens EPUB files, so the download needs a reader app to open.",
			readerApp: {
				sentence: "Foliate is free on Flathub and opens EPUB files on Linux.",
				label: "Get Foliate",
				href: "https://flathub.org/apps/com.github.johnfactotum.Foliate",
			},
			...HREFS,
		});
	});

	it("guides a Chromebook reader to upload the file to Google Play Books", () => {
		expect(epubDownloadGuideFor({ osFamily: "chromeos", ...HREFS })).toEqual({
			title: "Reading an EPUB on a Chromebook",
			body: "ChromeOS doesn't include an app that opens EPUB files, so the download needs a reader app to open.",
			readerApp: {
				sentence: "Google Play Books is free and reads an EPUB uploaded under Your books.",
				label: "Open Google Play Books",
				href: "https://play.google.com/books",
			},
			...HREFS,
		});
	});

	it("leaves every platform that opens an EPUB on its own unguided", () => {
		const ungated: OsFamily[] = ["macos", "ios", "android", "ereader", "other"];
		expect(ungated.map((osFamily) => epubDownloadGuideFor({ osFamily, ...HREFS }))).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		]);
	});
});
