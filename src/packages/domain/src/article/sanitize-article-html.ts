import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"del",
	"ins",
	"mark",
	"small",
	"sub",
	"sup",
	"abbr",
	"cite",
	"q",
	"time",
	"dfn",
	"kbd",
	"samp",
	"var",
	"a",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"blockquote",
	"pre",
	"code",
	"ul",
	"ol",
	"li",
	"dl",
	"dt",
	"dd",
	"table",
	"caption",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"figure",
	"figcaption",
	"img",
	"hr",
	"div",
	"span",
];

const PARAGRAPH_CLASSES = [
	"reader-video-placeholder",
	"reader-embed-facade",
	"ocr-tesseract",
	"ocr-failed",
];

const RULE_CLASSES = ["ocr-page-break"];

export const ARTICLE_SECTION_ID_PREFIX = "section-";

export const READER_CELL_LABEL_ATTRIBUTE = "data-label";
export const READER_HEADER_ROW_ATTRIBUTE = "data-reader-header";
export const READER_TABLE_FITS_ATTRIBUTE = "data-reader-fits";
export const READER_TABLE_FLOW_ATTRIBUTE = "data-reader-flow";

const keepOnlySectionId: sanitizeHtml.Transformer = (tagName, attribs) => {
	const { id = "", ...rest } = attribs;
	return {
		tagName,
		attribs: id.startsWith(ARTICLE_SECTION_ID_PREFIX) ? { ...rest, id } : rest,
	};
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: ALLOWED_TAGS,
	allowedAttributes: {
		a: ["href", "target", "rel", "title"],
		img: ["src", "srcset", "sizes", "alt", "width", "height", "loading"],
		td: ["colspan", "rowspan", READER_CELL_LABEL_ATTRIBUTE],
		th: ["colspan", "rowspan", READER_CELL_LABEL_ATTRIBUTE],
		tr: [READER_HEADER_ROW_ATTRIBUTE],
		table: [READER_TABLE_FITS_ATTRIBUTE, READER_TABLE_FLOW_ATTRIBUTE],
		h2: ["id"],
		h3: ["id"],
		p: ["class"],
		hr: ["class"],
	},
	allowedClasses: {
		p: PARAGRAPH_CLASSES,
		hr: RULE_CLASSES,
	},
	allowedSchemes: ["http", "https", "mailto"],
	allowedSchemesByTag: { img: ["http", "https", "data"] },
	disallowedTagsMode: "discard",
	nonTextTags: ["style", "script", "iframe", "noscript", "xmp", "svg", "math"],
	transformTags: {
		a: (tagName, attribs) =>
			"href" in attribs
				? { tagName, attribs }
				: { tagName: "span", attribs: {} },
		h2: keepOnlySectionId,
		h3: keepOnlySectionId,
	},
};

export function sanitizeArticleHtml(html: string): string {
	return sanitizeHtml(sanitizeHtml(html, SANITIZE_OPTIONS), SANITIZE_OPTIONS);
}
