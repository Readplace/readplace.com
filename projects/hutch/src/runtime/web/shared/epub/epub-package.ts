import assert from "node:assert";
import { strToU8, zipSync, type Zippable } from "fflate";
import { escapeXmlAttribute, escapeXmlText } from "./epub-xhtml";

const IMAGE_MEDIA_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
};

function imageMediaType(filename: string): string {
	const dot = filename.lastIndexOf(".");
	const extension = dot === -1 ? "" : filename.slice(dot).toLowerCase();
	const mediaType = IMAGE_MEDIA_TYPES[extension];
	assert(mediaType, `unsupported epub image extension: ${filename}`);
	return mediaType;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`;

export interface EpubChapter {
	id: string;
	href: string;
	title: string;
	xhtml: string;
}

export interface EpubImage {
	href: string;
	body: Uint8Array;
}

function contentOpf(params: {
	title: string;
	language: string;
	identifier: string;
	modifiedAt: string;
	chapters: readonly EpubChapter[];
	images: readonly EpubImage[];
}): string {
	const chapterItems = params.chapters.map(
		(chapter) =>
			`<item id="${escapeXmlAttribute(chapter.id)}" href="${escapeXmlAttribute(chapter.href)}" media-type="application/xhtml+xml"/>`,
	);
	const imageItems = params.images.map(
		(image, index) =>
			`<item id="img${index + 1}" href="${image.href}" media-type="${imageMediaType(image.href)}"/>`,
	);
	const spine = params.chapters.map((chapter) => `<itemref idref="${escapeXmlAttribute(chapter.id)}"/>`);
	return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">${escapeXmlText(params.identifier)}</dc:identifier>
<dc:title>${escapeXmlText(params.title)}</dc:title>
<dc:language>${escapeXmlText(params.language)}</dc:language>
<meta property="dcterms:modified">${escapeXmlText(params.modifiedAt)}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${[...chapterItems, ...imageItems].join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
</package>`;
}

function navXhtml(params: { title: string; chapters: readonly EpubChapter[] }): string {
	const entries = params.chapters.map(
		(chapter) => `<li><a href="${escapeXmlAttribute(chapter.href)}">${escapeXmlText(chapter.title)}</a></li>`,
	);
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeXmlText(params.title)}</title>
</head>
<body>
<nav epub:type="toc" id="toc">
<ol>
${entries.join("\n")}
</ol>
</nav>
</body>
</html>`;
}

function tocNcx(params: { title: string; identifier: string; chapters: readonly EpubChapter[] }): string {
	const navPoints = params.chapters.map(
		(chapter, index) => `<navPoint id="navpoint-${index + 1}" playOrder="${index + 1}">
<navLabel><text>${escapeXmlText(chapter.title)}</text></navLabel>
<content src="${escapeXmlAttribute(chapter.href)}" />
</navPoint>`,
	);
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="${escapeXmlAttribute(params.identifier)}" />
<meta name="dtb:depth" content="1" />
<meta name="dtb:totalPageCount" content="0" />
<meta name="dtb:maxPageNumber" content="0" />
</head>
<docTitle><text>${escapeXmlText(params.title)}</text></docTitle>
<navMap>
${navPoints.join("\n")}
</navMap>
</ncx>`;
}

export function packageEpub(params: {
	title: string;
	language: string;
	identifier: string;
	modifiedAt: string;
	chapters: readonly EpubChapter[];
	images: readonly EpubImage[];
}): Uint8Array {
	const zippable: Zippable = {
		mimetype: [strToU8("application/epub+zip"), { level: 0 }],
		"META-INF/container.xml": strToU8(CONTAINER_XML),
		"OEBPS/content.opf": strToU8(contentOpf(params)),
		"OEBPS/nav.xhtml": strToU8(navXhtml(params)),
		"OEBPS/toc.ncx": strToU8(tocNcx(params)),
	};
	for (const chapter of params.chapters) zippable[`OEBPS/${chapter.href}`] = strToU8(chapter.xhtml);
	for (const image of params.images) zippable[`OEBPS/${image.href}`] = [image.body, { level: 0 }];

	return zipSync(zippable, { mtime: params.modifiedAt });
}

export function buildEpub(params: {
	title: string;
	language: string;
	identifier: string;
	modifiedAt: string;
	xhtml: string;
	images: readonly { filename: string; body: Uint8Array }[];
}): Uint8Array {
	return packageEpub({
		title: params.title,
		language: params.language,
		identifier: params.identifier,
		modifiedAt: params.modifiedAt,
		chapters: [{ id: "content", href: "content.xhtml", title: params.title, xhtml: params.xhtml }],
		images: params.images.map((image) => ({ href: `images/${image.filename}`, body: image.body })),
	});
}
