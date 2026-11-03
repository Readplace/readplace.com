import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PDF_BYTES, MAX_PDF_PAGES, OCR_SCRIPT_PACKS } from "@packages/crawl-article";
import { INBOX_ADDRESS_MAX_PER_USER } from "@packages/domain/inbox";
import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { LANDING_PAGE_CONTENT } from "./web/pages/landing-pages";
import { PRICE_STATEMENT } from "./web/price-statement";

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
		expect(FILES[name]).toContain(PRICE_STATEMENT);
		expect([...new Set(FILES[name].match(/\$\d+(?:\.\d+)?/g))].sort()).toEqual(AMOUNTS_BY_FILE[name]);
	});

	it.each(FILE_NAMES)("%s quotes the PDF limits from their constants", (name) => {
		expect(FILES[name]).toContain(`${MAX_PDF_PAGES} pages`);
		expect(FILES[name]).toContain(MAX_PDF_BYTES.label);
		expect(FILES[name]).toContain(`${OCR_SCRIPT_PACKS.length} scripts`);
	});

	it("llms-full.txt quotes the readlist cap from its constant", () => {
		expect(FILES["llms-full.txt"]).toContain(`Up to ${READLIST_MAX_PER_USER} named readlists`);
	});

	it("llms-full.txt says what newsletters send to DeepSeek in both privacy passages", () => {
		const sentence = "For newsletters, each issue's subject, sender, link addresses and link text are sent to DeepSeek to tell articles from ads and menus, and, for a readlist you described, what you wrote and the articles you kept in it or took out of it are sent with them to choose which fit.";

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
