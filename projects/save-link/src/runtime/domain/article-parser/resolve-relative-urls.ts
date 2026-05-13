import assert from "node:assert";
import { parseHTML } from "linkedom";
import parseSrcset from "parse-srcset";

export function resolveRelativeUrls(params: {
	html: string;
	baseUrl: string;
}): string {
	if (!params.html) return params.html;

	const { document } = parseHTML(`<div id="root">${params.html}</div>`);
	const base = new URL(params.baseUrl);

	for (const img of document.querySelectorAll("img[src], video[src], audio[src]")) {
		resolveAttribute(img, "src", base);
	}

	for (const a of document.querySelectorAll("a[href]")) {
		const href = a.getAttribute("href");
		if (href?.startsWith("#")) continue;
		resolveAttribute(a, "href", base);
	}

	for (const el of document.querySelectorAll("[srcset]")) {
		resolveSrcset(el, base);
	}

	const root = document.getElementById("root");
	assert(root, "Root element must exist");
	return root.innerHTML;
}

function resolveSrcset(element: Element, base: URL): void {
	const value = element.getAttribute("srcset");
	if (!value) return;

	const entries = parseSrcset(value);

	const resolved = entries
		.map((entry) => {
			try {
				const resolvedUrl = new URL(entry.url, base.href).href;
				const descriptor = entry.w ? ` ${entry.w}w` : entry.d ? ` ${entry.d}x` : "";
				return resolvedUrl + descriptor;
			} catch {
				return entry.url;
			}
		})
		.join(", ");

	element.setAttribute("srcset", resolved);
}

function resolveAttribute(
	element: Element,
	attribute: string,
	base: URL,
): void {
	const value = element.getAttribute(attribute);
	if (!value) return;

	try {
		const resolved = new URL(value, base.href).href;
		element.setAttribute(attribute, resolved);
	} catch {
		// leave malformed URLs as-is
	}
}
