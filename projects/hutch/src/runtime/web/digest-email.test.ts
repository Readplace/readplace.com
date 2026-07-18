import { JSDOM } from "jsdom";
import { buildDigestEmailHtml, type DigestEmailItem } from "./digest-email";

const QUEUE_URL = "https://readplace.com/queue";

const item = (overrides: Partial<DigestEmailItem> = {}): DigestEmailItem => ({
	title: "Distributed systems",
	siteName: "example.com",
	readerUrl: "https://readplace.com/queue/abc123/view?from=reader-ready-email",
	preview: "A tidy teaser.",
	...overrides,
});

const build = (items: DigestEmailItem[]) => buildDigestEmailHtml({ items, queueUrl: QUEUE_URL });

describe("buildDigestEmailHtml", () => {
	it("links each title to its own private reader permalink", () => {
		const html = build([
			item({ title: "One", readerUrl: "https://readplace.com/queue/a/view?from=reader-ready-email" }),
			item({ title: "Two", readerUrl: "https://readplace.com/queue/b/view?from=reader-ready-email" }),
		]);

		const doc = new JSDOM(html).window.document;
		const titleLinks = [...doc.querySelectorAll("a[href*='/view']")];
		expect(titleLinks.map((a) => a.getAttribute("href"))).toEqual([
			"https://readplace.com/queue/a/view?from=reader-ready-email",
			"https://readplace.com/queue/b/view?from=reader-ready-email",
		]);
		expect(titleLinks.map((a) => a.textContent)).toEqual(["One", "Two"]);
	});

	it("renders exactly two continue-reading CTAs pointing at the unread queue, tagged top and bottom", () => {
		const html = build([item(), item({ title: "Second" })]);

		const doc = new JSDOM(html).window.document;
		const ctas = [...doc.querySelectorAll("a")].filter((a) => a.textContent?.trim() === "Continue reading");
		expect(ctas).toHaveLength(2);

		const [top, bottom] = ctas.map((a) => new URL(a.getAttribute("href") ?? ""));
		for (const url of [top, bottom]) {
			expect(`${url.origin}${url.pathname}`).toBe(QUEUE_URL);
			expect(url.searchParams.get("utm_source")).toBe("reader-ready-email");
			expect(url.searchParams.get("utm_medium")).toBe("email");
		}
		expect(top.searchParams.get("utm_content")).toBe("top");
		expect(bottom.searchParams.get("utm_content")).toBe("bottom");
	});

	it("places the top CTA before the first article and the bottom CTA after the last", () => {
		const html = build([item({ title: "Only card" })]);

		const anchors = [...new JSDOM(html).window.document.querySelectorAll("a")];
		expect(anchors).toHaveLength(3);
		expect(anchors[0].textContent?.trim()).toBe("Continue reading");
		expect(anchors[1].textContent).toBe("Only card");
		expect(anchors[2].textContent?.trim()).toBe("Continue reading");
	});

	it("renders the preview teaser for an item", () => {
		const html = build([item({ preview: "Alpha body teaser." })]);

		expect(html).toContain("Alpha body teaser.");
	});

	it("renders a card with no body when an item has no preview", () => {
		const html = build([item({ title: "No content", preview: "" })]);

		const doc = new JSDOM(html).window.document;
		// Two queue CTAs plus the linked title — and no preview paragraph.
		expect(doc.querySelectorAll("a[href]")).toHaveLength(3);
		expect(html).toContain("No content");
	});

	it("HTML-escapes the title and preview so crafted content cannot inject markup", () => {
		const html = build([
			item({ title: "<script>alert(1)</script>", preview: "<img src=x onerror=alert(2)>" }),
		]);

		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).not.toContain("<img src=x onerror=alert(2)>");
		expect(html).toContain("&lt;script&gt;");
	});
});
