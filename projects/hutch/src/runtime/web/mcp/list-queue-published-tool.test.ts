import { LIST_QUEUE_PUBLISHED_TOOL } from "./list-queue-published-tool";
import { LIST_READLIST_ARTICLES_LEGACY_NAME } from "./tool-definitions";

describe("the list_queue definition ChatGPT runs", () => {
	it("is byte for byte the definition OpenAI's plugin directory published from the 2026-09-10 scan, so a scan finds it unchanged", () => {
		expect(JSON.stringify(LIST_QUEUE_PUBLISHED_TOOL)).toBe(
			'{"name":"list_queue","title":"List saved articles","description":"List the pages the user has saved to their Readplace reading readlist, optionally filtered to unread or already-read items. Each item includes an `id` you can pass to get_article, get_article_content, or get_article_summary. Use `limit` and the `nextCursor` from a previous result to page through a long readlist.","inputSchema":{"type":"object","properties":{"status":{"type":"string","enum":["unread","read"],"description":"Filter to only unread or only read items. Omit to list everything."},"sort":{"type":"string","enum":["saved","read"],"description":"Sort by date saved (default) or date read. \\"read\\" requires status \\"read\\"."},"order":{"type":"string","enum":["asc","desc"],"description":"Sort direction. Defaults to newest first (desc)."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"Maximum items to return per page (default 20)."},"cursor":{"type":"string","description":"An opaque nextCursor from a previous list_queue result, to fetch the following page."}},"additionalProperties":false},"annotations":{"readOnlyHint":true,"destructiveHint":false,"openWorldHint":false}}',
		);
	});

	it("is served under the legacy listing name the server dispatches", () => {
		expect(LIST_QUEUE_PUBLISHED_TOOL.name).toBe(LIST_READLIST_ARTICLES_LEGACY_NAME);
	});
});
