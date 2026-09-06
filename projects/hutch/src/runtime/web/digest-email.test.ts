import { JSDOM } from "jsdom";
import { buildDigestEmailHtml, type DigestEmailItem } from "./digest-email";

const QUEUE_URL = "https://readplace.com/queue";
const READER_URL = "https://readplace.com/queue/abc123/view?from=reader-ready-email";

const item = (overrides: Partial<DigestEmailItem> = {}): DigestEmailItem => ({
	title: "Distributed systems",
	siteName: "example.com",
	readerUrl: READER_URL,
	preview: "A tidy teaser.",
	...overrides,
});

const build = (items: DigestEmailItem[]) => buildDigestEmailHtml({ items, queueUrl: QUEUE_URL });

const anchorsOf = (html: string) => [...new JSDOM(html).window.document.querySelectorAll("a[href]")];
const ctasOf = (html: string) =>
	anchorsOf(html).filter((a) => a.textContent?.trim() === "Continue reading");

describe("buildDigestEmailHtml", () => {
	it("links a card's title, site name and preview to that article's private reader view", () => {
		const html = build([item({ readerUrl: READER_URL })]);

		const nonCta = anchorsOf(html).filter((a) => a.textContent?.trim() !== "Continue reading");
		expect(nonCta.map((a) => a.textContent?.trim())).toEqual([
			"Distributed systems",
			"example.com",
			"A tidy teaser.",
		]);
		expect(nonCta.every((a) => a.getAttribute("href") === READER_URL)).toBe(true);
	});

	it("gives each card its own reader permalink", () => {
		const html = build([
			item({ title: "One", readerUrl: "https://readplace.com/queue/a/view?from=reader-ready-email" }),
			item({ title: "Two", readerUrl: "https://readplace.com/queue/b/view?from=reader-ready-email" }),
		]);

		const titleLinks = anchorsOf(html).filter((a) => ["One", "Two"].includes(a.textContent?.trim() ?? ""));
		expect(titleLinks.map((a) => a.getAttribute("href"))).toEqual([
			"https://readplace.com/queue/a/view?from=reader-ready-email",
			"https://readplace.com/queue/b/view?from=reader-ready-email",
		]);
	});

	/* Mail clients turn a bare domain in plain text into a link to that domain.
	 * Every such string must therefore already sit inside an anchor we control. */
	it("never offers a link to the article's original site, even when the site name and preview name domains", () => {
		const html = build([
			item({ siteName: "engineering.linkedin.com", preview: "Also covered on dataintensive.net today." }),
		]);

		const doc = new JSDOM(html).window.document;
		for (const a of doc.querySelectorAll("a[href]")) {
			expect(new URL(a.getAttribute("href") ?? "").origin).toBe("https://readplace.com");
		}
		for (const domainText of ["engineering.linkedin.com", "Also covered on dataintensive.net today."]) {
			const holder = [...doc.querySelectorAll("a")].find((a) => a.textContent?.trim() === domainText);
			expect(holder?.getAttribute("href")).toBe(READER_URL);
		}
	});

	it("renders exactly one continue-reading CTA pointing at the unread queue", () => {
		const ctas = ctasOf(build([item(), item({ title: "Second" })]));
		expect(ctas).toHaveLength(1);

		const cta = new URL(ctas[0].getAttribute("href") ?? "");
		expect(`${cta.origin}${cta.pathname}`).toBe(QUEUE_URL);
		expect(cta.searchParams.get("utm_source")).toBe("reader-ready-email");
		expect(cta.searchParams.get("utm_medium")).toBe("email");
		expect(cta.searchParams.get("utm_content")).toBe("bottom");
	});

	it("places the only CTA after the last card, never before the first", () => {
		const anchors = anchorsOf(build([item({ title: "Only card" })]));

		expect(anchors[0].textContent).toBe("Only card");
		expect(anchors[anchors.length - 1].textContent?.trim()).toBe("Continue reading");
	});

	it("renders the preview teaser for an item", () => {
		expect(build([item({ preview: "Alpha body teaser." })])).toContain("Alpha body teaser.");
	});

	it("renders a card with no body when an item has no preview", () => {
		const html = build([item({ title: "No content", preview: "" })]);

		// One queue CTA plus the title and site-name links — no preview link.
		expect(anchorsOf(html)).toHaveLength(3);
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
