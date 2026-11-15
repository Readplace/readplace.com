import { sanitizeArticleHtml } from "@packages/domain/article";
import type { DownloadedMedia } from "@packages/finalize-article";
import { recordMeasuredImageSizes } from "./record-measured-image-sizes";

function measured(name: string, size: { width: number; height: number }): DownloadedMedia {
	return { originalUrl: `https://example.com/${name}`, cdnUrl: `https://cdn.example.com/${name}`, dimensions: size };
}

const cdn = (name: string) => `https://cdn.example.com/${name}`;

const small = measured("a.png", { width: 728, height: 503 });
const large = measured("b.png", { width: 1456, height: 1005 });

function recordedSize(params: { img: string; media: DownloadedMedia[] }): string | null {
	const html = recordMeasuredImageSizes({ html: params.img, media: params.media });
	return /data-reader-image-size="([^"]*)"/.exec(html)?.[1] ?? null;
}

describe("recordMeasuredImageSizes", () => {
	describe("an image with no srcset", () => {
		it("records the measured size of a source served from the CDN, leaving the publisher's width and height as they were", () => {
			expect(
				recordMeasuredImageSizes({ html: `<img src="${cdn("b.png")}" width="0" height="0">`, media: [large] }),
			).toBe(`<img data-reader-image-size="1456x1005" src="${cdn("b.png")}" width="0" height="0">`);
		});

		it("records nothing for a source left at its origin", () => {
			const html = '<img src="https://example.com/b.png" width="728" height="502">';

			expect(recordMeasuredImageSizes({ html, media: [large] })).toBe(html);
		});

		it("records nothing for an image with neither a source nor a srcset", () => {
			const html = '<img alt="x">';

			expect(recordMeasuredImageSizes({ html, media: [large] })).toBe(html);
		});

		it("records nothing for a source whose media could not be measured", () => {
			const html = `<img src="${cdn("b.png")}">`;

			expect(
				recordMeasuredImageSizes({ html, media: [{ originalUrl: "https://example.com/b.png", cdnUrl: cdn("b.png") }] }),
			).toBe(html);
		});
	});

	describe("a srcset of width descriptors", () => {
		it("records the largest candidate's size for the full viewport when sizes is absent", () => {
			expect(
				recordedSize({ img: `<img srcset="${cdn("a.png")} 728w, ${cdn("b.png")} 1456w">`, media: [small, large] }),
			).toBe("1456x1005 100vw");
		});

		it.each([
			["100vw", "1456x1005 100vw"],
			[" 600px ", "1456x1005 600px"],
			["(max-width: 1024px) 100vw, 1024px", "1456x1005 min(100vw,1024px)"],
		])("records sizes=%j as %s", (sizes, expected) => {
			expect(
				recordedSize({
					img: `<img srcset="${cdn("b.png")} 1456w, ${cdn("a.png")} 728w" sizes="${sizes}">`,
					media: [small, large],
				}),
			).toBe(expected);
		});

		it("ignores the source, as the browser does, when it is a tiny placeholder", () => {
			expect(
				recordedSize({
					img: `<img src="${cdn("dot.gif")}" srcset="${cdn("b.png")} 1456w">`,
					media: [measured("dot.gif", { width: 1, height: 1 }), large],
				}),
			).toBe("1456x1005 100vw");
		});

		it.each([
			["a candidate left at its origin", `<img srcset="https://example.com/a.png 728w, ${cdn("b.png")} 1456w">`],
			[
				"a candidate rewritten to another rendition",
				`<img srcset="${cdn("b.png")} 728w, ${cdn("b.png")} 1456w">`,
			],
			["an empty sizes", `<img srcset="${cdn("b.png")} 1456w" sizes="">`],
			["sizes=auto", `<img srcset="${cdn("b.png")} 1456w" sizes="auto">`],
			["a capped sizes whose lengths differ", `<img srcset="${cdn("b.png")} 1456w" sizes="(max-width: 600px) 100vw, 1024px">`],
			["a min-width sizes", `<img srcset="${cdn("b.png")} 1456w" sizes="(min-width: 720px) 720px">`],
		])("records nothing for %s", (_case, img) => {
			expect(recordedSize({ img, media: [small, large] })).toBeNull();
		});

		it("records nothing when a candidate's ratio is off by more than half a pixel", () => {
			expect(
				recordedSize({
					img: `<img srcset="${cdn("a.png")} 300w, ${cdn("b.png")} 1456w">`,
					media: [measured("a.png", { width: 300, height: 208 }), large],
				}),
			).toBeNull();
		});
	});

	describe("a srcset of density descriptors", () => {
		const oneX = measured("a.png", { width: 800, height: 601 });
		const twoX = measured("b.png", { width: 1600, height: 1201 });

		it("records the CSS size every candidate resolves to", () => {
			expect(
				recordedSize({ img: `<img src="${cdn("a.png")}" srcset="${cdn("a.png")} 1x, ${cdn("b.png")} 2x">`, media: [oneX, twoX] }),
			).toBe("800x601");
		});

		it("counts the source as the 1x candidate when the srcset has none", () => {
			expect(recordedSize({ img: `<img src="${cdn("a.png")}" srcset="${cdn("b.png")} 2x">`, media: [oneX, twoX] })).toBe(
				"800x601",
			);
		});

		it("takes a candidate with no descriptor as 1x", () => {
			expect(recordedSize({ img: `<img srcset="${cdn("a.png")}, ${cdn("b.png")} 2x">`, media: [oneX, twoX] })).toBe(
				"800x601",
			);
		});

		it("records a lone 2x candidate at half its size when there is no source", () => {
			expect(recordedSize({ img: `<img srcset="${cdn("b.png")} 2x">`, media: [twoX] })).toBe("800x601");
		});

		it.each([
			["a width that does not halve to the same size", [oneX, measured("b.png", { width: 1601, height: 1200 })]],
			["a height off by more than half a pixel", [oneX, measured("b.png", { width: 1600, height: 1204 })]],
			["an unmeasured candidate", [oneX]],
		])("records nothing for %s", (_case, media) => {
			expect(
				recordedSize({ img: `<img srcset="${cdn("a.png")} 1x, ${cdn("b.png")} 2x">`, media }),
			).toBeNull();
		});
	});

	it.each([
		["a height descriptor", `<img srcset="${cdn("b.png")} 1005h">`],
		["width and density descriptors mixed", `<img srcset="${cdn("a.png")} 728w, ${cdn("b.png")} 2x">`],
	])("records nothing for %s", (_case, img) => {
		expect(recordedSize({ img, media: [small, large] })).toBeNull();
	});

	it("judges an image inside a picture by its own attributes only", () => {
		const html = `<picture><source srcset="${cdn("b.png")}"><img src="https://example.com/unmirrored.png"></picture>`;

		expect(recordMeasuredImageSizes({ html, media: [large] })).toBe(html);
	});

	it("removes a size the publisher supplied when the image is not measured", () => {
		expect(
			recordMeasuredImageSizes({
				html: '<img src="https://example.com/b.png" data-reader-image-size="9999x1">',
				media: [large],
			}),
		).toBe('<img src="https://example.com/b.png">');
	});

	it("removes a size the publisher supplied even with no media", () => {
		expect(
			recordMeasuredImageSizes({ html: '<img src="https://example.com/b.png" data-reader-image-size="9999x1">', media: [] }),
		).toBe('<img src="https://example.com/b.png">');
	});

	describe.each([
		["upper-case", "DATA-READER-IMAGE-SIZE"],
		["mixed-case", "Data-Reader-Image-Size"],
	])("a size the publisher supplied under an %s attribute name", (_case, attribute) => {
		const html = `<img src="https://example.com/a.png" ${attribute}="1x99999 100vw">`;

		it.each([
			["no media", []],
			["measured media", [large]],
		])("is removed from an unmeasured image with %s, leaving nothing for the sanitiser to keep", (_media, media) => {
			const recorded = recordMeasuredImageSizes({ html, media });

			expect(recorded).toBe('<img src="https://example.com/a.png">');
			expect(sanitizeArticleHtml(recorded)).not.toMatch(/data-reader-image-size|style=/i);
		});
	});

	it("replaces a size the publisher supplied with the measured one", () => {
		expect(
			recordedSize({ img: `<img src="${cdn("b.png")}" data-reader-image-size="9999x1">`, media: [large] }),
		).toBe("1456x1005");
	});

	it("returns the identical string when nothing is measured and nothing is stored", () => {
		const html = "<p>Text &amp; <br/>more <img src='https://example.com/b.png'></p>";

		expect(recordMeasuredImageSizes({ html, media: [{ originalUrl: "x", cdnUrl: "y" }] })).toBe(html);
	});

	it("returns the identical string when measured media matches no image", () => {
		const html = "<p>Text &amp; <br/>more</p>";

		expect(recordMeasuredImageSizes({ html, media: [large] })).toBe(html);
	});
});
