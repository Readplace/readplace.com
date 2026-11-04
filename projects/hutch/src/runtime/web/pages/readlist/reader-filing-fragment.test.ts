import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { renderReaderFilingFragment } from "./reader-filing-fragment";

const WORK = ReadlistSlugSchema.parse("work");

function oobIdsOf(html: string): string[] {
	const doc = new JSDOM(`<body>${html}</body>`).window.document;
	return Array.from(doc.querySelectorAll("[hx-swap-oob]"), (element) => element.id);
}

const NOTHING_LEFT_TO_FILE = {
	tags: undefined,
	picker: undefined,
	markStatusConfirmReadlists: undefined,
	toast: undefined,
};

const CONFIRM = {
	articleId: "abc",
	popoverId: "readlist-mark-status-confirm-abc",
	url: "/queue/abc/status",
	status: "read" as const,
	readlists: [
		{ slug: WORK, label: "Work" },
		{ slug: ReadlistSlugSchema.parse("later"), label: "Later" },
	],
};

describe("renderReaderFilingFragment", () => {
	it("answers the tags, the picker slot and the toast mount without a mark-status popover to refresh", () => {
		const html = renderReaderFilingFragment({ filing: NOTHING_LEFT_TO_FILE, markStatusConfirm: undefined });

		expect(oobIdsOf(html)).toEqual(["reader-readlist-tags", "reader-readlists-slot", "status-toast"]);
	});

	it("adds the mark-status popover when one guards the article", () => {
		const html = renderReaderFilingFragment({ filing: NOTHING_LEFT_TO_FILE, markStatusConfirm: CONFIRM });

		expect(oobIdsOf(html)).toEqual([
			"reader-readlist-tags",
			"reader-readlists-slot",
			"readlist-mark-status-confirm-abc",
			"status-toast",
		]);
	});
});
