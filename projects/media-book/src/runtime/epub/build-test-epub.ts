import { strToU8, zipSync } from "fflate";

export type TestChapter = { file: string; title: string; body: string };

export function chapterXhtml(body: string): string {
	return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body>${body}</body></html>`;
}

export function buildTestEpub(params: {
	title?: string;
	authors?: string[];
	chapters: TestChapter[];
	toc?: "nav" | "ncx";
	extraFiles?: Record<string, string>;
}): Uint8Array {
	const toc = params.toc ?? "nav";
	const manifest = params.chapters.map((chapter, index) => `<item id="c${index}" href="${chapter.file}" media-type="application/xhtml+xml"/>`).join("");
	const spine = params.chapters.map((_, index) => `<itemref idref="c${index}"/>`).join("");
	const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${params.chapters
		.map((chapter) => `<li><a href="${chapter.file}">${chapter.title}</a></li>`)
		.join("")}</ol></nav></body></html>`;
	const ncx = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${params.chapters
		.map((chapter, index) => `<navPoint id="n${index}"><navLabel><text>${chapter.title}</text></navLabel><content src="${chapter.file}"/></navPoint>`)
		.join("")}</navMap></ncx>`;
	const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${
		params.title === undefined ? "" : `<dc:title>${params.title}</dc:title>`
	}${(params.authors ?? []).map((author) => `<dc:creator>${author}</dc:creator>`).join("")}</metadata><manifest>${manifest}${
		toc === "nav" ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` : `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
	}</manifest><spine${toc === "ncx" ? ` toc="ncx"` : ""}>${spine}</spine></package>`;
	const files: Record<string, string> = {
		mimetype: "application/epub+zip",
		"META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OEBPS/content.opf": opf,
		[toc === "nav" ? "OEBPS/nav.xhtml" : "OEBPS/toc.ncx"]: toc === "nav" ? nav : ncx,
		...Object.fromEntries(params.chapters.map((chapter) => [`OEBPS/${chapter.file}`, chapterXhtml(chapter.body)])),
		...params.extraFiles,
	};
	return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
}
