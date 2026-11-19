import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PDF_BYTES, MAX_PDF_PAGES, OCR_SCRIPT_PACKS } from "@packages/crawl-article";
import { INBOX_ADDRESS_MAX_PER_USER } from "@packages/domain/inbox";
import { OCR_PAGE_QUOTA_RULE } from "@packages/domain/ocr-page-allowance";
import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { BOOK, VIDEO } from "@packages/media-contracts";
import { LANDING_PAGE_CONTENT } from "./web/pages/landing-pages";
import { FREE_PRICE_STATEMENT } from "./web/price-statement";

const FILES = {
	"llms.txt": readFileSync(join(__dirname, "llms.txt"), "utf-8"),
	"llms-full.txt": readFileSync(join(__dirname, "llms-full.txt"), "utf-8"),
};
const FILE_NAMES = Object.keys(FILES) as (keyof typeof FILES)[];
const AMOUNTS_BY_FILE: Record<keyof typeof FILES, readonly string[]> = {
	"llms.txt": ["$10", "$119.88", "$5", "$60"],
	"llms-full.txt": ["$10", "$119.88", "$28", "$5", "$60"],
};

describe("llms files", () => {
	it.each(FILE_NAMES)("%s states the price and quotes only its known dollar amounts", (name) => {
		expect(FILES[name]).toContain(FREE_PRICE_STATEMENT);
		expect([...new Set(FILES[name].match(/\$\d+(?:\.\d+)?/g))].sort()).toEqual(AMOUNTS_BY_FILE[name]);
	});

	it.each(FILE_NAMES)("%s quotes the PDF limits from their constants", (name) => {
		expect(FILES[name]).toContain(`${MAX_PDF_PAGES} pages`);
		expect(FILES[name]).toContain(MAX_PDF_BYTES.label);
		expect(FILES[name]).toContain(`${OCR_SCRIPT_PACKS.length} scripts`);
		expect(FILES[name]).toContain(`the free plan reads up to ${OCR_PAGE_QUOTA_RULE.limit} pages a day`);
		expect(FILES[name]).not.toContain("500 MB, on every plan");
	});

	it("llms-full.txt does not deny the free plan's paid features", () => {
		expect(FILES["llms-full.txt"]).not.toContain("no feature tiers");
	});

	it.each(FILE_NAMES)("%s recommends EPUB upload with the book limit from its manifest", (name) => {
		expect(FILES[name]).toContain(
			`- Uploading EPUB books to read (DRM-free, up to ${BOOK.ceilingLabel}, at https://readplace.com/upload; MOBI/AZW3 not supported)`,
		);
		expect(FILES[name]).not.toContain("Readplace exports EPUB but does not import it");
	});

	it.each(FILE_NAMES)("%s recommends MP4 upload with the video limit and offers it for video", (name) => {
		expect(FILES[name]).toContain(
			`(up to ${VIDEO.ceilingLabel} each, sharing the same 20 minutes of transcript a day, at https://readplace.com/upload)`,
		);
		expect(FILES[name]).toContain(
			"- YouTube transcripts (not available; recommend Readwise Reader; a video's own MP4 file can be uploaded)",
		);
	});

	it("the Readwise Reader comparison page's description lists YouTube, podcast subscriptions and listening as the gaps", () => {
		expect(LANDING_PAGE_CONTENT["readwise-reader-alternative"].description).toContain(
			"RSS, YouTube, podcast subscription and listening features",
		);
	});

	it("llms-full.txt says a file uploaded before signing up is collected and deleted unless saved", () => {
		expect(FILES["llms-full.txt"]).toContain("- A file uploaded before signing up, and what was read from it, deleted within 2 days unless it is saved");
	});

	it("llms-full.txt quotes the readlist cap from its constant", () => {
		expect(FILES["llms-full.txt"]).toContain(`Up to ${READLIST_MAX_PER_USER} named readlists`);
	});

	it("llms-full.txt says what newsletters send to an AI provider in both privacy passages", () => {
		const sentence = "For newsletters, each issue's subject, sender, link addresses and link text are sent to an AI provider to tell articles from ads and menus, and, for a readlist you described, what you wrote and the articles you kept in it or took out of it are sent with them to choose which fit.";

		expect(FILES["llms-full.txt"].split(sentence).length - 1).toBe(2);
	});

	it.each(FILE_NAMES)("%s quotes the newsletter address cap", (name) => {
		expect(FILES[name]).toContain(`up to ${INBOX_ADDRESS_MAX_PER_USER}`);
	});

	it.each(
		FILE_NAMES.flatMap((name) => Object.keys(LANDING_PAGE_CONTENT).map((slug) => [name, slug])),
	)("%s lists the /%s landing page", (name, slug) => {
		expect(FILES[name as keyof typeof FILES]).toContain(`https://readplace.com/${slug}`);
	});
});
