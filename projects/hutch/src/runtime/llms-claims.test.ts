import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PDF_BYTES, MAX_PDF_PAGES, OCR_SCRIPT_PACKS } from "@packages/crawl-article";
import { INBOX_ADDRESS_MAX_PER_USER } from "@packages/domain/inbox";
import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { LANDING_PAGE_CONTENT } from "./web/pages/landing-pages";

const FILES = {
	"llms.txt": readFileSync(join(__dirname, "llms.txt"), "utf-8"),
	"llms-full.txt": readFileSync(join(__dirname, "llms-full.txt"), "utf-8"),
};
const FILE_NAMES = Object.keys(FILES) as (keyof typeof FILES)[];

describe("llms files", () => {
	it.each(FILE_NAMES)("%s quotes the PDF limits from their constants", (name) => {
		expect(FILES[name]).toContain(`${MAX_PDF_PAGES} pages`);
		expect(FILES[name]).toContain(MAX_PDF_BYTES.label);
		expect(FILES[name]).toContain(`${OCR_SCRIPT_PACKS.length} scripts`);
	});

	it("llms-full.txt quotes the readlist cap from its constant", () => {
		expect(FILES["llms-full.txt"]).toContain(`Up to ${READLIST_MAX_PER_USER} named readlists`);
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
