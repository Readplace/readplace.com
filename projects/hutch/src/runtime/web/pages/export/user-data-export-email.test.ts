import { JSDOM } from "jsdom";
import { buildUserDataExportEmailHtml } from "./user-data-export-email";

const DOWNLOAD_URL =
	"https://hutch-user-exports-prod.s3.ap-southeast-2.amazonaws.com/exports/user-1/2026-10-05T07-31-17-521Z.json?X-Amz-Signature=abc";

const documentOf = (html: string) => new JSDOM(html).window.document;
const readableTextOf = (html: string) => (documentOf(html).body.textContent ?? "").replace(/\s+/g, " ");

describe("buildUserDataExportEmailHtml", () => {
	it("links the download from the button and from a fallback hyperlink, and never prints the long download URL as text", () => {
		const html = buildUserDataExportEmailHtml({ downloadUrl: DOWNLOAD_URL, articleCount: 14, ttlDays: 7 });

		const downloadLinks = [...documentOf(html).querySelectorAll("a")].filter(
			(anchor) => anchor.getAttribute("href") === DOWNLOAD_URL,
		);
		expect(downloadLinks.map((anchor) => anchor.textContent?.trim())).toEqual([
			"Download my data",
			"use this download link",
		]);
		expect(readableTextOf(html)).toContain("If the button above doesn't work, use this download link.");
		expect(readableTextOf(html)).not.toContain(DOWNLOAD_URL);
	});

	it("counts the packaged articles, pluralising from the count", () => {
		expect(readableTextOf(buildUserDataExportEmailHtml({ downloadUrl: DOWNLOAD_URL, articleCount: 1, ttlDays: 7 }))).toContain(
			"I've packaged 1 article as a single JSON file.",
		);
		expect(readableTextOf(buildUserDataExportEmailHtml({ downloadUrl: DOWNLOAD_URL, articleCount: 14, ttlDays: 7 }))).toContain(
			"I've packaged 14 articles as a single JSON file.",
		);
	});
});
