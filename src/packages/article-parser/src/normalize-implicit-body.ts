export function normalizeImplicitBody(document: Document): void {
	const topLevelHead = document.querySelector("head");
	const topLevelBody = document.querySelector("body");
	const roots = Array.from(document.childNodes);
	if (
		document.documentElement?.tagName !== "HTML" &&
		topLevelHead?.parentNode === document &&
		topLevelBody?.parentNode === document &&
		roots.indexOf(topLevelHead) < roots.indexOf(topLevelBody)
	) {
		const html = document.createElement("html");
		document.insertBefore(html, topLevelHead);
		for (const node of roots) {
			if (node !== document.doctype) html.appendChild(node);
		}
	}
	const head = document.head;
	const body = document.body;
	const METADATA_TAGS = new Set([
		"META",
		"LINK",
		"TITLE",
		"STYLE",
		"SCRIPT",
		"BASE",
	]);
	for (const child of Array.from(head.children)) {
		if (!METADATA_TAGS.has(child.tagName)) body.appendChild(child);
	}
	for (const child of Array.from(document.documentElement.children)) {
		if (child === head || child === body) continue;
		if (METADATA_TAGS.has(child.tagName)) head.appendChild(child);
		else body.appendChild(child);
	}
}
