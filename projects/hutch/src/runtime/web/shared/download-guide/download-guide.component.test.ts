import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { epubDownloadGuideFor, type EpubGuidePlatform } from "../epub/epub-download-guide";
import { renderDownloadGuideDialog } from "./download-guide.component";

const DOWNLOAD_HREF = "/view/example.com/post?format=epub&utm_source=reader&utm_medium=internal&utm_content=download-epub";
const LEARN_MORE_HREF =
	"/blog/read-your-saved-articles-on-a-kindle-or-kobo?utm_source=reader&utm_medium=internal&utm_content=epub-guide-kindle-kobo";

function dialogFor(platform: EpubGuidePlatform): Element {
	const guide = epubDownloadGuideFor({ osFamily: platform, downloadHref: DOWNLOAD_HREF, learnMoreHref: LEARN_MORE_HREF });
	assert(guide, `${platform} must be guided`);
	const doc = new JSDOM(`<!doctype html><html><body>${renderDownloadGuideDialog(guide)}</body></html>`).window.document;
	const dialog = doc.querySelector('[data-test-confirm-popover="download-guide"]');
	assert(dialog, "the download guide dialog must render");
	return dialog;
}

describe("renderDownloadGuideDialog", () => {
	it("opens as a titled dialog whose only way out is Cancel", () => {
		const dialog = dialogFor("windows");

		expect(dialog.id).toBe("reader-download-guide");
		expect(Array.from(dialog.querySelectorAll(".confirm-popover__close"))).toEqual([]);
		const cancel = dialog.querySelector('[data-test-action="download-guide-cancel"]');
		assert(cancel, "the dialog must offer Cancel");
		expect([cancel.getAttribute("popovertarget"), cancel.getAttribute("popovertargetaction")]).toEqual([
			"reader-download-guide",
			"hide",
		]);
	});

	it("names the platform and why the file needs a reader app", () => {
		expect(
			(["windows", "linux", "chromeos"] as const).map((platform) => {
				const dialog = dialogFor(platform);
				return [
					dialog.querySelector(".confirm-popover__title")?.textContent,
					dialog.querySelector("#reader-download-guide-body")?.textContent,
				];
			}),
		).toEqual([
			[
				"Reading an EPUB on Windows",
				"Windows doesn't include an app that opens EPUB files, so the download needs a reader app to open.",
			],
			[
				"Reading an EPUB on Linux",
				"Most Linux desktops don't include an app that opens EPUB files, so the download needs a reader app to open.",
			],
			[
				"Reading an EPUB on a Chromebook",
				"ChromeOS doesn't include an app that opens EPUB files, so the download needs a reader app to open.",
			],
		]);
	});

	it("links the platform's free reader app in a new tab and the Kindle and Kobo guide on our own site", () => {
		const dialog = dialogFor("linux");

		const readerApp = dialog.querySelector("[data-test-download-reader-app]");
		assert(readerApp, "the dialog must link a reader app");
		expect([
			readerApp.getAttribute("href"),
			readerApp.getAttribute("target"),
			readerApp.getAttribute("rel"),
			readerApp.textContent,
		]).toEqual(["https://flathub.org/apps/com.github.johnfactotum.Foliate", "_blank", "noopener", "Get Foliate"]);
		const learnMore = dialog.querySelector("[data-test-download-learn-more]");
		assert(learnMore, "the dialog must link the Kindle and Kobo guide");
		expect([learnMore.getAttribute("href"), learnMore.getAttribute("target")]).toEqual([LEARN_MORE_HREF, null]);
	});

	it("puts Cancel before the download, which the dialog opens on", () => {
		const dialog = dialogFor("chromeos");

		const actions = dialog.querySelector(".confirm-popover__actions");
		assert(actions, "the dialog must render its actions");
		expect(
			Array.from(actions.children, (child) => [
				child.tagName,
				child.getAttribute("data-test-action") ?? child.getAttribute("data-test-download"),
			]),
		).toEqual([
			["BUTTON", "download-guide-cancel"],
			["A", "epub"],
		]);
		const download = actions.querySelector('[data-test-download="epub"]');
		assert(download, "the dialog must hold the download");
		expect([download.getAttribute("href"), download.hasAttribute("autofocus"), download.className]).toEqual([
			DOWNLOAD_HREF,
			true,
			"btn btn--primary",
		]);
	});
});
