import { JSDOM } from "jsdom";
import { buildReaderReadyEmailHtml } from "./reader-ready-email";

describe("buildReaderReadyEmailHtml", () => {
	it("links the call-to-action at the supplied reader permalink and renders the article title and site", () => {
		const html = buildReaderReadyEmailHtml({
			readerUrl: "https://readplace.com/queue/abc123/view",
			title: "How distributed systems fail",
			siteName: "example.com",
		});

		const doc = new JSDOM(html).window.document;
		const cta = doc.querySelector("a");
		expect(cta?.getAttribute("href")).toBe("https://readplace.com/queue/abc123/view");
		expect(html).toContain("How distributed systems fail");
		expect(html).toContain("example.com");
	});

	it("HTML-escapes the article title so a crafted title cannot inject markup", () => {
		const html = buildReaderReadyEmailHtml({
			readerUrl: "https://readplace.com/queue/abc123/view",
			title: "<script>alert(1)</script>",
			siteName: "example.com",
		});

		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;");
	});
});
