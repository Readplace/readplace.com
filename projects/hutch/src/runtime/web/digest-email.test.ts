import { JSDOM } from "jsdom";
import { buildDigestEmailHtml, type DigestEmailItem } from "./digest-email";

const item = (overrides: Partial<DigestEmailItem> = {}): DigestEmailItem => ({
	title: "Distributed systems",
	siteName: "example.com",
	continueReadingUrl: "https://readplace.com/queue/abc123/view?from=reader-ready-email",
	preview: ["First paragraph.", "Second paragraph."],
	...overrides,
});

describe("buildDigestEmailHtml", () => {
	it("renders one card per item, each linking its own continue-reading permalink", () => {
		const html = buildDigestEmailHtml({
			items: [
				item({ title: "One", continueReadingUrl: "https://readplace.com/queue/a/view" }),
				item({ title: "Two", continueReadingUrl: "https://readplace.com/queue/b/view" }),
			],
		});

		const doc = new JSDOM(html).window.document;
		const links = [...doc.querySelectorAll("a[href]")];
		expect(links.map((a) => a.getAttribute("href"))).toEqual([
			"https://readplace.com/queue/a/view",
			"https://readplace.com/queue/b/view",
		]);
		expect(links.every((a) => a.textContent?.trim() === "Continue reading")).toBe(true);
		expect(html).toContain("One");
		expect(html).toContain("Two");
	});

	it("renders each preview paragraph for an item", () => {
		const html = buildDigestEmailHtml({ items: [item({ preview: ["Alpha body.", "Beta body."] })] });

		expect(html).toContain("Alpha body.");
		expect(html).toContain("Beta body.");
	});

	it("renders a card with no body when an item has no preview", () => {
		const html = buildDigestEmailHtml({ items: [item({ title: "No content", preview: [] })] });

		const doc = new JSDOM(html).window.document;
		expect(doc.querySelectorAll("a[href]")).toHaveLength(1);
		expect(html).toContain("No content");
	});

	it("HTML-escapes the title and preview so crafted content cannot inject markup", () => {
		const html = buildDigestEmailHtml({
			items: [item({ title: "<script>alert(1)</script>", preview: ["<img src=x onerror=alert(2)>"] })],
		});

		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).not.toContain("<img src=x onerror=alert(2)>");
		expect(html).toContain("&lt;script&gt;");
	});
});
