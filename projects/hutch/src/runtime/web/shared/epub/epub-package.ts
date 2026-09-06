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

function contentOpf(params: {
	title: string;
	language: string;
	identifier: string;
	modifiedAt: string;
	manifestItems: string;
}): string {
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
<item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
${params.manifestItems}
</manifest>
<spine toc="ncx">
<itemref idref="content"/>
</spine>
</package>`;
}

function navXhtml(title: string): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeXmlText(title)}</title>
</head>
<body>
<nav epub:type="toc" id="toc">
<ol>
<li><a href="content.xhtml">${escapeXmlText(title)}</a></li>
</ol>
</nav>
</body>
</html>`;
}

function tocNcx(params: { title: string; identifier: string }): string {
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
<navPoint id="navpoint-1" playOrder="1">
<navLabel><text>${escapeXmlText(params.title)}</text></navLabel>
<content src="content.xhtml" />
</navPoint>
</navMap>
</ncx>`;
}

export function buildEpub(params: {
	title: string;
	language: string;
	identifier: string;
	modifiedAt: string;
	xhtml: string;
	images: readonly { filename: string; body: Uint8Array }[];
}): Uint8Array {
	const manifestItems = params.images
		.map(
			(image, index) =>
				`<item id="img${index + 1}" href="images/${image.filename}" media-type="${imageMediaType(image.filename)}"/>`,
		)
		.join("\n");

	const zippable: Zippable = {
		mimetype: [strToU8("application/epub+zip"), { level: 0 }],
		"META-INF/container.xml": strToU8(CONTAINER_XML),
		"OEBPS/content.opf": strToU8(
			contentOpf({
				title: params.title,
				language: params.language,
				identifier: params.identifier,
				modifiedAt: params.modifiedAt,
				manifestItems,
			}),
		),
		"OEBPS/nav.xhtml": strToU8(navXhtml(params.title)),
		"OEBPS/toc.ncx": strToU8(tocNcx({ title: params.title, identifier: params.identifier })),
		"OEBPS/content.xhtml": strToU8(params.xhtml),
	};
	for (const image of params.images) {
		zippable[`OEBPS/images/${image.filename}`] = [image.body, { level: 0 }];
	}

	return zipSync(zippable);
}
