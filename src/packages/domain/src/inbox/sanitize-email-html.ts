import sanitizeHtml from "sanitize-html";

/** The structural + text tags a newsletter needs. Everything else is discarded
 * (`disallowedTagsMode: "discard"`), so `script`/`style`/`iframe`/`form`/
 * `object`/`embed`/`svg`/`base`/`link`/`meta`/`xmp` and friends never survive. */
const ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"u",
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
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"img",
	"hr",
	"div",
	"span",
];

/** Colour values: hex, rgb(), or a bare keyword. Crucially excludes `url(...)`
 * and `expression(...)`, so no value can smuggle a remote fetch or script. */
const COLOUR = [
	/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
	/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i,
	/^[a-z]+$/i,
];

/**
 * Server-side allowlist sanitizer for forwarded-email HTML (Layer 1 of the
 * two-layer defence; the sandboxed iframe is Layer 2). Runs before the body is
 * written to S3 so storage only ever holds safe HTML.
 *
 * Remote images are blocked unless rehosted: an `<img>` whose `src` is not a
 * `rehostedImages` key has its `src` stripped, so a tracking-pixel beacon can
 * never fire from the reader's browser. `rehostedImages` maps each parser-local
 * cid URL (`email://cid/<id>`, produced by the email preparser) to a `data:`
 * URI carrying the inline image's bytes, and each remote image URL the receive
 * path downloaded at ingest to its copy on our CDN; those — and only those —
 * survive with a rewritten `src`. Both shapes render inside the View tab's
 * sandboxed, opaque-origin iframe because its CSP allows exactly `data:` plus
 * our CDN origin.
 */
export function sanitizeEmailHtml(input: {
	html: string;
	rehostedImages: Record<string, string>;
}): string {
	return sanitizeHtml(input.html, {
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: {
			a: ["href", "target", "rel"],
			img: ["src", "alt", "width", "height"],
			td: ["colspan", "rowspan"],
			th: ["colspan", "rowspan"],
			"*": ["style"],
		},
		// Drops javascript:/vbscript:/data: hrefs on links — only these three
		// survive for `a`.
		allowedSchemes: ["http", "https", "mailto"],
		// Images may carry only the `data:` URIs we inlined or the https CDN URLs
		// we rehosted; this filter runs AFTER the transform below has stripped
		// every src that isn't a `rehostedImages` value, so no sender-controlled
		// URL — tracking beacon or otherwise — can reach the reader's browser.
		allowedSchemesByTag: { img: ["data", "https"] },
		disallowedTagsMode: "discard",
		// Remove the CONTENT of these, not just the tags, closing the historical
		// `<xmp>` raw-text bypass (CVE-2026-44990) and inert-script leakage.
		nonTextTags: ["style", "script", "iframe", "noscript", "xmp"],
		allowedStyles: {
			"*": {
				color: COLOUR,
				"background-color": COLOUR,
				"text-align": [/^(?:left|right|center|justify)$/],
				"font-weight": [/^(?:normal|bold|bolder|lighter|[1-9]00)$/],
				"font-style": [/^(?:normal|italic|oblique)$/],
			},
		},
		transformTags: {
			a: sanitizeHtml.simpleTransform("a", {
				target: "_blank",
				rel: "noopener noreferrer",
			}),
			img: (_tagName, attribs) => {
				const rehosted = input.rehostedImages[attribs.src];
				if (rehosted) {
					return { tagName: "img", attribs: { ...attribs, src: rehosted } };
				}
				const { src: _src, ...withoutSrc } = attribs;
				return { tagName: "img", attribs: withoutSrc };
			},
		},
	});
}
