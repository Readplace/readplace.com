import { strFromU8, unzipSync } from "fflate";
import { buildEpub } from "./epub-package";

const BASE = {
	title: "The Article",
	language: "en",
	identifier: "https://example.com/article",
	modifiedAt: "2026-09-02T00:00:00Z",
	xhtml: "<html><body><p>hi</p></body></html>",
};

describe("buildEpub", () => {
	it("writes mimetype as the first entry, stored uncompressed", () => {
		const bytes = buildEpub({ ...BASE, images: [] });

		expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(bytes[8]).toBe(0);
		expect(bytes[9]).toBe(0);
		expect(bytes[26]).toBe("mimetype".length);
		expect(strFromU8(bytes.slice(30, 30 + "mimetype".length))).toBe("mimetype");
	});

	it("round-trips the OCF layout through unzip", () => {
		const image = { filename: "abcdef0123456789.jpg", body: new Uint8Array([9, 8, 7]) };
		const bytes = buildEpub({ ...BASE, images: [image] });

		const files = unzipSync(bytes);

		expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
		expect(strFromU8(files["META-INF/container.xml"])).toContain(
			'full-path="OEBPS/content.opf"',
		);
		expect(files["OEBPS/nav.xhtml"]).toBeDefined();
		expect(files["OEBPS/toc.ncx"]).toBeDefined();
		expect(strFromU8(files["OEBPS/content.xhtml"])).toContain("<p>hi</p>");
		expect(files[`OEBPS/images/${image.filename}`]).toEqual(image.body);
	});

	it("writes the OPF metadata, image manifest item, and ncx-referencing spine", () => {
		const bytes = buildEpub({
			...BASE,
			images: [{ filename: "abcdef0123456789.png", body: new Uint8Array([1]) }],
		});
		const opf = strFromU8(unzipSync(bytes)["OEBPS/content.opf"]);

		expect(opf).toContain("<dc:title>The Article</dc:title>");
		expect(opf).toContain("<dc:identifier id=\"pub-id\">https://example.com/article</dc:identifier>");
		expect(opf).toContain("<dc:language>en</dc:language>");
		expect(opf).toContain('<meta property="dcterms:modified">2026-09-02T00:00:00Z</meta>');
		expect(opf).toContain(
			'<item id="img1" href="images/abcdef0123456789.png" media-type="image/png"/>',
		);
		expect(opf).toContain('<spine toc="ncx">');
		expect(opf).toContain('<itemref idref="content"/>');
	});

	it("rejects an image whose extension has no known media type", () => {
		expect(() =>
			buildEpub({ ...BASE, images: [{ filename: "photo.bmp", body: new Uint8Array([1]) }] }),
		).toThrow(/unsupported epub image extension/);
	});

	it("rejects an image filename that has no extension", () => {
		expect(() =>
			buildEpub({ ...BASE, images: [{ filename: "noextension", body: new Uint8Array([1]) }] }),
		).toThrow(/unsupported epub image extension/);
	});
});
