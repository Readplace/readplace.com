import { DOMParser } from "linkedom";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { articleEpubXhtml, collectArticleImages, embeddableImageFilename } from "./epub-xhtml";

const ARTICLE_URL = "https://example.com/article";
const ID = ArticleResourceUniqueId.parse(ARTICLE_URL);
const IMAGE_PREFIX = ID.toS3ImagePrefix();

function embeddedSrc(filename: string): string {
	return ID.toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename });
}

describe("embeddableImageFilename", () => {
	it("returns the filename for an image hosted under this article's prefix", () => {
		expect(
			embeddableImageFilename({ src: embeddedSrc("abcdef0123456789.jpg"), imagePrefix: IMAGE_PREFIX }),
		).toBe("abcdef0123456789.jpg");
	});

	it("returns undefined for an image on a foreign path", () => {
		expect(
			embeddableImageFilename({ src: "https://origin.example/photo.jpg", imagePrefix: IMAGE_PREFIX }),
		).toBeUndefined();
	});

	it("returns undefined for another article's prefix", () => {
		const otherSrc = ArticleResourceUniqueId.parse("https://example.com/other").toImageCdnUrl({
			baseUrl: "https://cdn.readplace.test",
			filename: "abcdef0123456789.jpg",
		});
		expect(embeddableImageFilename({ src: otherSrc, imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it("returns undefined for a non-absolute URL", () => {
		expect(embeddableImageFilename({ src: "images/local.jpg", imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it("returns undefined when the filename would traverse out of the images folder", () => {
		const traversal = ID.toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename: "sub/evil.jpg" });
		expect(embeddableImageFilename({ src: traversal, imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it("returns undefined for a malformed percent-encoding", () => {
		expect(
			embeddableImageFilename({ src: "https://cdn.readplace.test/%E0%A4%A", imagePrefix: IMAGE_PREFIX }),
		).toBeUndefined();
	});
});

describe("collectArticleImages", () => {
	it("collects hosted images in document order and dedups repeats", () => {
		const contentHtml = `
			<p><img src="${embeddedSrc("1111111111111111.jpg")}"></p>
			<p><img src="https://origin.example/foreign.png"></p>
			<p><img src="${embeddedSrc("2222222222222222.png")}"></p>
			<p><img src="${embeddedSrc("1111111111111111.jpg")}"></p>
		`;

		const images = collectArticleImages({ contentHtml, articleUrl: ARTICLE_URL });

		expect(images.map((image) => image.filename)).toEqual([
			"1111111111111111.jpg",
			"2222222222222222.png",
		]);
	});

	it("ignores images without a src", () => {
		const images = collectArticleImages({ contentHtml: "<p><img alt=x></p>", articleUrl: ARTICLE_URL });
		expect(images).toEqual([]);
	});
});

describe("articleEpubXhtml", () => {
	function parseXml(xhtml: string): Document {
		return new DOMParser().parseFromString(xhtml, "text/xml") as unknown as Document;
	}

	it("self-closes void elements and renders the title", () => {
		const xhtml = articleEpubXhtml({
			contentHtml: "<p>one<br>two</p><hr>",
			title: "My Title",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [],
		});

		expect(xhtml).toContain("<br />");
		expect(xhtml).toContain("<hr />");
		expect(xhtml).toContain("<title>My Title</title>");
		expect(parseXml(xhtml).documentElement.localName).toBe("html");
	});

	it("normalizes a bare boolean attribute to an empty value", () => {
		const xhtml = articleEpubXhtml({
			contentHtml: "<p><span data-flag>x</span></p>",
			title: "t",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [],
		});
		expect(xhtml).toContain('data-flag=""');
	});

	it("removes script, style and iframe elements", () => {
		const xhtml = articleEpubXhtml({
			contentHtml: "<script>bad()</script><style>b{}</style><iframe src=x></iframe><p>ok</p>",
			title: "t",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [],
		});
		expect(xhtml).not.toContain("bad()");
		expect(xhtml).not.toContain("<style");
		expect(xhtml).not.toContain("<iframe");
		expect(xhtml).toContain("<p>ok</p>");
	});

	it("removes comments", () => {
		const xhtml = articleEpubXhtml({
			contentHtml: "<p>a<!-- secret -->b</p>",
			title: "t",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [],
		});
		expect(xhtml).not.toContain("secret");
		expect(xhtml).toContain("<p>ab</p>");
	});

	it("collapses a picture to its embedded img and strips lazy attributes", () => {
		const filename = "3333333333333333.jpg";
		const contentHtml = `<picture><source srcset="x.jpg"><img src="${embeddedSrc(filename)}" srcset="y.jpg" sizes="1px" loading="lazy" decoding="async" alt="A"></picture>`;

		const xhtml = articleEpubXhtml({
			contentHtml,
			title: "t",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [filename],
		});

		expect(xhtml).not.toContain("<picture");
		expect(xhtml).not.toContain("<source");
		expect(xhtml).toContain(`<img src="images/${filename}" alt="A" />`);
		expect(xhtml).not.toContain("srcset");
		expect(xhtml).not.toContain("loading");
		expect(xhtml).not.toContain("decoding");
	});

	it("removes a picture that carries no img", () => {
		const xhtml = articleEpubXhtml({
			contentHtml: "<picture><source srcset='x.jpg'></picture><p>after</p>",
			title: "t",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [],
		});
		expect(xhtml).not.toContain("<picture");
		expect(xhtml).not.toContain("<source");
		expect(xhtml).toContain("<p>after</p>");
	});

	it("drops an img that has no src", () => {
		const xhtml = articleEpubXhtml({
			contentHtml: "<p><img alt='x'></p>",
			title: "t",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [],
		});
		expect(xhtml).not.toContain("<img");
	});

	it("drops an image that was not embedded (foreign or over budget)", () => {
		const kept = "4444444444444444.jpg";
		const contentHtml = `<p><img src="${embeddedSrc(kept)}"></p><p><img src="https://origin.example/f.png"></p><p><img src="${embeddedSrc("5555555555555555.jpg")}"></p>`;

		const xhtml = articleEpubXhtml({
			contentHtml,
			title: "t",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [kept],
		});

		expect(xhtml).toContain(`images/${kept}`);
		expect(xhtml).not.toContain("origin.example");
		expect(xhtml).not.toContain("5555555555555555.jpg");
	});

	it("escapes XML text and attribute values", () => {
		const xhtml = articleEpubXhtml({
			contentHtml: '<p>a & b < c</p><a href="/x?a=1&b=2" title=\'he said "hi"\'>link</a>',
			title: "Tom & Jerry <3",
			articleUrl: ARTICLE_URL,
			embeddedFilenames: [],
		});

		expect(xhtml).toContain("a &amp; b &lt; c");
		expect(xhtml).toContain("href=\"/x?a=1&amp;b=2\"");
		expect(xhtml).toContain("&quot;hi&quot;");
		expect(xhtml).toContain("<title>Tom &amp; Jerry &lt;3</title>");
	});
});
