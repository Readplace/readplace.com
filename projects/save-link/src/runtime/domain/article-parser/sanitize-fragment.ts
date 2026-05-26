import assert from "node:assert";
import { parseHTML } from "linkedom";

/**
 * Element-name blocklist for the reader-view body. These tags either execute
 * code (`script`), pull external resources (`iframe`, `link`, `object`,
 * `embed`), or only make sense in a chrome-laden authoring context
 * (`form`, `input`, `button`, `meta`, `style`). The reader-view body never
 * needs them.
 */
const BLOCKED_ELEMENT_TAGS = new Set([
	"script", "style", "iframe", "object", "embed", "form",
	"input", "button", "link", "meta",
]);

/**
 * Per-tag attribute allow-list. Anything not listed for the tag is stripped.
 * `<p class="ocr-tesseract">` / `<p class="ocr-failed">` markers (used by
 * the orchestrator's fallback paragraph wrappers) carry their `class`
 * attribute through so reader CSS can style them distinctly.
 */
const ALLOWED_ATTRIBUTES_BY_TAG: Record<string, ReadonlySet<string>> = {
	a: new Set(["href"]),
	img: new Set(["src", "alt"]),
	td: new Set(["colspan", "rowspan"]),
	th: new Set(["colspan", "rowspan"]),
	p: new Set(["class"]),
};

const EMPTY_ATTR_SET: ReadonlySet<string> = new Set();

const UNSAFE_HREF_SRC = /^\s*(javascript|data):/i;

/**
 * Sanitise an LLM-emitted (or stitched-Tesseract-emitted) HTML fragment so
 * the orchestrator can safely splice it into the synthetic article body.
 * Blocked elements are removed entirely; disallowed attributes are stripped;
 * `href`/`src` values that start with `javascript:` or `data:` are dropped.
 *
 * Re-introduced from the pre-Tesseract DeepInfra-vision era: the Stage 3
 * HTML conversion can emit any HTML5 element the prompt asks for (h2/h3,
 * ul/ol, table, pre/code, blockquote, …), so the orchestrator needs a
 * defence-in-depth sanitiser between the model output and the reader.
 */
export function sanitizeFragment(fragmentHtml: string): string {
	const { document } = parseHTML(`<!DOCTYPE html><html><body><div id="ocr-root">${fragmentHtml}</div></body></html>`);
	const wrapper = document.querySelector("div#ocr-root");
	assert(wrapper, "parseHTML must produce the wrapper div");
	for (const element of Array.from(wrapper.querySelectorAll("*"))) {
		const tagName = element.tagName.toLowerCase();
		if (BLOCKED_ELEMENT_TAGS.has(tagName)) {
			element.remove();
			continue;
		}
		const allowed = ALLOWED_ATTRIBUTES_BY_TAG[tagName] ?? EMPTY_ATTR_SET;
		for (const attr of Array.from(element.attributes)) {
			const name = attr.name.toLowerCase();
			if (!allowed.has(name) || ((name === "href" || name === "src") && UNSAFE_HREF_SRC.test(attr.value))) {
				element.removeAttribute(attr.name);
			}
		}
	}
	return wrapper.innerHTML;
}
