import sanitizeHtml from "sanitize-html";
import { HighlightIdSchema } from "./highlight/highlight";
import { READER_IMAGE_SIZE_ATTRIBUTE, readerImageBox } from "./reader-image-size";

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

export const ARTICLE_HIGHLIGHT_ID_PREFIX = "highlight-";

const CHAPTER_SECTION_ID_PATTERN = new RegExp(`^${ARTICLE_SECTION_ID_PREFIX}ch-[1-9][0-9]*$`);

export function chapterSectionId(chapter: number): string {
	return `${ARTICLE_SECTION_ID_PREFIX}ch-${chapter}`;
}

export function isChapterSectionId(id: string): boolean {
	return CHAPTER_SECTION_ID_PATTERN.test(id);
}

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

const keepOnlyHighlightIds: sanitizeHtml.Transformer = (tagName, attribs) => {
	const { id = "", "data-highlight-id": highlightId = "", ...rest } = attribs;
	return {
		tagName,
		attribs: {
			...rest,
			...(id.startsWith(ARTICLE_HIGHLIGHT_ID_PREFIX) ? { id } : {}),
			...(HighlightIdSchema.safeParse(highlightId).success ? { "data-highlight-id": highlightId } : {}),
		},
	};
};

const keepOnlyMeasuredImageBox: sanitizeHtml.Transformer = (tagName, attribs) => {
	const { style: _publisherStyle, [READER_IMAGE_SIZE_ATTRIBUTE]: stored, ...rest } = attribs;
	const box = readerImageBox(stored);
	return {
		tagName,
		attribs: box ? { ...rest, [READER_IMAGE_SIZE_ATTRIBUTE]: box.attribute, style: box.style } : rest,
	};
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: ALLOWED_TAGS,
	allowedAttributes: {
		a: ["href", "target", "rel", "title"],
		img: ["src", "srcset", "sizes", "alt", "width", "height", "loading", READER_IMAGE_SIZE_ATTRIBUTE, "style"],
		td: ["colspan", "rowspan", READER_CELL_LABEL_ATTRIBUTE],
		th: ["colspan", "rowspan", READER_CELL_LABEL_ATTRIBUTE],
		tr: [READER_HEADER_ROW_ATTRIBUTE],
		table: [READER_TABLE_FITS_ATTRIBUTE, READER_TABLE_FLOW_ATTRIBUTE],
		h2: ["id"],
		h3: ["id"],
		p: ["class"],
		hr: ["class"],
		mark: ["class", "id", "data-highlight-id"],
	},
	allowedClasses: {
		p: PARAGRAPH_CLASSES,
		hr: RULE_CLASSES,
		mark: [
			"article-highlight",
			"article-highlight--has-note",
			"article-highlight--note-end",
		],
	},
	allowedStyles: {
		img: {
			"--reader-image-width": [/^(?:[1-9]\d{0,4}px|100vw|min\(100vw,[1-9]\d{0,4}px\))$/],
			"--reader-image-ratio": [/^[1-9]\d{0,4} \/ [1-9]\d{0,4}$/],
		},
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
		mark: keepOnlyHighlightIds,
		img: keepOnlyMeasuredImageBox,
	},
};

export function sanitizeArticleHtml(html: string): string {
	return sanitizeHtml(sanitizeHtml(html, SANITIZE_OPTIONS), SANITIZE_OPTIONS);
}
